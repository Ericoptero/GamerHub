"""Sessões de login: token aleatório no cookie, só o sha256 dele no banco. Validade deslizante."""

import hashlib
import secrets
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app import db as dbmod
from app.config import get_settings
from app.models import User, UserSession

COOKIE = "gamerhub_session"
# Renovar a validade a cada requisição seria uma escrita por chamada; uma vez por hora basta.
RENEW_AFTER = timedelta(hours=1)


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _lifetime() -> timedelta:
    return timedelta(days=get_settings().auth_session_days)


def create_session(db: Session, user: User, user_agent: str | None) -> str:
    token = secrets.token_urlsafe(32)
    now = _now()
    db.add(
        UserSession(
            token_hash=_hash(token),
            user_id=user.id,
            created_at=now,
            last_seen_at=now,
            expires_at=now + _lifetime(),
            user_agent=(user_agent or "")[:300] or None,
        )
    )
    user.last_login_at = now
    db.commit()
    return token


def user_id_for_token(db: Session, token: str) -> int | None:
    s = db.get(UserSession, _hash(token))
    if s is None:
        return None
    now = _now()
    if s.expires_at <= now:
        db.delete(s)
        db.commit()
        return None
    if now - s.last_seen_at > RENEW_AFTER:
        s.last_seen_at = now
        s.expires_at = now + _lifetime()
        db.commit()
    return s.user_id


def resolve_token(token: str) -> int | None:
    """Versão com sessão própria, para o middleware."""
    with dbmod.new_session() as db:
        return user_id_for_token(db, token)


def end_session(db: Session, token: str) -> None:
    db.execute(delete(UserSession).where(UserSession.token_hash == _hash(token)))
    db.commit()


def end_user_sessions(db: Session, user_id: int, keep_token: str | None = None) -> None:
    q = delete(UserSession).where(UserSession.user_id == user_id)
    if keep_token:
        q = q.where(UserSession.token_hash != _hash(keep_token))
    db.execute(q)
    db.commit()


class LoginThrottle:
    """Depois de 5 senhas erradas para o mesmo usuário+IP, espera 30s, 60s, 120s… (até 15 min)."""

    FREE_ATTEMPTS = 5
    BASE_SECONDS = 30
    MAX_SECONDS = 900

    def __init__(self) -> None:
        self._fails: dict[tuple[str, str], tuple[int, float]] = {}

    def retry_after(self, key: tuple[str, str]) -> int:
        _count, until = self._fails.get(key, (0, 0.0))
        return max(0, int(until - time.monotonic() + 0.999))

    def failed(self, key: tuple[str, str]) -> None:
        count = self._fails.get(key, (0, 0.0))[0] + 1
        until = 0.0
        if count >= self.FREE_ATTEMPTS:
            wait = min(self.MAX_SECONDS, self.BASE_SECONDS * 2 ** (count - self.FREE_ATTEMPTS))
            until = time.monotonic() + wait
        self._fails[key] = (count, until)

    def succeeded(self, key: tuple[str, str]) -> None:
        self._fails.pop(key, None)

    def reset(self) -> None:
        self._fails.clear()


throttle = LoginThrottle()
