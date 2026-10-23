from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.deps import current_user
from app.db import get_db
from app.domain import PROVIDERS, fold, normalize_title
from app.enrichment import jobs
from app.integrations.base import Candidate, MatchContext, ProviderError
from app.integrations.cache import cached
from app.integrations.matching import display_score, rank
from app.integrations.registry import get_provider, providers_status
from app.models import ExternalLink, Game, Job, Platform, User
from app.schemas import (
    CandidateOut,
    EnrichIn,
    JobOut,
    LinkConfirmIn,
    LinkOut,
    PendingLinkOut,
    ProvidersStatus,
    RefreshIn,
    SearchProvider,
)
from app.seed.seed_data import suggest_genre
from app.services.games import get_game

router = APIRouter(prefix="/api", tags=["integrations"])


@router.get("/integrations/status", response_model=ProvidersStatus)
def status():
    return providers_status()


@router.get("/integrations/search", response_model=list[CandidateOut])
async def search(
    provider: SearchProvider,
    q: str = Query(min_length=2, max_length=200),
    platform_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    prov = get_provider(provider)
    if not prov.enabled:
        raise HTTPException(409, f"{provider.upper()} não configurado (veja o .env)")
    platform = db.get(Platform, platform_id) if platform_id else None
    ctx = MatchContext(
        name=q,
        platform=platform.name if platform else None,
        igdb_platform_id=platform.igdb_platform_id if platform else None,
        rawg_platform_id=platform.rawg_platform_id if platform else None,
    )
    try:
        found = await cached(provider, "search", (q, ctx.platform), lambda: prov.search(q, ctx), list[Candidate])
    except ProviderError as e:
        raise HTTPException(502, str(e)) from None
    candidates = rank(found, ctx)
    local = db.scalars(select(Platform)).all()

    def runs_on(c: Candidate) -> list[int]:
        names = {fold(n) for n in c.platforms}
        out = []
        for p in local:
            native = p.igdb_platform_id if c.provider == "igdb" else p.rawg_platform_id
            if (native and native in c.platform_ids) or any(
                n and fold(n) in names for n in (p.name, p.metacritic_name, p.hltb_name)
            ):
                out.append(p.id)
        return out

    names: dict[str, list[int]] = {}
    for gid, norm in db.execute(select(Game.id, Game.name_norm).where(Game.user_id == user.id)):
        names.setdefault(norm, []).append(gid)
    return [
        CandidateOut(
            provider=c.provider,
            external_id=c.external_id,
            name=c.name,
            year=c.year,
            platforms=c.platforms,
            cover_thumb=c.cover_thumb,
            kind=c.kind,
            score=display_score(c.score),
            genres=c.genres,
            suggested_genre=suggest_genre(c.genres),
            in_library=names.get(normalize_title(c.name), []),
            local_platform_ids=runs_on(c),
        )
        for c in candidates
    ]


@router.get("/integrations/pending", response_model=list[PendingLinkOut])
def pending(provider: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    q = (
        select(ExternalLink, Game)
        .join(Game, Game.id == ExternalLink.game_id)
        .where(Game.user_id == user.id, ExternalLink.status.in_(("ambiguous", "not_found", "error")))
        .order_by(Game.name)
    )
    if provider:
        q = q.where(ExternalLink.provider == provider)
    return [
        PendingLinkOut(
            game_id=g.id,
            game_name=g.name,
            platform=g.platform.name,
            provider=lk.provider,
            status=lk.status,
            matched_name=lk.matched_name,
            match_score=lk.match_score,
            candidates=lk.candidates or [],
            last_error=lk.last_error,
        )
        for lk, g in db.execute(q).all()
    ]


# ---------- por jogo ----------


@router.post("/games/{game_id}/refresh", response_model=JobOut, status_code=202)
def refresh(
    game_id: int, data: RefreshIn | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)
):
    return jobs.request_refresh(db, get_game(db, user.id, game_id), data or RefreshIn())


@router.get("/games/{game_id}/links", response_model=list[LinkOut])
def links(game_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return get_game(db, user.id, game_id).links


def _check_provider(provider: str) -> None:
    if provider not in PROVIDERS:
        raise HTTPException(404, "Integração desconhecida")


@router.put("/games/{game_id}/links/{provider}", response_model=JobOut, status_code=202)
def confirm_link(
    game_id: int, provider: str, data: LinkConfirmIn, db: Session = Depends(get_db), user: User = Depends(current_user)
):
    """Confirma qual item da integração é este jogo e já busca os dados dele."""
    _check_provider(provider)
    game = get_game(db, user.id, game_id)
    jobs.set_link(db, game, provider, data.external_id.strip(), "confirmed")
    return jobs.request_refresh(db, game, RefreshIn(providers=[provider], force=False))


@router.delete("/games/{game_id}/links/{provider}", response_model=list[LinkOut])
def ignore_link(game_id: int, provider: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Marca a integração como 'ignorada' para este jogo (não busca mais)."""
    _check_provider(provider)
    game = get_game(db, user.id, game_id)
    jobs.set_link(db, game, provider, None, "ignored")
    db.refresh(game)
    return game.links


# ---------- jobs ----------


@router.post("/jobs/enrich", response_model=JobOut, status_code=202)
def enrich(data: EnrichIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return jobs.request_enrich(db, user.id, data)


@router.get("/jobs", response_model=list[JobOut])
def list_jobs(limit: int = Query(20, le=100), db: Session = Depends(get_db), user: User = Depends(current_user)):
    return db.scalars(select(Job).where(Job.user_id == user.id).order_by(Job.id.desc()).limit(limit)).all()


def _job(db: Session, user_id: int, job_id: int) -> Job:
    job = db.get(Job, job_id)
    if job is None or job.user_id != user_id:
        raise HTTPException(404, "Job não encontrado")
    return job


@router.get("/jobs/{job_id}", response_model=JobOut)
def get_job(job_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return _job(db, user.id, job_id)


@router.post("/jobs/{job_id}/cancel", response_model=JobOut)
def cancel_job(job_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return jobs.cancel(db, _job(db, user.id, job_id))
