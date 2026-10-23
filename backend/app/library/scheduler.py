"""Checagem diária das contas de loja: uma vez por dia, a partir de LIBRARY_SYNC_HOUR (hora local)."""

import asyncio
import logging
from collections.abc import Iterable
from datetime import datetime, timezone

from sqlalchemy import select

from app import db as dbmod
from app.config import get_settings
from app.models import LibraryAccount

log = logging.getLogger(__name__)

CHECK_EVERY = 1800  # segundos


def due_accounts(accounts: Iterable[LibraryAccount], now: datetime, hour: int) -> dict[int, list[int]]:
    """Contas que ainda não foram checadas hoje, agrupadas por usuário.

    `now` tem fuso (hora local do servidor). `last_attempt_at` é UTC sem fuso, como tudo no banco.
    Contas desligadas ou esperando reconexão ficam de fora.
    """
    if now.hour < hour:
        return {}
    today = now.date()
    due: dict[int, list[int]] = {}
    for a in accounts:
        if not a.enabled or a.status == "reauth":
            continue
        last = a.last_attempt_at
        if last is not None and last.replace(tzinfo=timezone.utc).astimezone(now.tzinfo).date() >= today:
            continue
        due.setdefault(a.user_id, []).append(a.id)
    return due


def queue_due_syncs(now: datetime | None = None) -> int:
    """Cria um job de sincronização por usuário com contas pendentes. Retorna quantos criou."""
    from app.enrichment.jobs import request_library_sync

    now = now or datetime.now().astimezone()
    with dbmod.new_session() as db:
        accounts = db.scalars(select(LibraryAccount)).all()
        due = due_accounts(accounts, now, get_settings().library_sync_hour)
        stamp = now.astimezone(timezone.utc).replace(tzinfo=None)
        queued = {aid for ids in due.values() for aid in ids}
        for a in accounts:
            if a.id in queued:
                # Marca já na fila: a próxima checagem (meia hora depois) não pede de novo.
                a.last_attempt_at = stamp
        db.commit()
        for user_id, account_ids in due.items():
            request_library_sync(db, user_id, account_ids, "checagem diária")
    return len(due)


async def daily_library_sync_loop() -> None:
    """Roda no lifespan do app, como o backup diário."""
    while True:
        try:
            created = await asyncio.to_thread(queue_due_syncs)
            if created:
                log.info("checagem diária: %s sincronização(ões) de contas na fila", created)
        except Exception:  # noqa: BLE001
            log.exception("checagem diária das contas falhou")
        await asyncio.sleep(CHECK_EVERY)
