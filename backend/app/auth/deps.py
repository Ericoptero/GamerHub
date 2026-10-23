"""Quem está fazendo a requisição. Com o login desligado é sempre o usuário 1, então o resto do
código filtra por usuário do mesmo jeito nos dois modos."""

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.domain import DEFAULT_USER_ID
from app.models import User


def session_user_id(request: Request) -> int | None:
    """Id que o middleware de login resolveu a partir do cookie (None sem sessão válida)."""
    return getattr(request.state, "user_id", None)


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    if not get_settings().auth_enabled:
        user = db.get(User, DEFAULT_USER_ID)
        if user is None:
            raise HTTPException(500, "Usuário principal não existe; rode as migrações")
        return user
    uid = session_user_id(request)
    user = db.get(User, uid) if uid is not None else None
    if user is None:
        raise HTTPException(401, "Faça login para continuar")
    return user


def require_admin(user: User = Depends(current_user)) -> User:
    if get_settings().auth_enabled and not user.is_admin:
        raise HTTPException(403, "Só administradores podem fazer isso")
    return user
