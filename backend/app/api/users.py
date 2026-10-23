"""Administração de usuários (só com o login ligado)."""

import shutil

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.auth import username_taken
from app.auth import sessions
from app.auth.deps import require_admin
from app.auth.passwords import hash_password
from app.config import get_settings
from app.db import get_db
from app.domain import DEFAULT_USER_ID
from app.models import Game, User
from app.schemas import PasswordResetIn, UserAdminOut, UserCreate, UserPatch
from app.seed.seed_data import seed_devices

router = APIRouter(prefix="/api/users", tags=["users"])


def _admin(admin: User = Depends(require_admin)) -> User:
    if not get_settings().auth_enabled:
        raise HTTPException(409, "O login está desligado (AUTH_ENABLED=false no .env)")
    return admin


def _user(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "Usuário não encontrado")
    return user


def _out(db: Session, user: User) -> UserAdminOut:
    count = db.scalar(select(func.count(Game.id)).where(Game.user_id == user.id)) or 0
    return UserAdminOut.model_validate(user).model_copy(update={"game_count": count})


def _admins(db: Session) -> int:
    return db.scalar(select(func.count(User.id)).where(User.is_admin.is_(True))) or 0


@router.get("", response_model=list[UserAdminOut])
def list_users(db: Session = Depends(get_db), _a: User = Depends(_admin)):
    return [_out(db, u) for u in db.scalars(select(User).order_by(User.id))]


@router.post("", response_model=UserAdminOut, status_code=201)
def create_user(data: UserCreate, db: Session = Depends(get_db), _a: User = Depends(_admin)):
    username = data.username.strip()
    if username_taken(db, username):
        raise HTTPException(409, "Esse nome de usuário já existe")
    user = User(
        username=username,
        display_name=(data.display_name or "").strip() or username,
        password_hash=hash_password(data.password),
        is_admin=data.is_admin,
    )
    db.add(user)
    db.flush()
    seed_devices(db, user.id)
    db.commit()
    return _out(db, user)


@router.patch("/{user_id}", response_model=UserAdminOut)
def patch_user(user_id: int, data: UserPatch, db: Session = Depends(get_db), _a: User = Depends(_admin)):
    user = _user(db, user_id)
    if data.display_name is not None:
        user.display_name = data.display_name.strip()
    if data.is_admin is not None:
        if user.is_admin and not data.is_admin and _admins(db) <= 1:
            raise HTTPException(409, "Precisa sobrar pelo menos um administrador")
        user.is_admin = data.is_admin
    db.commit()
    return _out(db, user)


@router.post("/{user_id}/password", status_code=204)
def reset_password(user_id: int, data: PasswordResetIn, db: Session = Depends(get_db), _a: User = Depends(_admin)):
    user = _user(db, user_id)
    user.password_hash = hash_password(data.password)
    db.commit()
    sessions.end_user_sessions(db, user.id)
    return Response(status_code=204)


@router.delete("/{user_id}", status_code=204)
def delete_user(user_id: int, db: Session = Depends(get_db), admin: User = Depends(_admin)):
    user = _user(db, user_id)
    if user.id == admin.id:
        raise HTTPException(409, "Você não pode remover a si mesmo")
    if user.id == DEFAULT_USER_ID:
        # É quem fica com tudo se o login for desligado.
        raise HTTPException(409, "O usuário principal não pode ser removido")
    game_ids = list(db.scalars(select(Game.id).where(Game.user_id == user.id)))
    db.delete(user)  # jogos, aparelhos, jobs, sessões e contas de loja vão junto (ON DELETE CASCADE)
    db.commit()
    media = get_settings().media_dir
    for gid in game_ids:
        shutil.rmtree(media / str(gid), ignore_errors=True)
    return Response(status_code=204)
