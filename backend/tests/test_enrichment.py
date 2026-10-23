"""Orquestrador e jobs com providers falsos (sem rede)."""

from datetime import date

import pytest
from sqlalchemy import select

from app.enrichment import jobs
from app.enrichment.orchestrator import enrich_game
from app.integrations import registry
from app.integrations.base import (
    Candidate,
    MatchContext,
    MediaRef,
    MetadataPatch,
    ProviderError,
    ReviewRef,
    Scores,
    Times,
)
from app.models import ExternalLink, Game, Job
from app.schemas import EnrichIn, RefreshIn
from app.services.importer import import_short_json


class FakeProvider:
    def __init__(self, name, candidates=None, patch=None, error=None, enabled=True):
        self.name = name
        self.candidates = candidates or []
        self.patch = patch or MetadataPatch()
        self.error = error
        self.enabled = enabled
        self.searches: list[str] = []
        self.fetches: list[str] = []

    async def search(self, query: str, ctx: MatchContext):
        self.searches.append(query)
        if self.error:
            raise ProviderError(self.error)
        return [c.model_copy() for c in self.candidates]

    async def fetch(self, external_id, ctx, hint=None):
        self.fetches.append(external_id)
        if self.error:
            raise ProviderError(self.error)
        return self.patch


def cand(provider, cid, name, on=True):
    return Candidate(provider=provider, external_id=str(cid), name=name, on_platform=on)


async def _no_images(_game_id: int) -> None:
    return None


@pytest.fixture
def fakes(db, monkeypatch):
    monkeypatch.setattr("app.enrichment.orchestrator.cache_game_images", _no_images)
    providers = {
        "igdb": FakeProvider(
            "igdb",
            [cand("igdb", 1, "Alien: Isolation"), cand("igdb", 2, "Alien: Isolation - Last Survivor", on=False)],
            MetadataPatch(
                canonical_name="Alien: Isolation",
                year=2014,
                description="IGDB desc",
                cover_url="https://img/igdb-cover.jpg",
                screenshots=[MediaRef(url="https://img/s1.jpg", ref="s1"), MediaRef(url="https://img/s2.jpg", ref="s2")],
                videos=[MediaRef(url="https://www.youtube.com/watch?v=UAO2urG23S4", ref="UAO2urG23S4")],
                tags=["Shooter", "Horror"],
                developer="Creative Assembly",
                hltb=Times(main=15.0),
                reviews=[ReviewRef(source="IGDB · crítica agregada", score_norm=80, score_display="80/100")],
            ),
        ),
        "rawg": FakeProvider(
            "rawg",
            [cand("rawg", 10, "Alien: Isolation")],
            MetadataPatch(
                description="RAWG desc",
                background_url="https://img/rawg-bg.jpg",
                metacritic=Scores(metascore=79, source="rawg"),
                hints={"metacritic_slug": "alien-isolation"},
            ),
        ),
        "hltb": FakeProvider(
            "hltb",
            [cand("hltb", 100, "Alien: Isolation")],
            MetadataPatch(hltb=Times(main=18.5, extra=23.0, complete=33.5)),
        ),
        "metacritic": FakeProvider(
            "metacritic",
            [cand("metacritic", "alien-isolation", "Alien: Isolation")],
            MetadataPatch(
                metacritic=Scores(metascore=81, user_score=8.7, url="https://mc/alien-isolation/"),
                reviews=[ReviewRef(source="Metacritic · crítica", outlet="IGN", score_norm=90, text="Assustador")],
            ),
        ),
    }
    for name, p in providers.items():
        registry.set_provider(name, p)
    yield providers
    registry._providers.clear()


@pytest.fixture
def alien(db, planilha, fakes):
    import_short_json(db, planilha)
    game = db.scalars(select(Game).where(Game.name == "Alien: Isolation")).one()
    return game.id


def load(db, game_id) -> Game:
    db.expire_all()
    return db.get(Game, game_id)


async def test_merge_precedence(db, alien, fakes):
    line, results = await enrich_game(alien)
    assert {k: r.status for k, r in results.items()} == {
        "igdb": "ok", "rawg": "ok", "hltb": "ok", "metacritic": "ok"
    }  # fmt: skip
    assert line == "Alien: Isolation (PC): IGDB ok · RAWG ok · HLTB 18,5h · Metacritic 81"

    g = load(db, alien)
    assert g.description == "IGDB desc"  # IGDB antes da RAWG
    assert g.cover_url == "https://img/igdb-cover.jpg"
    assert g.background_url == "https://img/rawg-bg.jpg"  # IGDB não tinha
    assert (g.metacritic_score, g.metacritic_source, g.metacritic_user_score) == (81, "metacritic", 8.7)
    assert (g.hltb_main_hours, g.hltb_extra_hours, g.hltb_complete_hours) == (18.5, 23.0, 33.5)
    assert g.release_date is None or isinstance(g.release_date, date)
    assert g.tags == ["Shooter", "Horror"] and g.developer == "Creative Assembly"
    assert [m.provider_ref for m in g.media if m.kind == "screenshot"] == ["s1", "s2"]
    assert [m.provider for m in g.media if m.kind == "video"] == ["igdb"]
    assert sorted(r.provider for r in g.store_reviews) == ["igdb", "metacritic"]
    assert g.last_enriched_at is not None
    links = {lk.provider: lk for lk in g.links}
    assert links["igdb"].status == "matched" and links["igdb"].external_id == "1"
    # campos do usuário intactos
    assert (g.status, g.priority, g.genre.name) == ("backlog", "Media", "Terror")


async def test_locked_and_empty_never_overwrite(db, alien, fakes):
    g = load(db, alien)
    g.locked_fields = ["hltb_main_hours", "description"]
    g.hltb_main_hours = 99.0
    g.description = "minha descrição"
    g.storyline = "já tinha"
    db.commit()
    await enrich_game(alien)
    g = load(db, alien)
    assert g.hltb_main_hours == 99.0 and g.description == "minha descrição"
    assert g.hltb_extra_hours == 23.0  # não travado
    assert g.storyline == "já tinha"  # IGDB não trouxe storyline: não apaga


async def test_provider_error_is_isolated(db, alien, fakes):
    fakes["hltb"].error = "hltb: a API mudou"
    line, results = await enrich_game(alien)
    assert results["hltb"].status == "error" and results["igdb"].status == "ok"
    assert "HLTB erro" in line
    g = load(db, alien)
    assert g.hltb_main_hours == 15.0  # caiu para o tempo do IGDB
    link = next(lk for lk in g.links if lk.provider == "hltb")
    assert link.status == "error" and "mudou" in link.last_error


async def test_ambiguous_then_confirm(db, alien, fakes):
    fakes["igdb"].candidates = [cand("igdb", 1, "Alien Isolation"), cand("igdb", 3, "Alien Isolation")]
    _line, results = await enrich_game(alien, ["igdb"])
    assert results["igdb"].status == "ambiguous"
    g = load(db, alien)
    link = g.links[0]
    assert link.status == "ambiguous" and len(link.candidates) == 2 and g.description is None

    jobs.set_link(db, g, "igdb", "3", "confirmed")
    fakes["igdb"].searches.clear()
    _line, results = await enrich_game(alien, ["igdb"])
    assert results["igdb"].status == "ok" and fakes["igdb"].searches == []  # não busca de novo
    assert fakes["igdb"].fetches[-1] == "3"
    assert load(db, alien).links[0].status == "confirmed"


async def test_metacritic_uses_rawg_slug_when_search_fails(db, alien, fakes):
    fakes["metacritic"].candidates = []
    _line, results = await enrich_game(alien)
    assert results["metacritic"].status == "ok"
    assert fakes["metacritic"].fetches == ["alien-isolation"]


async def test_disabled_provider_is_skipped(db, alien, fakes):
    fakes["igdb"].enabled = False
    _line, results = await enrich_game(alien)
    assert results["igdb"].status == "disabled" and results["rawg"].status == "ok"
    g = load(db, alien)
    assert g.description == "RAWG desc" and not any(lk.provider == "igdb" for lk in g.links)


async def test_batch_job_resumes_and_skips_done(db, alien, fakes):
    ids = jobs.select_game_ids(db, EnrichIn(scope="missing"))
    assert len(ids) == 240
    job = jobs.request_enrich(db, EnrichIn(game_ids=ids[:3]))
    job.params = {**job.params, "done": [ids[0]]}  # simula restart após o 1º jogo
    job.status = "running"
    db.commit()
    await jobs.run_job(job.id)
    db.expire_all()
    job = db.get(Job, job.id)
    assert job.status == "done" and job.processed == 2 and len(job.log) == 2
    assert sorted(job.params["done"]) == sorted(ids[:3])


async def test_cancelled_job_does_nothing(db, alien, fakes):
    job = jobs.request_refresh(db, db.get(Game, alien), RefreshIn())
    jobs.cancel(db, job)
    await jobs.run_job(job.id)
    db.expire_all()
    assert db.get(Job, job.id).processed == 0
    assert fakes["igdb"].searches == []


async def test_ignored_link_is_not_searched(db, alien, fakes):
    jobs.set_link(db, db.get(Game, alien), "hltb", None, "ignored")
    _line, results = await enrich_game(alien)
    assert results["hltb"].status == "ignored" and fakes["hltb"].searches == []
    assert db.scalar(select(ExternalLink.status).where(ExternalLink.provider == "hltb")) == "ignored"


async def test_worker_runs_refresh_while_batch_is_busy(db, alien, fakes, monkeypatch):
    import asyncio

    release = asyncio.Event()
    started: list[int] = []
    original = jobs.run_job

    async def slow_batch(job_id):
        started.append(job_id)
        if db.get(Job, job_id).kind == "enrich":
            await release.wait()
        await original(job_id)

    monkeypatch.setattr(jobs, "run_job", slow_batch)
    worker = jobs.Worker()
    worker.start()
    try:
        monkeypatch.setattr(jobs, "worker", worker)
        batch = jobs.request_enrich(db, EnrichIn(game_ids=[alien]))
        refresh = jobs.request_refresh(db, db.get(Game, alien), RefreshIn(providers=["hltb"]))
        for _ in range(100):
            await asyncio.sleep(0.02)
            db.expire_all()
            if db.get(Job, refresh.id).status == "done":
                break
        assert db.get(Job, refresh.id).status == "done"
        assert batch.id in started and db.get(Job, batch.id).status == "queued"  # lote ainda preso
        release.set()
    finally:
        await worker.stop()
