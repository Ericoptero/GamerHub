"""Chaves de API do servidor (IGDB, RAWG, Metacritic, Steam), guardadas no banco e editadas na tela de
Configurações. Um conjunto só para todos os usuários.

O .env só serve para a primeira carga: cada chave preenchida lá é copiada uma vez, se o banco ainda não
tiver aquela chave. Apagar pela tela grava vazio, então ela não volta do .env no próximo início.
"""

import logging
from dataclasses import dataclass, fields
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import AppSetting

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class ApiKeys:
    igdb_client_id: str = ""
    igdb_client_secret: str = ""
    rawg_api_key: str = ""
    metacritic_api_key: str = ""
    steam_api_key: str = ""


KEY_NAMES = tuple(f.name for f in fields(ApiKeys))

_current = ApiKeys()


def current() -> ApiKeys:
    """Chaves em uso (em memória; `load` relê do banco)."""
    return _current


def set_current(keys: ApiKeys) -> None:
    """Usado pelos testes (e por `load`)."""
    global _current
    _current = keys


def load(db: Session) -> ApiKeys:
    rows = {k: v for k, v in db.execute(select(AppSetting.key, AppSetting.value).where(AppSetting.key.in_(KEY_NAMES)))}
    set_current(ApiKeys(**{k: rows.get(k) or "" for k in KEY_NAMES}))
    return _current


def import_from_env(db: Session, settings: Settings) -> list[str]:
    """Copia do .env as chaves que o banco ainda não tem. Devolve os nomes copiados."""
    known = set(db.scalars(select(AppSetting.key).where(AppSetting.key.in_(KEY_NAMES))))
    copied = []
    for name in KEY_NAMES:
        value = (getattr(settings, name) or "").strip()
        if value and name not in known:
            db.add(AppSetting(key=name, value=value))
            copied.append(name)
    if copied:
        db.commit()
    return copied


def startup(db: Session, settings: Settings) -> ApiKeys:
    copied = import_from_env(db, settings)
    if copied:
        log.info("chaves copiadas do .env para o banco: %s (agora edite em Configurações)", ", ".join(copied))
    return load(db)


def save(db: Session, patch: dict[str, str | None]) -> ApiKeys:
    """Grava as chaves informadas (None = não mexe, "" = apaga) e aplica nos clientes em uso."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for name, value in patch.items():
        if name not in KEY_NAMES or value is None:
            continue
        value = value.strip()
        row = db.get(AppSetting, name)
        if row is None:
            db.add(AppSetting(key=name, value=value, updated_at=now))
        elif row.value != value:
            row.value, row.updated_at = value, now
    db.commit()
    keys = load(db)
    apply_to_clients(keys)
    return keys


def apply_to_clients(keys: ApiKeys) -> None:
    from app.integrations import registry as providers
    from app.library import registry as stores

    providers.apply_keys(keys)
    stores.apply_keys(keys)


def preview(value: str) -> str | None:
    """Só o fim da chave, para a pessoa reconhecer qual está salva."""
    if not value:
        return None
    return "••••" + value[-4:] if len(value) > 8 else "••••"
