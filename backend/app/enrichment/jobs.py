"""Jobs persistidos (tabela jobs) e a fila asyncio que os executa dentro do processo.

Tipos: "refresh"/"enrich" (metadados dos jogos) e "library_sync" (contas de loja).
Um job por vez em cada faixa (interativa, lote e sincronização); dentro de um job de
metadados, até 3 jogos em paralelo.
Os ids já processados ficam em params["done"], então um job interrompido por restart
continua de onde parou.
"""

import asyncio
import itertools
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app import db as dbmod
from app.enrichment.orchestrator import enrich_game
from app.models import ExternalLink, Game, Job
from app.schemas import EnrichIn, RefreshIn

log = logging.getLogger(__name__)

GAMES_IN_PARALLEL = 3
LOG_LINES = 50
REFRESH_PRIORITY = 0
SYNC_PRIORITY = 3
BATCH_PRIORITY = 5
SYNC_KIND = "library_sync"


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Worker:
    """Três faixas: jobs interativos (atualizar um jogo, confirmar link) não esperam o lote, e a
    sincronização das contas de loja não espera nenhum dos dois.

    Cada faixa roda um job por vez; os limites de taxa dos providers são compartilhados.
    """

    def __init__(self) -> None:
        self._queues: dict[str, asyncio.PriorityQueue] = {}
        self._loop: asyncio.AbstractEventLoop | None = None
        self._tasks: list[asyncio.Task] = []
        self._seq = itertools.count()

    @staticmethod
    def _lane(kind: str, priority: int) -> str:
        if kind == SYNC_KIND:
            return "sync"
        return "interactive" if priority < BATCH_PRIORITY else "batch"

    @property
    def running(self) -> bool:
        return any(not t.done() for t in self._tasks)

    def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        self._queues = {lane: asyncio.PriorityQueue() for lane in ("interactive", "batch", "sync")}
        with dbmod.new_session() as db:
            pending = db.scalars(
                select(Job).where(Job.status.in_(("queued", "running"))).order_by(Job.priority, Job.id)
            ).all()
            for job in pending:
                job.status = "queued"
                self._queues[self._lane(job.kind, job.priority)].put_nowait((job.priority, next(self._seq), job.id))
            db.commit()
        self._tasks = [
            asyncio.create_task(self._run(q), name=f"enrichment-{lane}") for lane, q in self._queues.items()
        ]

    def submit(self, job_id: int, priority: int, kind: str = "enrich") -> None:
        """Pode ser chamado de threads (endpoints síncronos do FastAPI)."""
        if self._loop is None or not self._queues:
            return
        queue = self._queues[self._lane(kind, priority)]
        self._loop.call_soon_threadsafe(queue.put_nowait, (priority, next(self._seq), job_id))

    async def _run(self, queue: asyncio.PriorityQueue) -> None:
        while True:
            _prio, _seq, job_id = await queue.get()
            try:
                await run_job(job_id)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                log.exception("job %s falhou", job_id)
                await asyncio.to_thread(_finish, job_id, "failed", "erro inesperado; veja os logs do container")

    async def stop(self) -> None:
        for task in self._tasks:
            task.cancel()
        for task in self._tasks:
            try:
                await task
            except asyncio.CancelledError:
                pass
        self._tasks = []
        self._queues = {}
        self._loop = None


worker = Worker()


# ---------- criação ----------


def _create(db: Session, user_id: int, kind: str, params: dict, priority: int, total: int) -> Job:
    job = Job(user_id=user_id, kind=kind, status="queued", priority=priority, params=params, total=total, log=[])
    db.add(job)
    db.commit()
    worker.submit(job.id, priority, kind)
    return job


def request_refresh(db: Session, game: Game, data: RefreshIn) -> Job:
    params = {
        "game_ids": [game.id],
        "providers": data.providers,
        "force": data.force,
        "rematch": data.rematch,
        "done": [],
    }
    return _create(db, game.user_id, "refresh", params, REFRESH_PRIORITY, 1)


def select_game_ids(db: Session, user_id: int, data: EnrichIn) -> list[int]:
    mine = select(Game.id).where(Game.user_id == user_id).order_by(Game.id)
    if data.game_ids:
        return list(db.scalars(mine.where(Game.id.in_(data.game_ids))))
    q = mine
    if data.scope == "missing":
        q = q.where(Game.last_enriched_at.is_(None))
    elif data.scope == "stale":
        q = q.where(or_(Game.last_enriched_at.is_(None), Game.last_enriched_at < _now() - timedelta(days=30)))
    return list(db.scalars(q))


def request_enrich(db: Session, user_id: int, data: EnrichIn) -> Job:
    ids = select_game_ids(db, user_id, data)
    params = {"game_ids": ids, "providers": data.providers, "force": data.force, "rematch": False, "done": []}
    return _create(db, user_id, "enrich", params, BATCH_PRIORITY, len(ids))


def request_library_sync(db: Session, user_id: int, account_ids: list[int], reason: str) -> Job:
    """Sincroniza contas de loja. Um pedido igual que ainda está na fila é reaproveitado."""
    ids = sorted(set(account_ids))
    queued = db.scalars(
        select(Job).where(Job.user_id == user_id, Job.kind == SYNC_KIND, Job.status == "queued")
    ).all()
    for job in queued:
        if sorted(job.params.get("account_ids") or []) == ids:
            return job
    params = {"account_ids": ids, "reason": reason, "done": []}
    return _create(db, user_id, SYNC_KIND, params, SYNC_PRIORITY, len(ids))


def set_link(db: Session, game: Game, provider: str, external_id: str | None, status: str) -> None:
    link = db.scalar(select(ExternalLink).where(ExternalLink.game_id == game.id, ExternalLink.provider == provider))
    if link is None:
        link = ExternalLink(game_id=game.id, provider=provider, candidates=[], status=status)
        db.add(link)
    chosen = next((c for c in link.candidates or [] if c.get("external_id") == external_id), None)
    link.status = status
    link.external_id = external_id
    link.matched_name = chosen.get("name") if chosen else None
    link.match_score = chosen.get("score") if chosen else None
    link.external_url = chosen.get("url") if chosen else None
    link.last_error = None
    db.commit()


def link_and_refresh(db: Session, game: Game, provider: str, external_id: str) -> Job:
    set_link(db, game, provider, external_id, "confirmed")
    return request_refresh(db, game, RefreshIn(force=False))


def cancel(db: Session, job: Job) -> Job:
    if job.status in ("queued", "running"):
        job.status = "cancelled"
        job.finished_at = _now()
        db.commit()
    return job


# ---------- execução ----------


def _load(job_id: int) -> tuple[str, int, dict] | None:
    """Marca o job como rodando e devolve (tipo, dono, parâmetros)."""
    with dbmod.new_session() as db:
        job = db.get(Job, job_id)
        if job is None or job.status not in ("queued", "running"):
            return None
        job.status = "running"
        job.started_at = job.started_at or _now()
        db.commit()
        return job.kind, job.user_id, dict(job.params)


def _status(job_id: int) -> str | None:
    with dbmod.new_session() as db:
        job = db.get(Job, job_id)
        return job.status if job else None


def _progress(job_id: int, item_id: int, ok: bool, line: str) -> None:
    """Conta um item (jogo ou conta de loja) como processado; os ids feitos ficam em params["done"]."""
    with dbmod.new_session() as db:
        job = db.get(Job, job_id)
        if job is None:
            return
        job.processed += 1
        if ok:
            job.succeeded += 1
        else:
            job.failed += 1
        job.params = {**job.params, "done": [*job.params.get("done", []), item_id]}
        job.log = [*(job.log or []), line][-LOG_LINES:]
        db.commit()


def _finish(job_id: int, status: str, error: str | None = None) -> None:
    with dbmod.new_session() as db:
        job = db.get(Job, job_id)
        if job is None:
            return
        if job.status != "cancelled":
            job.status = status
        job.error = error
        job.finished_at = job.finished_at or _now()
        db.commit()


async def run_job(job_id: int) -> None:
    loaded = await asyncio.to_thread(_load, job_id)
    if loaded is None:
        return
    kind, user_id, params = loaded
    if kind == SYNC_KIND:
        from app.library.sync import run_library_sync

        await run_library_sync(job_id, user_id, params)
        return
    done = set(params.get("done") or [])
    pending = [g for g in params.get("game_ids") or [] if g not in done]
    sem = asyncio.Semaphore(GAMES_IN_PARALLEL)

    async def one(game_id: int) -> None:
        async with sem:
            if await asyncio.to_thread(_status, job_id) == "cancelled":
                return
            try:
                line, results = await enrich_game(
                    game_id,
                    params.get("providers"),
                    force=bool(params.get("force")),
                    rematch=bool(params.get("rematch")),
                )
                ok = not any(r.status == "error" for r in results.values())
            except Exception as e:  # noqa: BLE001
                log.exception("enriquecimento do jogo %s falhou", game_id)
                line, ok = f"jogo {game_id}: erro inesperado ({type(e).__name__})", False
            await asyncio.to_thread(_progress, job_id, game_id, ok, line)

    await asyncio.gather(*(one(g) for g in pending))
    await asyncio.to_thread(_finish, job_id, "done")
