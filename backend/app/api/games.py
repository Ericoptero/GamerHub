from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.deps import current_user
from app.db import get_db
from app.enrichment.jobs import link_and_refresh, link_and_refresh_many
from app.models import Comment, Game, Media, User
from app.schemas import (
    CommentIn,
    CommentOut,
    GameBatchIn,
    GameCard,
    GameCreate,
    GameDetail,
    GamePatch,
    MediaIn,
    MergeIn,
)
from app.services import games as svc
from app.services.media_cache import cache_game_images

router = APIRouter(prefix="/api", tags=["games"])


@router.get("/games", response_model=list[GameCard])
def list_games(status: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    q = select(Game).where(Game.user_id == user.id).order_by(Game.id)
    if status:
        q = q.where(Game.status == status)
    owned = svc.ownership_index(db, user.id)
    return [svc.to_card(g, owned) for g in db.scalars(q)]


@router.get("/games/{game_id}", response_model=GameDetail)
def get_game(game_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return svc.to_detail(db, svc.get_game(db, user.id, game_id))


@router.post("/games", response_model=GameDetail, status_code=201)
def create_game(
    data: GameCreate, background: BackgroundTasks, db: Session = Depends(get_db), user: User = Depends(current_user)
):
    game = svc.create_game(db, user.id, data)
    if data.link:
        link_and_refresh(db, game, data.link.provider, data.link.external_id)
    elif game.cover_url:
        background.add_task(cache_game_images, game.id)
    db.refresh(game)
    return svc.to_detail(db, game)


@router.post("/games/batch", response_model=list[GameCard], status_code=201)
def create_games(
    data: GameBatchIn, background: BackgroundTasks, db: Session = Depends(get_db), user: User = Depends(current_user)
):
    games = svc.create_games(db, user.id, data.games)
    links = [(g, item.link.provider, item.link.external_id) for g, item in zip(games, data.games) if item.link]
    if links:
        link_and_refresh_many(db, user.id, links)
    for g, item in zip(games, data.games):
        if not item.link and g.cover_url:
            background.add_task(cache_game_images, g.id)
    owned = svc.ownership_index(db, user.id)
    return [svc.to_card(g, owned) for g in games]


@router.patch("/games/{game_id}", response_model=GameDetail)
def patch_game(
    game_id: int,
    patch: GamePatch,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    game = svc.patch_game(db, svc.get_game(db, user.id, game_id), patch)
    if {"cover_url", "background_url"} & patch.model_fields_set:
        background.add_task(cache_game_images, game.id)
    return svc.to_detail(db, game)


@router.delete("/games/{game_id}", status_code=204)
def delete_game(game_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    svc.delete_game(db, svc.get_game(db, user.id, game_id))
    return Response(status_code=204)


@router.post("/games/{game_id}/merge", response_model=GameDetail)
def merge_game(
    game_id: int,
    data: MergeIn,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Junta outro jogo (`source_id`) neste e apaga o outro."""
    target = svc.get_game(db, user.id, game_id)
    game = svc.merge_games(db, target, svc.get_game(db, user.id, data.source_id))
    background.add_task(cache_game_images, game.id)
    db.refresh(game)
    return svc.to_detail(db, game)


# ---------- comentários ----------


@router.get("/games/{game_id}/comments", response_model=list[CommentOut])
def list_comments(game_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    game = svc.get_game(db, user.id, game_id)
    return sorted(game.comments, key=lambda c: c.created_at, reverse=True)


@router.post("/games/{game_id}/comments", response_model=CommentOut, status_code=201)
def add_comment(game_id: int, data: CommentIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    game = svc.get_game(db, user.id, game_id)
    comment = Comment(body=data.body.strip(), created_at=datetime.now(timezone.utc).replace(tzinfo=None))
    game.comments.append(comment)
    db.commit()
    return comment


def _comment(db: Session, user_id: int, comment_id: int) -> Comment:
    c = db.get(Comment, comment_id)
    if c is None or c.game.user_id != user_id:
        raise HTTPException(404, "Comentário não encontrado")
    return c


@router.patch("/comments/{comment_id}", response_model=CommentOut)
def edit_comment(comment_id: int, data: CommentIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    c = _comment(db, user.id, comment_id)
    c.body = data.body.strip()
    c.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    return c


@router.delete("/comments/{comment_id}", status_code=204)
def delete_comment(comment_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    db.delete(_comment(db, user.id, comment_id))
    db.commit()
    return Response(status_code=204)


# ---------- mídia manual ----------


@router.post("/games/{game_id}/media", response_model=GameDetail, status_code=201)
def add_media(
    game_id: int,
    data: MediaIn,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    game = svc.get_game(db, user.id, game_id)
    if any(m.kind == data.kind and m.url == data.url for m in game.media):
        raise HTTPException(409, "Essa mídia já está cadastrada")
    pos = max((m.position for m in game.media if m.kind == data.kind), default=-1) + 1
    game.media.append(Media(kind=data.kind, url=data.url, title=data.title, provider="manual", position=pos))
    db.commit()
    if data.kind != "video":
        background.add_task(cache_game_images, game.id)
    return svc.to_detail(db, game)


@router.delete("/media/{media_id}", status_code=204)
def delete_media(media_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    m = db.get(Media, media_id)
    if m is None or m.game.user_id != user.id:
        raise HTTPException(404, "Mídia não encontrada")
    db.delete(m)
    db.commit()
    return Response(status_code=204)
