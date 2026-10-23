"""Login opcional. Com AUTH_ENABLED=false só o /me responde (dizendo que o login está desligado)."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import sessions
from app.auth.deps import current_user, session_user_id
from app.auth.passwords import DUMMY_HASH, hash_password, verify_password
from app.config import get_settings
from app.db import get_db
from app.domain import DEFAULT_USER_ID
from app.models import User
from app.schemas import AuthMe, LoginIn, PasswordChangeIn, SignupIn, UserOut
from app.seed.seed_data import seed_devices

router = APIRouter(prefix="/api/auth", tags=["auth"])


def needs_setup(db: Session) -> bool:
    """O usuário principal ainda não tem senha: o primeiro cadastro fica com ele (e com os dados)."""
    main = db.get(User, DEFAULT_USER_ID)
    return main is not None and main.password_hash is None


def _require_enabled() -> None:
    if not get_settings().auth_enabled:
        raise HTTPException(409, "O login está desligado (AUTH_ENABLED=false no .env)")


def _set_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        sessions.COOKIE,
        token,
        max_age=settings.auth_session_days * 86400,
        httponly=True,
        samesite="lax",
        secure=settings.auth_cookie_secure,
        path="/",
    )


def username_taken(db: Session, username: str, exclude_id: int | None = None) -> bool:
    # A coluna é NOCASE: "Bruno" e "bruno" são o mesmo usuário.
    found = db.scalar(select(User.id).where(User.username == username))
    return found is not None and found != exclude_id


@router.get("/me", response_model=AuthMe)
def me(request: Request, db: Session = Depends(get_db)):
    settings = get_settings()
    if not settings.auth_enabled:
        user = db.get(User, DEFAULT_USER_ID)
        return AuthMe(auth_enabled=False, signup_allowed=False, needs_setup=False, user=user)
    setup = needs_setup(db)
    uid = session_user_id(request)
    return AuthMe(
        auth_enabled=True,
        signup_allowed=settings.auth_allow_signup or setup,
        needs_setup=setup,
        user=db.get(User, uid) if uid is not None else None,
    )


@router.post("/signup", response_model=UserOut, status_code=201)
def signup(data: SignupIn, request: Request, response: Response, db: Session = Depends(get_db)):
    _require_enabled()
    setup = needs_setup(db)
    if not setup and not get_settings().auth_allow_signup:
        raise HTTPException(403, "Cadastro fechado. Peça para um administrador criar sua conta.")
    username = data.username.strip()
    if username_taken(db, username, exclude_id=DEFAULT_USER_ID if setup else None):
        raise HTTPException(409, "Esse nome de usuário já existe")
    display = (data.display_name or "").strip() or username
    if setup:
        user = db.get(User, DEFAULT_USER_ID)
        assert user is not None
        user.username, user.display_name, user.is_admin = username, display, True
        user.password_hash = hash_password(data.password)
    else:
        user = User(username=username, display_name=display, password_hash=hash_password(data.password))
        db.add(user)
        db.flush()
        seed_devices(db, user.id)
    db.commit()
    _set_cookie(response, sessions.create_session(db, user, request.headers.get("user-agent")))
    return user


@router.post("/login", response_model=UserOut)
def login(data: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    _require_enabled()
    username = data.username.strip()
    key = (username.casefold(), request.client.host if request.client else "")
    wait = sessions.throttle.retry_after(key)
    if wait:
        raise HTTPException(429, f"Muitas tentativas. Tente de novo em {wait}s.", headers={"Retry-After": str(wait)})
    user = db.scalar(select(User).where(User.username == username))
    if user is None:
        verify_password(data.password, DUMMY_HASH)
    if user is None or not verify_password(data.password, user.password_hash):
        sessions.throttle.failed(key)
        raise HTTPException(401, "Usuário ou senha incorretos")
    sessions.throttle.succeeded(key)
    _set_cookie(response, sessions.create_session(db, user, request.headers.get("user-agent")))
    return user


@router.post("/logout", status_code=204)
def logout(request: Request, db: Session = Depends(get_db)):
    token = request.cookies.get(sessions.COOKIE)
    if token:
        sessions.end_session(db, token)
    response = Response(status_code=204)
    response.delete_cookie(sessions.COOKIE, path="/")
    return response


@router.post("/password", status_code=204)
def change_password(
    data: PasswordChangeIn, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)
):
    _require_enabled()
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(400, "Senha atual incorreta")
    user.password_hash = hash_password(data.new_password)
    db.commit()
    # Sai das outras sessões (outros navegadores), mantém esta.
    sessions.end_user_sessions(db, user.id, keep_token=request.cookies.get(sessions.COOKIE))
    return Response(status_code=204)
