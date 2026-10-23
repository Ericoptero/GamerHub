"""Acessam os serviços de verdade para detectar quando um scraping quebrou.

    uv run pytest -m live            # HLTB e Metacritic (sem chave)
    IGDB_CLIENT_ID=… IGDB_CLIENT_SECRET=… RAWG_API_KEY=… uv run pytest -m live
"""

import pytest

from app.config import get_settings
from app.integrations.base import MatchContext
from app.integrations.hltb import HLTBProvider
from app.integrations.igdb import IGDBProvider
from app.integrations.matching import decide, rank
from app.integrations.metacritic import MetacriticProvider
from app.integrations.rawg import RAWGProvider

pytestmark = pytest.mark.live

PC = MatchContext(
    name="Hollow Knight", platform="PC", igdb_platform_id=6, rawg_platform_id=4, metacritic_platform="PC", hltb_platform="PC"
)


async def test_metacritic_live():
    p = MetacriticProvider()
    try:
        status, best = decide(rank(await p.search("Hollow Knight", PC), PC))
        assert status == "matched" and best.external_id == "hollow-knight"
        patch = await p.fetch(best.external_id, PC)
        assert patch.metacritic and 80 <= patch.metacritic.metascore <= 95
    finally:
        await p.aclose()


async def test_hltb_live():
    ctx = PC.model_copy(update={"name": "Celeste"})
    p = HLTBProvider()
    status, best = decide(rank(await p.search("Celeste", ctx), ctx))
    assert status == "matched"
    patch = await p.fetch(best.external_id, ctx, best)
    assert patch.hltb and patch.hltb.main and patch.hltb.main > 0


async def test_igdb_live():
    s = get_settings()
    if not (s.igdb_client_id and s.igdb_client_secret):
        pytest.skip("sem IGDB_CLIENT_ID/SECRET")
    p = IGDBProvider(s.igdb_client_id, s.igdb_client_secret)
    try:
        status, best = decide(rank(await p.search("Hollow Knight", PC), PC))
        assert status == "matched"
        patch = await p.fetch(best.external_id, PC)
        assert patch.cover_url and patch.description
    finally:
        await p.aclose()


async def test_rawg_live():
    s = get_settings()
    if not s.rawg_api_key:
        pytest.skip("sem RAWG_API_KEY")
    p = RAWGProvider(s.rawg_api_key)
    try:
        status, best = decide(rank(await p.search("Hollow Knight", PC), PC))
        assert status == "matched"
        patch = await p.fetch(best.external_id, PC)
        assert patch.description
    finally:
        await p.aclose()
