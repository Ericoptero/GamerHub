"""Regras de negócio dos jogos: serialização, criação, edição (com trava de metadados) e mesclagem."""

import shutil
from datetime import date, datetime

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.domain import META_FIELDS, normalize_title
from app.integrations.matching import EDITION_WORDS
from app.models import Comment, ExternalLink, Game, Genre, LibraryItem, Media, Platform
from app.schemas import (
    CommentOut,
    DuplicateOut,
    GameCard,
    GameCreate,
    GameDetail,
    GamePatch,
    LinkOut,
    MediaOut,
    OwnershipOut,
    StoreReviewOut,
)
from app.services.catalog import CatalogCache

# game_id -> (contas que têm o jogo, última vez jogado entre elas)
Ownership = dict[int, tuple[list[int], datetime | None]]


def media_url(path: str | None, remote: str | None) -> str | None:
    """Arquivo em cache local tem prioridade sobre a URL remota."""
    if path:
        return f"/media/{path}"
    return remote


def youtube_id(url: str) -> str | None:
    import re

    m = re.search(r"(?:youtu\.be/|v=|embed/|shorts/)([\w-]{11})", url)
    return m.group(1) if m else None


def _media_out(m: Media) -> MediaOut:
    src = media_url(m.local_path, m.url) or m.url
    thumb = media_url(m.thumb_path, m.thumb_url) or src
    if m.kind == "video" and not m.thumb_url and not m.thumb_path:
        yt = m.provider_ref if m.provider == "igdb" else youtube_id(m.url)
        if yt:
            thumb = f"https://i.ytimg.com/vi/{yt}/hqdefault.jpg"
    return MediaOut(
        id=m.id,
        kind=m.kind,
        url=m.url,
        src=src,
        thumb=thumb,
        provider=m.provider,
        provider_ref=m.provider_ref,
        title=m.title,
        position=m.position,
    )


def ownership_index(db: Session, user_id: int) -> Ownership:
    rows = db.execute(
        select(LibraryItem.game_id, LibraryItem.account_id, func.max(LibraryItem.last_played_at))
        .join(Game, Game.id == LibraryItem.game_id)
        .where(Game.user_id == user_id, LibraryItem.ignored.is_(False))
        .group_by(LibraryItem.game_id, LibraryItem.account_id)
        .order_by(LibraryItem.account_id)
    )
    out: Ownership = {}
    for gid, aid, last in rows:
        accounts, prev = out.get(gid, ([], None))
        accounts.append(aid)
        out[gid] = (accounts, max(prev, last) if prev and last else prev or last)
    return out


def to_card(g: Game, owned: Ownership | None = None) -> GameCard:
    account_ids, last_played = (owned or {}).get(g.id, ([], None))
    return GameCard(
        id=g.id,
        name=g.name,
        platform_id=g.platform_id,
        platform=g.platform.name,
        genre_id=g.genre_id,
        genre=g.genre.name if g.genre else None,
        status=g.status,  # type: ignore[arg-type]
        priority=g.priority,  # type: ignore[arg-type]
        hltb_main_hours=g.hltb_main_hours,
        played_hours=g.played_hours,
        user_score=g.user_score,
        metacritic_score=g.metacritic_score,
        times_completed=g.times_completed,
        finished_at=g.finished_at,
        finished_label=g.finished_label,
        release_date=g.release_date,
        created_at=g.created_at,
        cover=media_url(g.cover_path, g.cover_url),
        hltb_extra_hours=g.hltb_extra_hours,
        hltb_complete_hours=g.hltb_complete_hours,
        metacritic_user_score=g.metacritic_user_score,
        tags=g.tags or [],
        developer=g.developer,
        publisher=g.publisher,
        stores=[s.name for s in g.stores],
        account_ids=account_ids,
        last_played_at=last_played,
        enriched=g.last_enriched_at is not None,
    )


def _ownerships(db: Session, g: Game) -> list[OwnershipOut]:
    items = db.scalars(
        select(LibraryItem).where(LibraryItem.game_id == g.id, LibraryItem.ignored.is_(False)).order_by(LibraryItem.id)
    ).all()
    return [
        OwnershipOut(
            account_id=i.account_id,
            store=i.account.store,
            nickname=i.account.nickname,
            external_id=i.external_id,
            name=i.name,
            playtime_hours=round(i.playtime_minutes / 60, 1) if i.playtime_minutes else None,
            last_played_at=i.last_played_at,
            url=i.url,
        )
        for i in items
    ]


def similarity_keys(name: str) -> tuple[str, str, str | None]:
    """(nome normalizado, sem palavras de edição, prefixo antes de ':' ou ' - ')."""
    full = normalize_title(name)
    core = " ".join(w for w in full.split() if w not in EDITION_WORDS)
    prefix = next((normalize_title(name.split(sep, 1)[0]) for sep in (":", " - ") if sep in name), None)
    return full, core, prefix


def looks_duplicate(a: str, b: str) -> bool:
    """Parecem o mesmo jogo ("Witcher 3: Wild Hunt" e "The Witcher 3 GOTY"). Só sugestão, nunca automático."""
    fa, ca, pa = similarity_keys(a)
    fb, cb, pb = similarity_keys(b)
    if fa == fb or (ca and ca == cb):
        return True
    return bool((pa and pa in (fb, cb)) or (pb and pb in (fa, ca)))


def _duplicates(db: Session, g: Game) -> list[DuplicateOut]:
    same_platform = db.scalars(
        select(Game).where(Game.user_id == g.user_id, Game.platform_id == g.platform_id, Game.id != g.id)
    )
    found = [o for o in same_platform if looks_duplicate(g.name, o.name)]
    return [DuplicateOut(id=o.id, name=o.name, status=o.status, platform=o.platform.name) for o in found[:5]]


def to_detail(db: Session, g: Game) -> GameDetail:
    return GameDetail(
        **to_card(g, ownership_index(db, g.user_id)).model_dump(),
        review_text=g.review_text,
        story_summary=g.story_summary,
        description=g.description,
        storyline=g.storyline,
        background=media_url(g.background_path, g.background_url),
        cover_url=g.cover_url,
        background_url=g.background_url,
        metacritic_url=g.metacritic_url,
        metacritic_source=g.metacritic_source,
        origin=g.origin,
        played_hours_source=g.played_hours_source,
        locked_fields=g.locked_fields or [],
        comments=[CommentOut.model_validate(c) for c in sorted(g.comments, key=lambda c: c.created_at, reverse=True)],
        media=[_media_out(m) for m in g.media],
        store_reviews=[StoreReviewOut.model_validate(r) for r in g.store_reviews],
        links=[LinkOut.model_validate(lk) for lk in g.links],
        ownerships=_ownerships(db, g),
        duplicates=_duplicates(db, g),
        updated_at=g.updated_at,
        last_enriched_at=g.last_enriched_at,
    )


def get_game(db: Session, user_id: int, game_id: int) -> Game:
    """Jogo do usuário; o de outro usuário é tratado como inexistente."""
    game = db.get(Game, game_id)
    if game is None or game.user_id != user_id:
        raise HTTPException(404, "Jogo não encontrado")
    return game


def _platform(db: Session, platform_id: int) -> Platform:
    p = db.get(Platform, platform_id)
    if p is None:
        raise HTTPException(422, "Plataforma inexistente")
    return p


def _genre(db: Session, genre_id: int | None) -> Genre | None:
    if genre_id is None:
        return None
    g = db.get(Genre, genre_id)
    if g is None:
        raise HTTPException(422, "Gênero inexistente")
    return g


def create_game(db: Session, user_id: int, data: GameCreate) -> Game:
    origin = data.link.provider if data.link else "manual"
    game = Game(
        user_id=user_id,
        name=data.name.strip(),
        name_norm=normalize_title(data.name),
        platform=_platform(db, data.platform_id),
        genre=_genre(db, data.genre_id),
        status=data.status,
        priority=data.priority,
        hltb_main_hours=data.hltb_main_hours,
        metacritic_score=data.metacritic_score,
        metacritic_source="manual" if data.metacritic_score is not None else None,
        release_date=data.release_date,
        description=data.description or None,
        cover_url=data.cover_url or None,
        origin=origin,
        tags=[],
        locked_fields=[],
    )
    if data.status == "done":
        game.finished_at = date.today()
    # Valores digitados à mão num cadastro manual valem mais que a integração.
    if not data.link:
        game.locked_fields = [
            f for f in ("hltb_main_hours", "metacritic_score", "description", "cover_url") if getattr(game, f)
        ]
    cat = CatalogCache(db)
    game.stores = cat.stores_from(data.stores)
    pos = 0
    if data.video_url:
        game.media.append(Media(kind="video", url=data.video_url, provider="manual", position=pos))
    for i, url in enumerate(u.strip() for u in data.screenshots):
        if url:
            game.media.append(Media(kind="screenshot", url=url, provider="manual", position=i))
    db.add(game)
    db.commit()
    return game


def patch_game(db: Session, game: Game, patch: GamePatch) -> Game:
    sent = patch.model_fields_set - {"unlock", "stores", "platform_id", "genre_id"}
    locked = set(game.locked_fields or [])
    old_status = game.status
    for field in sent:
        value = getattr(patch, field)
        if field == "name":
            if value is None:
                continue
            value = value.strip()
            game.name_norm = normalize_title(value)
        if field == "status" and value is None:
            continue
        if field in META_FIELDS and getattr(game, field) != value:
            locked.add(field)
        if field == "played_hours" and game.played_hours != value:
            # Digitado à mão (inclusive apagar): a soma das contas de loja não mexe mais.
            game.played_hours_source = "user"
        if field == "tags":
            value = value or []
        setattr(game, field, value)
        if field == "metacritic_score":
            game.metacritic_source = "manual" if value is not None else None
        if field == "cover_url":
            game.cover_path = None
        if field == "background_url":
            game.background_path = None
    if "platform_id" in patch.model_fields_set and patch.platform_id is not None:
        game.platform = _platform(db, patch.platform_id)
    if "genre_id" in patch.model_fields_set:
        game.genre = _genre(db, patch.genre_id)
    if patch.stores is not None:
        game.stores = CatalogCache(db).stores_from(patch.stores)
    if game.status == "done" and old_status != "done" and game.finished_at is None and "finished_at" not in sent:
        game.finished_at = date.today()
        game.finished_label = None
    for field in patch.unlock:
        locked.discard(field)
    game.locked_fields = sorted(locked)
    db.commit()
    return game


def delete_game(db: Session, game: Game) -> None:
    game_id = game.id
    # Apagar um jogo que veio de uma conta de loja: a sincronização não o traz de volta.
    db.execute(update(LibraryItem).where(LibraryItem.game_id == game_id).values(ignored=True, game_id=None))
    db.delete(game)
    db.commit()
    shutil.rmtree(get_settings().media_dir / str(game_id), ignore_errors=True)


# Campos que passam da origem para o destino na mesclagem quando o destino não tem valor.
MERGE_FILL = (
    "genre_id", "priority", "user_score", "review_text", "story_summary", "times_completed", "finished_at",
    "finished_label", "release_date", "hltb_main_hours", "hltb_extra_hours", "hltb_complete_hours",
    "metacritic_score", "metacritic_user_score", "metacritic_url", "metacritic_source", "description",
    "storyline", "developer", "publisher",
)  # fmt: skip
_LINK_COPY = ("provider", "external_id", "external_url", "matched_name", "match_score", "status", "candidates")


def merge_games(db: Session, target: Game, source: Game) -> Game:
    """Junta `source` em `target` e apaga `source`: contas de loja, comentários, mídia manual, links,
    lojas e os campos que faltam no destino. Os dois são do mesmo usuário (o chamador garante)."""
    from app.library.sync import update_played_hours

    if target.id == source.id:
        raise HTTPException(409, "Escolha outro jogo para mesclar")
    db.execute(update(LibraryItem).where(LibraryItem.game_id == source.id).values(game_id=target.id))
    # UPDATE direto: mover pela coleção dispararia o delete-orphan e apagaria o comentário junto com a origem.
    db.execute(update(Comment).where(Comment.game_id == source.id).values(game_id=target.id))
    db.expire(source, ["comments"])
    db.expire(target, ["comments"])
    have_media = {(m.kind, m.url) for m in target.media}
    for m in source.media:
        if m.provider == "manual" and (m.kind, m.url) not in have_media:
            # Sem local_path: o arquivo em media/{origem}/ some junto com ela e é baixado de novo.
            target.media.append(
                Media(kind=m.kind, url=m.url, thumb_url=m.thumb_url, provider="manual", title=m.title, position=m.position)
            )
    have_links = {lk.provider for lk in target.links}
    for lk in source.links:
        if lk.provider not in have_links:
            target.links.append(ExternalLink(**{f: getattr(lk, f) for f in _LINK_COPY}))
    target.stores = CatalogCache(db).stores_from([s.name for s in (*target.stores, *source.stores)])
    for field in MERGE_FILL:
        if getattr(target, field) in (None, "") and getattr(source, field) not in (None, ""):
            setattr(target, field, getattr(source, field))
    if not target.tags and source.tags:
        target.tags = list(source.tags)
    if target.played_hours is None and source.played_hours is not None:
        target.played_hours, target.played_hours_source = source.played_hours, source.played_hours_source
    if target.status == "owned" and source.status != "owned":
        target.status = source.status
    target.locked_fields = sorted(set(target.locked_fields or []) | set(source.locked_fields or []))
    source_id = source.id
    db.delete(source)
    db.flush()
    update_played_hours(db, {target.id})
    db.commit()
    shutil.rmtree(get_settings().media_dir / str(source_id), ignore_errors=True)
    return target
