from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.deps import current_user, require_admin
from app.db import get_db
from app.domain import DEVICE_KINDS, PRIORITY_LABELS, STATUS_LABELS, STATUS_SINGULAR, fold
from app.config import get_settings
from app.integrations.registry import providers_status
from app.library.registry import stores_status
from app.models import Device, Game, Genre, Platform, Store, User
from app.schemas import (
    DeviceIn,
    DeviceOut,
    DevicePatch,
    GenreOut,
    Meta,
    PlatformIn,
    PlatformOut,
    PlatformPatch,
    StoreIn,
    StoreOut,
)

router = APIRouter(prefix="/api", tags=["catalog"])


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/meta", response_model=Meta)
def meta():
    return Meta(
        statuses=STATUS_LABELS,
        statuses_singular=STATUS_SINGULAR,
        priorities=PRIORITY_LABELS,
        device_kinds=list(DEVICE_KINDS),
        providers=providers_status(),
        stores=stores_status(),
        library_sync_hour=get_settings().library_sync_hour,
    )


# ---------- plataformas ----------


# Plataformas são compartilhadas entre usuários; a contagem mostrada é a de jogos de quem pergunta.
def _platform_out(db: Session, user_id: int, p: Platform) -> PlatformOut:
    count = db.scalar(select(func.count(Game.id)).where(Game.platform_id == p.id, Game.user_id == user_id)) or 0
    return PlatformOut.model_validate(p).model_copy(update={"game_count": count})


@router.get("/platforms", response_model=list[PlatformOut])
def list_platforms(db: Session = Depends(get_db), user: User = Depends(current_user)):
    counts = dict(
        db.execute(
            select(Game.platform_id, func.count(Game.id)).where(Game.user_id == user.id).group_by(Game.platform_id)
        ).all()
    )
    platforms = db.scalars(select(Platform).order_by(Platform.name)).all()
    return [PlatformOut.model_validate(p).model_copy(update={"game_count": counts.get(p.id, 0)}) for p in platforms]


def _ensure_unique_platform(db: Session, name: str, exclude_id: int | None = None) -> None:
    for p in db.scalars(select(Platform)):
        if p.id != exclude_id and fold(p.name) == fold(name):
            raise HTTPException(409, f"Já existe a plataforma {p.name!r}")


@router.post("/platforms", response_model=PlatformOut, status_code=201)
def create_platform(data: PlatformIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_unique_platform(db, data.name)
    order = (db.scalar(select(func.max(Platform.sort_order))) or 0) + 1
    p = Platform(**data.model_dump() | {"name": data.name.strip()}, sort_order=order)
    db.add(p)
    db.commit()
    return _platform_out(db, user.id, p)


@router.patch("/platforms/{platform_id}", response_model=PlatformOut)
def patch_platform(
    platform_id: int, data: PlatformPatch, db: Session = Depends(get_db), user: User = Depends(current_user)
):
    p = db.get(Platform, platform_id)
    if p is None:
        raise HTTPException(404, "Plataforma não encontrada")
    for field in data.model_fields_set:
        value = getattr(data, field)
        if field == "name":
            if not value:
                continue
            value = value.strip()
            _ensure_unique_platform(db, value, exclude_id=p.id)
        setattr(p, field, value)
    db.commit()
    return _platform_out(db, user.id, p)


@router.delete("/platforms/{platform_id}", status_code=204)
def delete_platform(platform_id: int, db: Session = Depends(get_db), _user: User = Depends(current_user)):
    p = db.get(Platform, platform_id)
    if p is None:
        raise HTTPException(404, "Plataforma não encontrada")
    # Conta os jogos de todos os usuários: a plataforma é de todos.
    count = db.scalar(select(func.count(Game.id)).where(Game.platform_id == p.id)) or 0
    if count:
        raise HTTPException(409, f"{count} jogo(s) usam {p.name}. Mude a plataforma deles antes de remover.")
    db.delete(p)
    db.commit()
    return Response(status_code=204)


# ---------- aparelhos ----------


def _device_out(d: Device) -> DeviceOut:
    return DeviceOut(id=d.id, name=d.name, kind=d.kind, platform_ids=[p.id for p in d.platforms])


def _platforms(db: Session, ids: list[int]) -> list[Platform]:
    found = db.scalars(select(Platform).where(Platform.id.in_(ids))).all() if ids else []
    if len(found) != len(set(ids)):
        raise HTTPException(422, "Plataforma inexistente na lista")
    return list(found)


def _device(db: Session, user_id: int, device_id: int) -> Device:
    d = db.get(Device, device_id)
    if d is None or d.user_id != user_id:
        raise HTTPException(404, "Aparelho não encontrado")
    return d


@router.get("/devices", response_model=list[DeviceOut])
def list_devices(db: Session = Depends(get_db), user: User = Depends(current_user)):
    q = select(Device).where(Device.user_id == user.id).order_by(Device.sort_order, Device.id)
    return [_device_out(d) for d in db.scalars(q)]


@router.post("/devices", response_model=DeviceOut, status_code=201)
def create_device(data: DeviceIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    order = (db.scalar(select(func.max(Device.sort_order)).where(Device.user_id == user.id)) or 0) + 1
    d = Device(
        user_id=user.id,
        name=data.name.strip(),
        kind=data.kind,
        sort_order=order,
        platforms=_platforms(db, data.platform_ids),
    )
    db.add(d)
    db.commit()
    return _device_out(d)


@router.patch("/devices/{device_id}", response_model=DeviceOut)
def patch_device(device_id: int, data: DevicePatch, db: Session = Depends(get_db), user: User = Depends(current_user)):
    d = _device(db, user.id, device_id)
    if data.name:
        d.name = data.name.strip()
    if data.kind:
        d.kind = data.kind
    if data.platform_ids is not None:
        d.platforms = _platforms(db, data.platform_ids)
    db.commit()
    return _device_out(d)


@router.delete("/devices/{device_id}", status_code=204)
def delete_device(device_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    d = _device(db, user.id, device_id)
    db.delete(d)
    db.commit()
    return Response(status_code=204)


# ---------- lojas e gêneros ----------


@router.get("/stores", response_model=list[StoreOut])
def list_stores(db: Session = Depends(get_db)):
    return db.scalars(select(Store).order_by(Store.name)).all()


@router.post("/stores", response_model=StoreOut, status_code=201)
def create_store(data: StoreIn, db: Session = Depends(get_db)):
    s = Store(name=data.name.strip())
    db.add(s)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Loja já existe") from None
    return s


@router.delete("/stores/{store_id}", status_code=204)
def delete_store(store_id: int, db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    """Lojas são compartilhadas: remover tira a etiqueta dos jogos de todo mundo."""
    s = db.get(Store, store_id)
    if s is None:
        raise HTTPException(404, "Loja não encontrada")
    db.delete(s)
    db.commit()
    return Response(status_code=204)


@router.get("/genres", response_model=list[GenreOut])
def list_genres(db: Session = Depends(get_db)):
    return db.scalars(select(Genre).order_by(Genre.sort_order, Genre.name)).all()
