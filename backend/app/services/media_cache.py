"""Baixa capa, fundo e screenshots para /data/media/{game_id}/ em WebP (servidos em /media)."""

import asyncio
import hashlib
import io
import logging
import shutil
from pathlib import Path

import httpx
from PIL import Image
from sqlalchemy import select

from app import db as dbmod
from app.config import get_settings
from app.integrations.http import USER_AGENT
from app.models import Game, Media

log = logging.getLogger(__name__)

MAX_BYTES = 10 * 1024 * 1024
# tipo -> (largura máx., altura máx.)
SIZES = {
    "cover": (None, 600),
    "background": (1600, None),
    "screenshot": (1280, None),
    "thumb": (480, None),
}


def _file_name(kind: str, url: str) -> str:
    return f"{kind}-{hashlib.sha1(url.encode()).hexdigest()[:12]}.webp"


def _convert(data: bytes, dest: Path, kind: str) -> None:
    max_w, max_h = SIZES[kind]
    with Image.open(io.BytesIO(data)) as im:
        im = im.convert("RGBA") if im.mode in ("P", "LA") else im
        im = im.convert("RGB") if im.mode not in ("RGB", "RGBA") else im
        w, h = im.size
        scale = min((max_w or w) / w, (max_h or h) / h, 1.0)
        if scale < 1.0:
            im = im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.Resampling.LANCZOS)
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(".tmp")
        im.save(tmp, "WEBP", quality=82, method=4)
        tmp.replace(dest)


async def _download(client: httpx.AsyncClient, url: str) -> bytes | None:
    if not url.startswith(("http://", "https://")):
        return None
    try:
        async with client.stream("GET", url) as resp:
            if resp.status_code != 200 or not resp.headers.get("content-type", "").startswith("image/"):
                return None
            chunks, size = [], 0
            async for chunk in resp.aiter_bytes():
                size += len(chunk)
                if size > MAX_BYTES:
                    return None
                chunks.append(chunk)
            return b"".join(chunks)
    except httpx.HTTPError as e:
        log.info("falha ao baixar %s: %s", url, e)
        return None


async def fetch_to_cache(client: httpx.AsyncClient, game_id: int, url: str, kind: str) -> str | None:
    """Baixa e converte; retorna o caminho relativo dentro de media_dir (ou None)."""
    rel = f"{game_id}/{_file_name(kind, url)}"
    dest = get_settings().media_dir / rel
    if dest.exists():
        return rel
    data = await _download(client, url)
    if data is None:
        return None
    try:
        await asyncio.to_thread(_convert, data, dest, kind)
    except Exception as e:  # noqa: BLE001  (imagem corrompida, formato desconhecido)
        log.info("imagem inválida %s: %s", url, e)
        return None
    return rel


def _snapshot(game_id: int) -> dict | None:
    with dbmod.new_session() as db:
        g = db.get(Game, game_id)
        if g is None:
            return None
        return {
            "cover": (g.cover_url, g.cover_path),
            "background": (g.background_url, g.background_path),
            "shots": [
                (m.id, m.url, m.thumb_url, m.local_path, m.thumb_path)
                for m in g.media
                if m.kind in ("screenshot", "artwork")
            ],
        }


def _save(game_id: int, updates: dict, media_updates: dict[int, tuple[str | None, str | None]]) -> None:
    with dbmod.new_session() as db:
        g = db.get(Game, game_id)
        if g is None:
            return
        for field, (url, path) in updates.items():
            # só grava se a URL ainda é a mesma (o usuário pode ter trocado no meio do download)
            if getattr(g, f"{field}_url") == url:
                setattr(g, f"{field}_path", path)
        for m in g.media:
            if m.id in media_updates:
                local, thumb = media_updates[m.id]
                m.local_path = local or m.local_path
                m.thumb_path = thumb or m.thumb_path
        db.commit()


async def cache_game_images(game_id: int) -> None:
    snap = await asyncio.to_thread(_snapshot, game_id)
    if snap is None:
        return
    updates: dict[str, tuple[str, str | None]] = {}
    media_updates: dict[int, tuple[str | None, str | None]] = {}
    async with httpx.AsyncClient(headers={"User-Agent": USER_AGENT}, timeout=20, follow_redirects=True) as client:
        for field in ("cover", "background"):
            url, path = snap[field]
            if url and not path:
                updates[field] = (url, await fetch_to_cache(client, game_id, url, field))
        if get_settings().cache_screenshots:
            sem = asyncio.Semaphore(3)

            async def one(mid: int, url: str, thumb_url: str | None) -> None:
                async with sem:
                    local = await fetch_to_cache(client, game_id, url, "screenshot")
                    thumb = await fetch_to_cache(client, game_id, url, "thumb") if local else None
                    media_updates[mid] = (local, thumb)

            await asyncio.gather(
                *(one(mid, url, turl) for mid, url, turl, local, _t in snap["shots"] if not local)
            )
    if updates or media_updates:
        await asyncio.to_thread(_save, game_id, updates, media_updates)


def collect_garbage() -> int:
    """Remove arquivos e pastas de mídia que nenhum jogo referencia mais."""
    media_dir = get_settings().media_dir
    if not media_dir.exists():
        return 0
    with dbmod.new_session() as db:
        referenced: set[str] = set()
        for cover, bg in db.execute(select(Game.cover_path, Game.background_path)):
            referenced.update(p for p in (cover, bg) if p)
        for local, thumb in db.execute(select(Media.local_path, Media.thumb_path)):
            referenced.update(p for p in (local, thumb) if p)
        game_ids = {str(i) for i in db.scalars(select(Game.id))}
    removed = 0
    for d in media_dir.iterdir():
        if not d.is_dir():
            continue
        if d.name not in game_ids:
            shutil.rmtree(d, ignore_errors=True)
            removed += 1
            continue
        for f in d.iterdir():
            if f"{d.name}/{f.name}" not in referenced:
                f.unlink(missing_ok=True)
                removed += 1
    return removed
