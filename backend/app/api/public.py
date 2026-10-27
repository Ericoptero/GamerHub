"""Página pública de cada usuário (/<username>): os cards e as listas públicas, sem login e sem os ocultos."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Game, User
from app.schemas import PublicProfile
from app.services import games as svc
from app.services import lists as lists_svc

router = APIRouter(prefix="/api/public", tags=["public"])


def media_is_public(db: Session, game_id: int) -> bool:
    """Capa/fundo de um jogo podem sair sem login se ele aparece numa página pública."""
    found = db.scalar(
        select(Game.id)
        .join(User, User.id == Game.user_id)
        .where(Game.id == game_id, Game.hidden.is_(False), User.public_page.is_(True))
    )
    return found is not None


@router.get("/{username}", response_model=PublicProfile)
def public_profile(username: str, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.username == username))
    if user is None or not user.public_page:
        raise HTTPException(404, "Página não encontrada")
    games = list(db.scalars(select(Game).where(Game.user_id == user.id, Game.hidden.is_(False)).order_by(Game.id)))
    visible = {g.id for g in games}
    # Só as listas marcadas como públicas e que mostram algum jogo (os ocultos nunca saem).
    lists = [lists_svc.to_public(lst, visible) for lst in lists_svc.user_lists(db, user.id) if lst.public]
    return PublicProfile(
        username=user.username,
        display_name=user.display_name,
        games=[svc.to_public_card(g) for g in games],
        lists=[lst for lst in lists if lst.game_ids],
    )
