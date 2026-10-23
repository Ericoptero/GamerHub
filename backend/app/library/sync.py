"""Sincronização das contas de loja: baixa a lista de jogos, casa com a biblioteca e cria o que falta.

Cada conta roda em duas fases para não segurar o SQLite durante a rede (o cache das
integrações escreve por outra sessão e esperaria o lock até estourar o busy_timeout):
1. rede, sem transação aberta: token, lista da loja, ids do IGDB dos itens novos;
2. aplicação numa transação curta.

Um item da loja sem jogo é ligado pela primeira regra que achar, sempre entre os jogos de PC
do mesmo usuário:
1. o mesmo id na mesma loja, em outra conta do usuário (Steam A + Steam B);
2. o mesmo jogo no IGDB (Steam + GOG com nomes diferentes, edições pelo version_parent);
3. o mesmo nome normalizado, desde que o IGDB não diga que são jogos diferentes;
4. senão, cria um jogo novo com status "owned".
Dois ids diferentes da mesma conta nunca caem no mesmo jogo sozinhos ("Ultimate Doom" ≠ "DOOM");
nomes só parecidos viram sugestão de mesclagem na página do jogo.
"""

import asyncio
import logging
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import db as dbmod
from app.domain import STORE_TAG, normalize_title
from app.integrations.base import ProviderError
from app.integrations.igdb import EXTERNAL_SOURCES
from app.integrations.registry import get_provider
from app.library.base import AuthExpired, StoreGame
from app.library.registry import get_store_client
from app.models import ExternalLink, Game, LibraryAccount, LibraryItem, Platform
from app.services.catalog import CatalogCache

log = logging.getLogger(__name__)

PC_IGDB_ID = 6
# Se o nome bate com mais de um jogo (Hades na fila e já finalizado), liga no "mais vivo".
STATUS_PREFERENCE = {"playing": 0, "backlog": 1, "owned": 2, "hype": 3, "dropped": 4, "done": 5}


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def account_label(store: str, nickname: str) -> str:
    return f"{STORE_TAG.get(store, store)} · {nickname}"


@dataclass
class SyncReport:
    account: str
    total: int = 0
    created: list[int] = field(default_factory=list)
    linked: int = 0
    ignored: int = 0

    def line(self) -> str:
        parts = [f"{self.total} na conta", f"{len(self.created)} novos", f"{self.linked} ligados a jogos que você já tinha"]
        if self.ignored:
            parts.append(f"{self.ignored} ignorados")
        return f"{self.account}: " + ", ".join(parts)


@dataclass
class _Snapshot:
    store: str
    nickname: str
    external_user_id: str
    credentials: dict
    known: set[str]


def pc_platform(db: Session, cat: CatalogCache | None = None) -> Platform:
    """Plataforma PC pelo id do IGDB (o usuário pode tê-la renomeado); cria "PC" se não houver."""
    found = db.scalar(
        select(Platform).where(Platform.igdb_platform_id == PC_IGDB_ID).order_by(Platform.sort_order, Platform.id)
    )
    return found or (cat or CatalogCache(db)).platform("PC")


# ---------- fase 1: rede ----------


def _begin(account_id: int) -> _Snapshot:
    with dbmod.new_session() as db:
        account = db.get(LibraryAccount, account_id)
        if account is None:
            raise ProviderError("conta removida")
        account.last_attempt_at = _now()
        db.commit()
        known = set(db.scalars(select(LibraryItem.external_id).where(LibraryItem.account_id == account_id)))
        return _Snapshot(account.store, account.nickname, account.external_user_id, dict(account.credentials), known)


def _store_credentials(account_id: int, credentials: dict) -> None:
    with dbmod.new_session() as db:
        account = db.get(LibraryAccount, account_id)
        if account is not None:
            account.credentials = credentials
            db.commit()


def _fail(account_id: int, status: str, message: str) -> None:
    with dbmod.new_session() as db:
        account = db.get(LibraryAccount, account_id)
        if account is not None:
            account.status = status
            account.last_error = message
            db.commit()


async def _igdb_ids(store: str, uids: list[str]) -> dict[str, int]:
    igdb = get_provider("igdb")
    if not uids or store not in EXTERNAL_SOURCES or not igdb.enabled:
        return {}
    try:
        return await igdb.lookup_external(EXTERNAL_SOURCES[store], uids)  # type: ignore[attr-defined]
    except ProviderError as e:
        log.warning("IGDB external_games falhou (%s); a sync segue só com os nomes", e)
        return {}


async def sync_account(account_id: int) -> SyncReport:
    snap = await asyncio.to_thread(_begin, account_id)
    client = get_store_client(snap.store)

    async def save(credentials: dict) -> None:
        await asyncio.to_thread(_store_credentials, account_id, credentials)

    try:
        games = await client.fetch_library(snap.external_user_id, snap.credentials, save, snap.known)
        igdb_ids = await _igdb_ids(snap.store, [g.external_id for g in games if g.external_id not in snap.known])
    except AuthExpired as e:
        await asyncio.to_thread(_fail, account_id, "reauth", f"{e} — reconecte a conta")
        raise
    except ProviderError as e:
        await asyncio.to_thread(_fail, account_id, "error", str(e))
        raise
    return await asyncio.to_thread(apply_library, account_id, games, igdb_ids)


# ---------- fase 2: aplicação ----------


class _Resolver:
    def __init__(self, db: Session, account: LibraryAccount):
        self.db, self.account = db, account
        cat = CatalogCache(db)
        self.pc = pc_platform(db, cat)
        self.tag = cat.store(STORE_TAG[account.store])
        games = db.scalars(select(Game).where(Game.user_id == account.user_id, Game.platform_id == self.pc.id)).all()
        by_id = {g.id: g for g in games}
        self.by_name: dict[str, list[Game]] = defaultdict(list)
        for g in games:
            self.by_name[g.name_norm].append(g)
        self.igdb_of: dict[int, int] = {}
        self.by_igdb: dict[int, list[Game]] = defaultdict(list)
        links = db.execute(
            select(ExternalLink.game_id, ExternalLink.external_id).where(
                ExternalLink.game_id.in_(by_id),
                ExternalLink.provider == "igdb",
                ExternalLink.status.in_(("matched", "confirmed")),
            )
        )
        for gid, ext in links:
            if ext and ext.isdigit():
                self.igdb_of[gid] = int(ext)
                self.by_igdb[int(ext)].append(by_id[gid])
        # Mesma loja, outras contas do usuário: id da loja -> (jogo, ignorado em alguma delas).
        self.same_store: dict[str, tuple[int | None, bool]] = {}
        rows = db.execute(
            select(LibraryItem.external_id, LibraryItem.game_id, LibraryItem.ignored)
            .join(LibraryAccount, LibraryAccount.id == LibraryItem.account_id)
            .where(
                LibraryAccount.user_id == account.user_id,
                LibraryAccount.store == account.store,
                LibraryAccount.id != account.id,
            )
        )
        for ext, gid, ignored in rows:
            prev_gid, prev_ignored = self.same_store.get(ext, (None, False))
            self.same_store[ext] = (prev_gid or gid, prev_ignored or ignored)
        # Jogos que já têm um item desta conta: outro id desta conta não cai neles.
        self.claimed: set[int] = set(
            db.scalars(
                select(LibraryItem.game_id).where(
                    LibraryItem.account_id == account.id, LibraryItem.game_id.is_not(None)
                )
            )
        )

    def _pick(self, candidates: list[Game]) -> Game | None:
        free = [g for g in candidates if g.id not in self.claimed]
        return min(free, key=lambda g: (STATUS_PREFERENCE.get(g.status, 9), g.id), default=None)

    def _link(self, item: LibraryItem, game: Game) -> None:
        item.game_id = game.id
        self.claimed.add(game.id)
        # A etiqueta entra só quando o item é ligado: se o usuário a tirar depois, não volta.
        if self.tag not in game.stores:
            game.stores.append(self.tag)

    def resolve(self, item: LibraryItem, report: SyncReport) -> None:
        other_gid, other_ignored = self.same_store.get(item.external_id, (None, False))
        if other_gid is not None:
            game = self.db.get(Game, other_gid)
            if game is not None:
                self._link(item, game)
                report.linked += 1
                return
        if other_ignored:
            item.ignored = True
            report.ignored += 1
            return

        game = self._pick(self.by_igdb.get(item.igdb_id, [])) if item.igdb_id else None
        if game is None:
            same_name = [
                g
                for g in self.by_name.get(normalize_title(item.name), [])
                if not (item.igdb_id and self.igdb_of.get(g.id, item.igdb_id) != item.igdb_id)
            ]
            game = self._pick(same_name)
        if game is not None:
            self._link(item, game)
            report.linked += 1
            return

        game = Game(
            user_id=self.account.user_id,
            name=item.name,
            name_norm=normalize_title(item.name),
            platform=self.pc,
            status="owned",
            origin=self.account.store,
            cover_url=item.cover_url,
            tags=[],
            locked_fields=[],
        )
        game.stores = [self.tag]
        self.db.add(game)
        self.db.flush()
        if item.igdb_id:
            # Já sabemos qual é no IGDB: o enriquecimento usa este link em vez de buscar pelo nome.
            self.db.add(
                ExternalLink(game_id=game.id, provider="igdb", external_id=str(item.igdb_id), status="matched", candidates=[])
            )
            self.igdb_of[game.id] = item.igdb_id
            self.by_igdb[item.igdb_id].append(game)
        self.by_name[game.name_norm].append(game)
        item.game_id = game.id
        self.claimed.add(game.id)
        report.created.append(game.id)


def update_played_hours(db: Session, game_ids: set[int]) -> None:
    """Horas jogadas = soma das contas, enquanto o usuário não digitou o valor (nem travou o campo)."""
    if not game_ids:
        return
    sums = db.execute(
        select(LibraryItem.game_id, func.sum(LibraryItem.playtime_minutes))
        .where(LibraryItem.game_id.in_(game_ids), LibraryItem.ignored.is_(False))
        .group_by(LibraryItem.game_id)
    ).all()
    for gid, minutes in sums:
        game = db.get(Game, gid)
        if game is None or not minutes or "played_hours" in (game.locked_fields or []):
            continue
        if game.played_hours_source == "user" or (game.played_hours_source is None and game.played_hours is not None):
            continue
        game.played_hours = round(minutes / 60, 1)
        game.played_hours_source = "store"


def apply_library(account_id: int, games: list[StoreGame], igdb_ids: dict[str, int]) -> SyncReport:
    with dbmod.new_session() as db:
        account = db.get(LibraryAccount, account_id)
        if account is None:
            raise ProviderError("conta removida durante a sincronização")
        now = _now()
        items = {i.external_id: i for i in db.scalars(select(LibraryItem).where(LibraryItem.account_id == account.id))}
        for g in games:
            item = items.get(g.external_id)
            if item is None:
                item = LibraryItem(
                    account_id=account.id,
                    external_id=g.external_id,
                    name=g.name or g.external_id,
                    ignored=False,
                    first_seen_at=now,
                    last_seen_at=now,
                )
                db.add(item)
                items[g.external_id] = item
            if g.name:
                item.name = g.name
            if g.playtime_minutes is not None:
                item.playtime_minutes = g.playtime_minutes
            item.last_played_at = g.last_played_at or item.last_played_at
            item.cover_url = g.cover_url or item.cover_url
            item.url = g.url or item.url
            item.igdb_id = igdb_ids.get(g.external_id, item.igdb_id)
            item.last_seen_at = now
        db.flush()

        report = SyncReport(account=account_label(account.store, account.nickname), total=len(games))
        resolver = _Resolver(db, account)
        # Itens que sumiram da loja (reembolso, conta compartilhada) ficam como estão.
        for g in games:
            item = items[g.external_id]
            if item.ignored:
                report.ignored += 1
            elif item.game_id is None:
                resolver.resolve(item, report)
        update_played_hours(db, {i.game_id for i in items.values() if i.game_id is not None})
        account.status, account.last_sync_at, account.last_error = "ok", now, None
        db.commit()
        return report


# ---------- job ----------


def _labels(account_ids: list[int]) -> dict[int, str]:
    with dbmod.new_session() as db:
        rows = db.execute(
            select(LibraryAccount.id, LibraryAccount.store, LibraryAccount.nickname).where(
                LibraryAccount.id.in_(account_ids)
            )
        )
        return {aid: account_label(store, nick) for aid, store, nick in rows}


def _enrich(user_id: int, game_ids: list[int]) -> int:
    from app.enrichment import jobs
    from app.schemas import EnrichIn

    with dbmod.new_session() as db:
        return jobs.request_enrich(db, user_id, EnrichIn(game_ids=game_ids)).id


async def run_library_sync(job_id: int, user_id: int, params: dict) -> None:
    """Sincroniza as contas do job, uma de cada vez, e põe os metadados dos jogos novos na fila."""
    from app.enrichment import jobs

    account_ids = list(params.get("account_ids") or [])
    done = set(params.get("done") or [])
    labels = await asyncio.to_thread(_labels, account_ids)
    for account_id in account_ids:
        if account_id in done:
            continue
        if await asyncio.to_thread(jobs._status, job_id) == "cancelled":
            break
        label = labels.get(account_id, f"conta {account_id}")
        try:
            report = await sync_account(account_id)
            ok, line = True, report.line()
            if report.created:
                # Já aqui (e não no fim do job): se o processo cair depois, os novos não ficam sem metadados.
                enrich_id = await asyncio.to_thread(_enrich, user_id, report.created)
                line += f" · metadados na fila (job #{enrich_id})"
        except ProviderError as e:
            ok, line = False, f"{label}: {e}"
        except Exception as e:  # noqa: BLE001
            log.exception("sincronização da conta %s falhou", account_id)
            await asyncio.to_thread(_fail, account_id, "error", "erro inesperado; veja os logs do container")
            ok, line = False, f"{label}: erro inesperado ({type(e).__name__})"
        await asyncio.to_thread(jobs._progress, job_id, account_id, ok, line)
    await asyncio.to_thread(jobs._finish, job_id, "done")
