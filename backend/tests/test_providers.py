"""Parsing e resiliência dos providers com HTTP simulado (respx)."""

import json
from types import SimpleNamespace

import httpx
import pytest
import respx

from app.integrations.base import MatchContext, ProviderError, WrongLink
from app.integrations.hltb import HLTBProvider
from app.integrations.igdb import IGDBProvider
from app.integrations.metacritic import BACKEND, SITE, MetacriticProvider
from app.integrations.rawg import RAWGProvider, metacritic_slug, resized
from tests.conftest import FIXTURES


def fx(path: str):
    return json.loads((FIXTURES / path).read_text(encoding="utf-8"))


PC = MatchContext(
    name="Hollow Knight",
    platform="PC",
    igdb_platform_id=6,
    rawg_platform_id=4,
    metacritic_platform="PC",
    hltb_platform="PC",
)


# ---------- IGDB ----------


def igdb_routes(mock: respx.MockRouter, *, first_401: bool = False):
    token = mock.post("https://id.twitch.tv/oauth2/token").mock(
        return_value=httpx.Response(200, json={"access_token": "tok", "expires_in": 3600})
    )
    calls = {"n": 0}

    def games(request: httpx.Request):
        calls["n"] += 1
        if first_401 and calls["n"] == 1:
            return httpx.Response(401, json={"message": "expired"})
        body = request.content.decode()
        assert request.headers["Client-ID"] == "cid"
        if body.startswith("search"):
            return httpx.Response(200, json=fx("igdb/search-hollow-knight.json"))
        return httpx.Response(200, json=fx("igdb/game-14593.json"))

    mock.post("https://api.igdb.com/v4/games").mock(side_effect=games)
    mock.post("https://api.igdb.com/v4/game_time_to_beats").mock(
        return_value=httpx.Response(200, json=fx("igdb/ttb-14593.json"))
    )
    return token


async def test_igdb_search_and_fetch():
    p = IGDBProvider("cid", "secret")
    with respx.mock(assert_all_called=False) as mock:
        igdb_routes(mock)
        cands = await p.search("Hollow Knight", PC)
        patch = await p.fetch("14593", PC)
    await p.aclose()

    hk = cands[0]
    assert (hk.external_id, hk.year, hk.on_platform, hk.kind) == ("14593", 2017, True, "main game")
    assert hk.cover_thumb.endswith("t_cover_small/co93cr.jpg")
    assert hk.platforms[:2] == ["PC (Microsoft Windows)", "Nintendo Switch"] and hk.platform_ids[:2] == [6, 130]
    assert cands[2].kind == "dlc"

    assert patch.cover_url == "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co93cr.jpg"
    assert patch.background_url.endswith("t_1080p/ar5l8.jpg")
    assert [s.ref for s in patch.screenshots] == ["sc6ex1", "sc6ex2"]
    assert patch.videos[0].ref == "UAO2urG23S4"  # trailer primeiro
    assert patch.developer == "Team Cherry" and patch.storyline.startswith("Beneath")
    assert patch.hltb.main == 27.0 and patch.hltb.complete == 62.5
    assert patch.reviews[0].score_norm == 89
    assert str(patch.release_date) == "2017-02-24"
    assert patch.tags == ["Platform", "Adventure", "Action", "Side view", "Single player"]


async def test_igdb_refreshes_token_on_401():
    p = IGDBProvider("cid", "secret")
    with respx.mock(assert_all_called=False) as mock:
        token = igdb_routes(mock, first_401=True)
        cands = await p.search("Hollow Knight", PC)
    await p.aclose()
    assert cands and token.call_count == 2


async def test_igdb_disabled_without_keys():
    p = IGDBProvider("", "")
    assert not p.enabled
    with pytest.raises(ProviderError):
        await p.search("x", PC)


# ---------- RAWG ----------


def rawg_routes(mock: respx.MockRouter, *, first_429: bool = False):
    base = "https://api.rawg.io/api"
    responses = [httpx.Response(200, json=fx("rawg/search-hollow-knight.json"))]
    if first_429:
        responses.insert(0, httpx.Response(429, headers={"Retry-After": "0"}))
    search = mock.get(f"{base}/games", params={"search": "Hollow Knight"}).mock(side_effect=responses)
    mock.get(f"{base}/games/9767").mock(return_value=httpx.Response(200, json=fx("rawg/game-9767.json")))
    mock.get(f"{base}/games/9767/screenshots").mock(
        return_value=httpx.Response(200, json=fx("rawg/screenshots-9767.json"))
    )
    mock.get(f"{base}/games/9767/movies").mock(return_value=httpx.Response(200, json=fx("rawg/movies-9767.json")))
    return search


async def test_rawg_search_fetch_and_retry():
    p = RAWGProvider("key")
    with respx.mock(assert_all_called=False) as mock:
        search = rawg_routes(mock, first_429=True)
        cands = await p.search("Hollow Knight", PC)
        patch = await p.fetch("9767", PC)
    await p.aclose()
    assert search.call_count == 2  # 429 e depois 200
    assert search.calls[0].request.url.params["key"] == "key"
    assert cands[0].on_platform is True and cands[0].year == 2017
    assert patch.description.startswith("Hollow Knight is")
    assert patch.metacritic.metascore == 87 and patch.metacritic.source == "rawg"
    assert patch.hints == {"metacritic_slug": "hollow-knight"}
    assert len(patch.screenshots) == 2 and patch.videos == []
    assert patch.reviews[0].score_norm == 88
    # tags da comunidade em inglês, sem o ruído de loja (conquistas, nuvem, controle, cartas)
    assert patch.tags == [
        "Singleplayer", "Atmospheric", "Great Soundtrack", "Exploration", "Difficult",
        "Metroidvania", "Side Scroller", "2D", "Souls-like",
    ]  # fmt: skip
    assert patch.genres == ["Adventure", "Platformer"]


def test_rawg_helpers():
    assert metacritic_slug("https://www.metacritic.com/game/pc/hollow-knight") == "hollow-knight"
    assert metacritic_slug("https://www.metacritic.com/game/hollow-knight/") == "hollow-knight"
    assert metacritic_slug("https://www.metacritic.com/game/hollow-knight/critic-reviews/") == "hollow-knight"
    assert metacritic_slug(None) is None
    assert resized("https://media.rawg.io/media/games/4cf/hk.jpg", 640) == (
        "https://media.rawg.io/media/resize/640/-/games/4cf/hk.jpg"
    )


# ---------- Metacritic ----------


def mc_routes(mock: respx.MockRouter, *, composer_status: int = 200):
    mock.get(url__startswith=f"{BACKEND}/finder/metacritic/search/").mock(
        return_value=httpx.Response(200, json=fx("metacritic/finder-hollow-knight.json"))
    )
    mock.get(f"{BACKEND}/composer/metacritic/pages/games/hollow-knight/web").mock(
        return_value=httpx.Response(composer_status, json=fx("metacritic/composer-hollow-knight.json"))
    )
    mock.get(f"{BACKEND}/reviews/metacritic/user/games/hollow-knight/stats/web").mock(
        return_value=httpx.Response(200, json=fx("metacritic/user-hollow-knight.json"))
    )
    critic = mock.get(url__startswith=f"{BACKEND}/reviews/metacritic/critic/games/hollow-knight/web").mock(
        return_value=httpx.Response(200, json=fx("metacritic/critic-hollow-knight.json"))
    )
    return critic


async def test_metacritic_search_and_platform_score():
    p = MetacriticProvider()
    with respx.mock(assert_all_called=False) as mock:
        critic = mc_routes(mock)
        cands = await p.search("Hollow Knight", PC)
        patch = await p.fetch("hollow-knight", PC)
    await p.aclose()
    assert [c.external_id for c in cands][:2] == ["hollow-knight", "hollow-knight-voidheart-edition"]
    assert cands[0].on_platform is True and cands[0].year == 2018
    # nota da versão de PC (87), não a da plataforma principal (Switch, 90)
    assert patch.metacritic.metascore == 87 and patch.metacritic.user_score == 9.0
    assert critic.calls[0].request.url.params["platform"] == "pc"
    sources = [r.source for r in patch.reviews]
    assert sources.count("Metacritic · crítica") == 2 and sources[-1] == "Metacritic · usuários"


async def test_metacritic_lead_platform_when_no_score_for_ours():
    ps1 = PC.model_copy(update={"metacritic_platform": "PlayStation"})
    p = MetacriticProvider()
    with respx.mock(assert_all_called=False) as mock:
        mc_routes(mock)
        patch = await p.fetch("hollow-knight", ps1)
    await p.aclose()
    assert patch.metacritic.metascore == 90


async def test_metacritic_falls_back_to_jsonld():
    html = (
        '<html><script type="application/ld+json">{"@type":"VideoGame",'
        '"aggregateRating":{"ratingValue":"90","bestRating":"100"}}</script></html>'
    )
    p = MetacriticProvider()
    with respx.mock(assert_all_called=False) as mock:
        mc_routes(mock, composer_status=404)
        mock.get(f"{SITE}/game/hollow-knight/").mock(return_value=httpx.Response(200, text=html))
        patch = await p.fetch("hollow-knight", PC)
    await p.aclose()
    assert patch.metacritic.metascore == 90 and patch.reviews == []


# ---------- HLTB ----------


class FakeHLTB(HLTBProvider):
    def __init__(self, entries):
        super().__init__()
        self.entries = entries
        self.modifiers = []

    async def _lib_search(self, query, modifiers=None):
        self.modifiers.append(modifiers)
        return self.entries if not callable(self.entries) else self.entries(modifiers)


def entry(gid, name, platforms, main, year=2017):
    return SimpleNamespace(
        game_id=gid, game_name=name, game_alias="", profile_platforms=platforms, release_world=year,
        game_image_url=None, game_type="game", game_web_link=f"https://howlongtobeat.com/game/{gid}",
        main_story=main, main_extra=main * 1.5, completionist=main * 2.3,
    )  # fmt: skip


async def test_hltb_candidates_and_times():
    p = FakeHLTB([entry(26286, "Hollow Knight", ["Nintendo Switch", "PC"], 26.53)])
    cands = await p.search("Hollow Knight", PC)
    assert cands[0].on_platform is True and cands[0].extra["main"] == 26.5
    patch = await p.fetch("26286", PC, cands[0])
    assert (patch.hltb.main, patch.hltb.extra, patch.hltb.complete) == (26.5, 39.8, 61.0)


async def test_hltb_falls_back_to_dlc_search():
    from howlongtobeatpy import SearchModifiers

    dlc = entry(1, "F.E.A.R. Perseus Mandate", ["PC"], 5.0)
    dlc.game_type = "dlc"
    p = FakeHLTB(lambda mod: [] if mod is None or mod == SearchModifiers.HIDE_DLC else [dlc])
    cands = await p.search("F.E.A.R. Perseus Mandate", PC)
    assert len(p.modifiers) == 2 and cands[0].kind is None


async def test_hltb_none_is_error():
    with pytest.raises(ProviderError):
        await FakeHLTB(None).search("x", PC)


# ---------- link da página do jogo ----------


async def test_igdb_from_link_looks_up_slug():
    p = IGDBProvider("cid", "secret")
    bodies: list[str] = []

    def games(request: httpx.Request):
        bodies.append(request.content.decode())
        return httpx.Response(200, json=fx("igdb/search-hollow-knight.json")[:1])

    with respx.mock(assert_all_called=False) as mock:
        mock.post("https://id.twitch.tv/oauth2/token").mock(
            return_value=httpx.Response(200, json={"access_token": "tok", "expires_in": 3600})
        )
        mock.post("https://api.igdb.com/v4/games").mock(side_effect=games)
        found = await p.from_link("https://www.igdb.com/games/Hollow-Knight?tab=reviews", PC)
        with pytest.raises(WrongLink):
            await p.from_link("https://rawg.io/games/hollow-knight", PC)
    await p.aclose()
    assert 'where slug = "hollow-knight"' in bodies[0]
    assert found.external_id == str(fx("igdb/search-hollow-knight.json")[0]["id"])


async def test_rawg_from_link_follows_redirect_and_404():
    base = "https://api.rawg.io/api"
    p = RAWGProvider("key")
    with respx.mock(assert_all_called=False) as mock:
        mock.get(f"{base}/games/hollow-knight-old").mock(
            return_value=httpx.Response(200, json={"redirect": True, "slug": "hollow-knight"})
        )
        mock.get(f"{base}/games/hollow-knight").mock(return_value=httpx.Response(200, json=fx("rawg/game-9767.json")))
        mock.get(f"{base}/games/nada").mock(return_value=httpx.Response(404, json={"detail": "Not found."}))
        found = await p.from_link("https://rawg.io/games/hollow-knight-old", PC)
        missing = await p.from_link("rawg.io/games/nada", PC)
    await p.aclose()
    assert found.external_id == "9767" and found.name == "Hollow Knight" and found.url.endswith("/hollow-knight")
    assert missing is None


async def test_metacritic_from_link():
    p = MetacriticProvider()
    with respx.mock(assert_all_called=False) as mock:
        mc_routes(mock)
        mock.get(f"{BACKEND}/composer/metacritic/pages/games/nada/web").mock(return_value=httpx.Response(404))
        mock.get(f"{BACKEND}/composer/metacritic/pages/games/vazio/web").mock(
            return_value=httpx.Response(200, json={"components": []})
        )
        found = await p.from_link("https://www.metacritic.com/game/hollow-knight/critic-reviews/?platform=pc", PC)
        missing = await p.from_link("https://www.metacritic.com/game/nada/", PC)
        empty = await p.from_link("https://www.metacritic.com/game/vazio/", PC)
        with pytest.raises(WrongLink):
            await p.from_link("https://www.metacritic.com/movie/alien/", PC)
    await p.aclose()
    assert (found.external_id, found.name, found.year, found.on_platform) == ("hollow-knight", "Hollow Knight", 2018, True)
    assert missing is None and empty is None


async def test_hltb_from_link():
    p = FakeHLTB([])

    async def by_id(gid):
        return entry(gid, "Hollow Knight", ["PC"], 26.53) if gid == 26286 else None

    p._lib_by_id = by_id
    found = await p.from_link("https://howlongtobeat.com/game/26286", PC)
    assert found.external_id == "26286" and found.extra["main"] == 26.5 and found.on_platform is True
    assert await p.from_link("howlongtobeat.com/game/1", PC) is None
    with pytest.raises(WrongLink):
        await p.from_link("https://howlongtobeat.com/user/eu", PC)
