"""Configurações: as chaves de API do servidor (só admin) e o perfil do próprio usuário."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.auth import check_username
from app.auth.deps import current_user, require_admin
from app.db import get_db
from app.integrations.base import ProviderError
from app.integrations.registry import get_provider
from app.library.registry import get_store_client
from app.models import User
from app.schemas import ApiKeysIn, ApiKeysOut, ApiKeyState, KeyTestIn, KeyTestOut, ProfilePatch, UserOut
from app.services import api_keys

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _keys_out(keys: api_keys.ApiKeys) -> ApiKeysOut:
    return ApiKeysOut(
        **{
            name: ApiKeyState(configured=bool(getattr(keys, name)), preview=api_keys.preview(getattr(keys, name)))
            for name in api_keys.KEY_NAMES
        }
    )


@router.get("/keys", response_model=ApiKeysOut)
def get_keys(_a: User = Depends(require_admin)):
    return _keys_out(api_keys.current())


@router.put("/keys", response_model=ApiKeysOut)
def put_keys(data: ApiKeysIn, db: Session = Depends(get_db), _a: User = Depends(require_admin)):
    return _keys_out(api_keys.save(db, data.model_dump(exclude_unset=True)))


@router.post("/keys/test", response_model=KeyTestOut)
async def test_key(data: KeyTestIn, _a: User = Depends(require_admin)):
    """Testa a chave salva (não a digitada): a tela salva antes de testar."""
    client = get_store_client("steam") if data.provider == "steam" else get_provider(data.provider)
    try:
        message = await client.check()  # type: ignore[attr-defined]
    except ProviderError as e:
        return KeyTestOut(ok=False, message=str(e))
    return KeyTestOut(ok=True, message=message)


@router.get("/profile", response_model=UserOut)
def get_profile(user: User = Depends(current_user)):
    return user


@router.patch("/profile", response_model=UserOut)
def patch_profile(data: ProfilePatch, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if data.username is not None:
        username = data.username.strip()
        if username != user.username:
            check_username(db, username, exclude_id=user.id)
            user.username = username
    if data.display_name is not None:
        user.display_name = data.display_name.strip() or user.username
    if data.public_page is not None:
        user.public_page = data.public_page
    db.commit()
    return user
