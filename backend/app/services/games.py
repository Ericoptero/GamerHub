"""Regras de negócio dos jogos: serialização, criação e edição (com trava de metadados)."""

import shutil
from datetime import date

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.config import get_settings
from app.domain import META_FIELDS, normalize_title
from app.models import Game, Genre, Media, Platform
from app.schemas import (
    CommentOut,
    GameCard,
    GameCreate,
    GameDetail,
    GamePatch,
    LinkOut,
    MediaOut,
    StoreReviewOut,
)
from app.services.catalog import CatalogCache


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


def to_card(g: Game) -> GameCard:
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
    )


def to_detail(g: Game) -> GameDetail:
    return GameDetail(
        **to_card(g).model_dump(),
        hltb_extra_hours=g.hltb_extra_hours,
        hltb_complete_hours=g.hltb_complete_hours,
        review_text=g.review_text,
        story_summary=g.story_summary,
        description=g.description,
        storyline=g.storyline,
        background=media_url(g.background_path, g.background_url),
        cover_url=g.cover_url,
        background_url=g.background_url,
        metacritic_user_score=g.metacritic_user_score,
        metacritic_url=g.metacritic_url,
        metacritic_source=g.metacritic_source,
        tags=g.tags or [],
        developer=g.developer,
        publisher=g.publisher,
        origin=g.origin,
        locked_fields=g.locked_fields or [],
        stores=[s.name for s in g.stores],
        comments=[CommentOut.model_validate(c) for c in sorted(g.comments, key=lambda c: c.created_at, reverse=True)],
        media=[_media_out(m) for m in g.media],
        store_reviews=[StoreReviewOut.model_validate(r) for r in g.store_reviews],
        links=[LinkOut.model_validate(lk) for lk in g.links],
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
    db.delete(game)
    db.commit()
    shutil.rmtree(get_settings().media_dir / str(game_id), ignore_errors=True)
