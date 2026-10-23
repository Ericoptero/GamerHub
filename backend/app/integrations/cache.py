"""Cache dos resultados já normalizados dos providers (tabela provider_cache).

Guarda o resultado de alto nível (lista de candidatos, MetadataPatch) e não as respostas HTTP,
assim cobre também o HLTB, que usa a própria biblioteca. `force=True` ignora a leitura mas grava.
"""

import asyncio
import hashlib
import json
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta, timezone
from typing import TypeVar

from pydantic import BaseModel, TypeAdapter
from sqlalchemy import delete
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app import db as dbmod
from app.models import ProviderCache

T = TypeVar("T")

DAY = 86400
TTL = {
    "search": 1 * DAY,
    "igdb.fetch": 30 * DAY,
    "rawg.fetch": 30 * DAY,
    "hltb.fetch": 14 * DAY,
    "metacritic.fetch": 7 * DAY,
}
EMPTY_TTL = 3 * DAY


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def cache_key(provider: str, op: str, *args: object) -> str:
    raw = json.dumps([provider, op, *args], ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()


def _get(key: str) -> tuple[bool, object]:
    with dbmod.new_session() as db:
        row = db.get(ProviderCache, key)
        if row is None or row.expires_at < _now():
            return False, None
        return True, row.payload


def _put(key: str, provider: str, op: str, payload: object, empty: bool) -> None:
    ttl = EMPTY_TTL if empty else TTL.get(f"{provider}.{op}", TTL.get(op, DAY))
    now = _now()
    values = {
        "key": key,
        "provider": provider,
        "op": op,
        "payload": payload,
        "status": "empty" if empty else "ok",
        "fetched_at": now,
        "expires_at": now + timedelta(seconds=ttl),
    }
    # upsert: dois jogos podem disparar a mesma busca ao mesmo tempo
    stmt = sqlite_insert(ProviderCache).values(**values)
    stmt = stmt.on_conflict_do_update(index_elements=["key"], set_={k: v for k, v in values.items() if k != "key"})
    with dbmod.new_session() as db:
        db.execute(stmt)
        db.commit()


def purge_expired() -> int:
    with dbmod.new_session() as db:
        result = db.execute(delete(ProviderCache).where(ProviderCache.expires_at < _now()))
        db.commit()
        return result.rowcount or 0


async def cached(
    provider: str,
    op: str,
    args: tuple,
    loader: Callable[[], Awaitable[T]],
    type_: type | object,
    *,
    force: bool = False,
) -> T:
    adapter = TypeAdapter(type_)
    key = cache_key(provider, op, *args)
    if not force:
        hit, payload = await asyncio.to_thread(_get, key)
        if hit:
            return adapter.validate_python(payload)
    value = await loader()
    payload = adapter.dump_python(value, mode="json")
    empty = value is None or value == [] or (isinstance(value, BaseModel) and not value.model_dump(exclude_defaults=True))
    await asyncio.to_thread(_put, key, provider, op, payload, empty)
    return value
