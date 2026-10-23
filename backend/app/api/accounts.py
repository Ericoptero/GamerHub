"""Contas de loja do usuário: conectar (Steam pela URL, Epic/GOG pelo código), apelido, sincronizar."""

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import case, func, select, update
from sqlalchemy.orm import Session

from app.auth.deps import current_user
from app.db import get_db
from app.domain import STORE_TAG
from app.enrichment import jobs
from app.integrations.base import ProviderError
from app.library.base import StoreProfile
from app.library.registry import LOGIN_URLS, get_store_client
from app.models import LibraryAccount, LibraryItem, User
from app.schemas import (
    AccountCreate,
    AccountOut,
    AccountPatch,
    AccountReconnect,
    AccountSyncIn,
    JobOut,
    LoginUrlOut,
    StoreName,
)

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


def _counts(db: Session, account_ids: list[int]) -> dict[int, tuple[int, int]]:
    """conta -> (jogos ligados, itens ignorados)."""
    rows = db.execute(
        select(
            LibraryItem.account_id,
            func.count(func.distinct(LibraryItem.game_id)),
            func.sum(case((LibraryItem.ignored.is_(True), 1), else_=0)),
        )
        .where(LibraryItem.account_id.in_(account_ids))
        .group_by(LibraryItem.account_id)
    )
    return {aid: (games or 0, ignored or 0) for aid, games, ignored in rows}


def _out(db: Session, accounts: list[LibraryAccount]) -> list[AccountOut]:
    counts = _counts(db, [a.id for a in accounts])
    return [
        AccountOut.model_validate(a).model_copy(
            update={"game_count": counts.get(a.id, (0, 0))[0], "ignored_count": counts.get(a.id, (0, 0))[1]}
        )
        for a in accounts
    ]


def _account(db: Session, user_id: int, account_id: int) -> LibraryAccount:
    account = db.get(LibraryAccount, account_id)
    if account is None or account.user_id != user_id:
        raise HTTPException(404, "Conta não encontrada")
    return account


async def _connect(store: str, ref: str) -> StoreProfile:
    client = get_store_client(store)
    if not client.enabled:
        raise HTTPException(409, "Configure STEAM_API_KEY no .env para conectar contas Steam")
    try:
        return await client.connect(ref)
    except ProviderError as e:
        raise HTTPException(422, str(e)) from None


@router.get("", response_model=list[AccountOut])
def list_accounts(db: Session = Depends(get_db), user: User = Depends(current_user)):
    q = select(LibraryAccount).where(LibraryAccount.user_id == user.id).order_by(LibraryAccount.store, LibraryAccount.id)
    return _out(db, list(db.scalars(q)))


@router.get("/login-url", response_model=LoginUrlOut)
def login_url(store: StoreName, _user: User = Depends(current_user)):
    if store not in LOGIN_URLS:
        raise HTTPException(404, "Essa loja conecta pela URL do perfil, sem login")
    return LoginUrlOut(url=LOGIN_URLS[store])


@router.post("", response_model=AccountOut, status_code=201)
async def create_account(data: AccountCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    profile = await _connect(data.store, data.ref)
    existing = db.scalar(
        select(LibraryAccount).where(
            LibraryAccount.user_id == user.id,
            LibraryAccount.store == data.store,
            LibraryAccount.external_user_id == profile.external_user_id,
        )
    )
    if existing is not None:
        raise HTTPException(409, f"Essa conta {STORE_TAG[data.store]} já foi adicionada (apelido {existing.nickname!r})")
    account = LibraryAccount(
        user_id=user.id,
        store=data.store,
        nickname=data.nickname.strip(),
        external_user_id=profile.external_user_id,
        display_name=profile.display_name,
        avatar_url=profile.avatar_url,
        profile_url=profile.profile_url,
        credentials=profile.credentials,
        enabled=True,
        status="never",
    )
    db.add(account)
    db.commit()
    jobs.request_library_sync(db, user.id, [account.id], "conta nova")
    return _out(db, [account])[0]


@router.patch("/{account_id}", response_model=AccountOut)
def patch_account(
    account_id: int, data: AccountPatch, db: Session = Depends(get_db), user: User = Depends(current_user)
):
    account = _account(db, user.id, account_id)
    if data.nickname is not None:
        account.nickname = data.nickname.strip()
    if data.enabled is not None:
        account.enabled = data.enabled
    db.commit()
    return _out(db, [account])[0]


@router.post("/{account_id}/reconnect", response_model=AccountOut)
async def reconnect(
    account_id: int, data: AccountReconnect, db: Session = Depends(get_db), user: User = Depends(current_user)
):
    account = _account(db, user.id, account_id)
    profile = await _connect(account.store, data.ref)
    if profile.external_user_id != account.external_user_id:
        who = profile.display_name or profile.external_user_id
        raise HTTPException(409, f"Esse login é de outra conta ({who}). Adicione-a como conta nova.")
    account.credentials = profile.credentials
    account.display_name = profile.display_name or account.display_name
    account.status, account.last_error = "never", None
    db.commit()
    jobs.request_library_sync(db, user.id, [account.id], "reconexão")
    return _out(db, [account])[0]


@router.delete("/{account_id}", status_code=204)
def delete_account(account_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Os jogos continuam na biblioteca; só perdem o selo desta conta."""
    db.delete(_account(db, user.id, account_id))
    db.commit()
    return Response(status_code=204)


@router.post("/sync", response_model=JobOut, status_code=202)
def sync(data: AccountSyncIn | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    ids = (data.account_ids if data else None) or None
    q = select(LibraryAccount).where(LibraryAccount.user_id == user.id)
    if ids is None:
        q = q.where(LibraryAccount.enabled.is_(True), LibraryAccount.status != "reauth")
    else:
        q = q.where(LibraryAccount.id.in_(ids))
    accounts = list(db.scalars(q))
    if ids is not None and len(accounts) != len(set(ids)):
        raise HTTPException(404, "Conta não encontrada")
    if not accounts:
        raise HTTPException(409, "Nenhuma conta para sincronizar")
    return jobs.request_library_sync(db, user.id, [a.id for a in accounts], "manual")


@router.post("/{account_id}/unignore", response_model=AccountOut)
def unignore(account_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Traz de volta os jogos desta conta que foram apagados da biblioteca."""
    account = _account(db, user.id, account_id)
    db.execute(update(LibraryItem).where(LibraryItem.account_id == account.id).values(ignored=False))
    db.commit()
    jobs.request_library_sync(db, user.id, [account.id], "restaurar ignorados")
    return _out(db, [account])[0]
