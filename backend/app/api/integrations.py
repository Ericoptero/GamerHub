from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.auth.deps import current_user
from app.db import get_db
from app.domain import PROVIDERS, fold, normalize_title
from app.enrichment import jobs
from app.enrichment.orchestrator import load_snapshot
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
    PendingGameOut,
    ProviderName,
    ProvidersStatus,
    RefreshIn,
)
from app.seed.seed_data import suggest_genre
from app.services.games import get_game, media_url

PENDING_STATUSES = ("ambiguous", "not_found", "error")

router = APIRouter(prefix="/api", tags=["integrations"])


@router.get("/integrations/status", response_model=ProvidersStatus)
def status():
    return providers_status()


@router.get("/integrations/search", response_model=list[CandidateOut])
async def search(
    provider: ProviderName,
    q: str = Query(min_length=2, max_length=200),
    platform_id: int | None = None,
    game_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Busca avulsa numa integração. Com `game_id`, ranqueia com a plataforma e o ano daquele jogo
    (é o "procurar por outro nome" do Precisa da sua ajuda)."""
    prov = get_provider(provider)
    if not prov.enabled:
        raise HTTPException(409, f"{provider.upper()} não configurado (veja o .env)")
    if game_id is not None:
        get_game(db, user.id, game_id)  # 404 se não for do usuário
        snap = load_snapshot(game_id)
        assert snap is not None
        ctx = snap.ctx.model_copy(update={"name": q, "canonical_name": None, "alt_names": []})
    else:
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
            url=c.url,
            genres=c.genres,
            suggested_genre=suggest_genre(c.genres),
            in_library=names.get(normalize_title(c.name), []),
            local_platform_ids=runs_on(c),
        )
        for c in candidates
    ]


@router.get("/integrations/pending", response_model=list[PendingGameOut])
def pending(provider: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Um item por jogo com alguma integração em dúvida, sem resultado ou com erro, trazendo todas
    as integrações dele (inclusive as resolvidas), para resolver tudo num lugar só."""
    open_links = select(ExternalLink.game_id).where(ExternalLink.status.in_(PENDING_STATUSES))
    if provider:
        open_links = open_links.where(ExternalLink.provider == provider)
    q = select(Game).where(Game.user_id == user.id, Game.id.in_(open_links)).options(selectinload(Game.links))
    games = sorted(db.scalars(q), key=lambda g: fold(g.name))
    return [
        PendingGameOut(
            game_id=g.id,
            name=g.name,
            platform_id=g.platform_id,
            platform=g.platform.name,
            release_date=g.release_date,
            cover=media_url(g.cover_path, g.cover_url),
            links=[LinkOut.model_validate(lk) for lk in g.links],
        )
        for g in games
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
    # Escolhido numa busca avulsa: não está entre os candidatos salvos, então vêm nome e link junto.
    picked = {"name": data.name, "url": data.url, "score": data.score} if data.name else None
    jobs.set_link(db, game, provider, data.external_id.strip(), "confirmed", picked=picked)
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
