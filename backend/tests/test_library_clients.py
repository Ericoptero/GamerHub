"""Clientes das lojas (Steam, Epic, GOG) com HTTP simulado (respx)."""

import json
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
import respx

from app.integrations.base import ProviderError
from app.library import epic, gog
from app.library.base import AuthExpired
from app.library.epic import EpicClient
from app.library.gog import GogClient
from app.library.steam import API_URL, ASSETS_URL, SteamClient, library_cover, parse_steam_ref

STEAMID = "76561198000000001"


class Saved:
    """Coleta os tokens que o cliente manda salvar (e a ordem em relação às chamadas HTTP)."""

    def __init__(self, calls: list[str] | None = None):
        self.values: list[dict] = []
        self.calls = calls

    async def __call__(self, credentials: dict) -> None:
        self.values.append(credentials)
        if self.calls is not None:
            self.calls.append("save")


# ---------- Steam ----------


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("https://steamcommunity.com/id/JogadorExemplo/", ("vanity", "JogadorExemplo")),
        ("https://steamcommunity.com/profiles/76561198000000001/", ("id64", STEAMID)),
        ("steamcommunity.com/id/JogadorExemplo", ("vanity", "JogadorExemplo")),
        ("http://www.steamcommunity.com/profiles/76561198000000001?l=brazilian", ("id64", STEAMID)),
        ("  76561198000000001 ", ("id64", STEAMID)),
        ("JogadorExemplo", ("vanity", "JogadorExemplo")),
    ],
)
def test_parse_steam_ref(text, expected):
    assert parse_steam_ref(text) == expected


@pytest.mark.parametrize("text", ["https://steamcommunity.com/profiles/123/", "nome com espaço", ""])
def test_parse_steam_ref_rejects(text):
    with pytest.raises(ValueError):
        parse_steam_ref(text)


def steam_routes(mock: respx.MockRouter, owned: dict | None = None):
    mock.get(f"{API_URL}/ISteamUser/ResolveVanityURL/v1/").mock(
        return_value=httpx.Response(200, json={"response": {"steamid": STEAMID, "success": 1}})
    )
    mock.get(f"{API_URL}/ISteamUser/GetPlayerSummaries/v2/").mock(
        return_value=httpx.Response(
            200,
            json={
                "response": {
                    "players": [
                        {
                            "steamid": STEAMID,
                            "personaname": "Jogador",
                            "avatarfull": "https://avatars/x.jpg",
                            "profileurl": "https://steamcommunity.com/id/JogadorExemplo/",
                        }
                    ]
                }
            },
        )
    )
    owned = owned or {
        "response": {
            "game_count": 2,
            "games": [
                {"appid": 1145360, "name": "Hades", "playtime_forever": 1830, "rtime_last_played": 1729000000},
                {"appid": 367520, "name": "Hollow Knight", "playtime_forever": 0, "rtime_last_played": 0},
            ],
        }
    }
    mock.get(f"{API_URL}/IPlayerService/GetOwnedGames/v1/").mock(return_value=httpx.Response(200, json=owned))
    return mock.get(f"{API_URL}/IStoreBrowseService/GetItems/v1/").mock(
        return_value=httpx.Response(
            200,
            json={
                "response": {
                    "store_items": [
                        {
                            "appid": 1145360,
                            "assets": {
                                "asset_url_format": "steam/apps/1145360/${FILENAME}?t=1",
                                "library_capsule": "ab12/library_600x900.jpg",
                            },
                        }
                    ]
                }
            },
        )
    )


async def test_steam_connect_by_vanity_url():
    client = SteamClient("key")
    with respx.mock(assert_all_called=False) as mock:
        steam_routes(mock)
        profile = await client.connect("https://steamcommunity.com/id/JogadorExemplo/")
    assert profile.external_user_id == STEAMID
    assert profile.display_name == "Jogador" and profile.credentials == {}
    await client.aclose()


async def test_steam_unknown_vanity():
    client = SteamClient("key")
    with respx.mock() as mock:
        mock.get(f"{API_URL}/ISteamUser/ResolveVanityURL/v1/").mock(
            return_value=httpx.Response(200, json={"response": {"success": 42, "message": "No match"}})
        )
        with pytest.raises(ProviderError, match="não encontrado"):
            await client.connect("https://steamcommunity.com/id/ninguem/")
    await client.aclose()


async def test_steam_library_covers_only_for_new_games():
    client = SteamClient("key")
    with respx.mock(assert_all_called=False) as mock:
        items = steam_routes(mock)
        games = await client.fetch_library(STEAMID, {}, Saved(), known=set())
        assert items.call_count == 1
        hades, hk = games
        assert (hades.external_id, hades.name, hades.playtime_minutes) == ("1145360", "Hades", 1830)
        assert hades.last_played_at is not None and hk.last_played_at is None
        assert hades.cover_url == f"{ASSETS_URL}steam/apps/1145360/ab12/library_600x900.jpg?t=1"
        assert hk.cover_url == library_cover("367520")  # sem asset: caminho antigo
        assert hades.url == "https://store.steampowered.com/app/1145360/"

        again = await client.fetch_library(STEAMID, {}, Saved(), known={"1145360", "367520"})
        assert items.call_count == 1 and all(g.cover_url is None for g in again)
    await client.aclose()


async def test_steam_private_profile():
    client = SteamClient("key")
    with respx.mock(assert_all_called=False) as mock:
        steam_routes(mock, owned={"response": {}})
        with pytest.raises(ProviderError, match="privada"):
            await client.fetch_library(STEAMID, {}, Saved(), known=set())
    await client.aclose()


async def test_steam_without_key():
    with pytest.raises(ProviderError, match="chave da Steam"):
        await SteamClient("").fetch_library(STEAMID, {}, Saved(), known=set())


# ---------- Epic ----------


def test_epic_extract_code():
    code = "a" * 32
    assert epic.extract_code(json.dumps({"redirectUrl": "x", "authorizationCode": code, "sid": None})) == code
    assert epic.extract_code(f"  {code}\n") == code
    with pytest.raises(ProviderError):
        epic.extract_code("não sei")


def epic_token(mock: respx.MockRouter, *, refresh: str = "r2", status: int = 200):
    body = (
        {"errorCode": "errors.com.epicgames.account.auth_token.invalid_refresh_token"}
        if status != 200
        else {
            "access_token": "acc",
            "refresh_token": refresh,
            "refresh_expires_at": "2026-11-15T00:00:00Z",
            "account_id": "epic-acc",
            "displayName": "JogadorEpic",
        }
    )
    return mock.post(epic.OAUTH_URL).mock(return_value=httpx.Response(status, json=body))


async def test_epic_connect_and_bad_code():
    client = EpicClient()
    with respx.mock() as mock:
        route = epic_token(mock, refresh="r1")
        profile = await client.connect("b" * 32)
        form = parse_qs(route.calls[0].request.content.decode())
        assert form["grant_type"] == ["authorization_code"] and form["code"] == ["b" * 32]
    assert profile.external_user_id == "epic-acc" and profile.display_name == "JogadorEpic"
    assert profile.credentials["refresh_token"] == "r1"

    with respx.mock() as mock:
        epic_token(mock, status=400)
        with pytest.raises(ProviderError, match="inválido ou expirado") as err:
            await client.connect("c" * 32)
        assert not isinstance(err.value, AuthExpired)
    await client.aclose()


async def test_epic_library(data_dir):
    client = EpicClient()
    calls: list[str] = []
    saved = Saved(calls)
    with respx.mock() as mock:
        token = epic_token(mock)
        token.side_effect = lambda req: (calls.append("token"), token.return_value)[1]
        pages = [
            {
                "records": [
                    {"namespace": "ue", "catalogItemId": "asset", "appName": "UEAsset"},
                    {"namespace": "ns-celeste", "catalogItemId": "cat-celeste", "appName": "Salt"},
                ],
                "responseMetadata": {"nextCursor": "page2"},
            },
            {
                "records": [
                    {"namespace": "ns-dlc", "catalogItemId": "cat-dlc", "appName": "DLC1"},
                    {"namespace": "ns-known", "catalogItemId": "cat-known", "appName": "Known"},
                ],
                "responseMetadata": {},
            },
        ]

        def library(request: httpx.Request):
            calls.append("library")
            assert request.headers["Authorization"] == "Bearer acc"
            return httpx.Response(200, json=pages[1] if "cursor=page2" in str(request.url) else pages[0])

        mock.get(f"{epic.LIBRARY_URL}/items").mock(side_effect=library)
        mock.get(f"{epic.LIBRARY_URL}/playtime/account/epic-acc/all").mock(
            return_value=httpx.Response(200, json=[{"artifactId": "Salt", "totalTime": 7260}])
        )
        catalog = {
            "cat-celeste": {
                "title": "Celeste",
                "categories": [{"path": "games"}],
                "keyImages": [{"type": "Thumbnail", "url": "https://t"}, {"type": "DieselGameBoxTall", "url": "https://tall"}],
            },
            "cat-dlc": {"title": "Farewell", "categories": [{"path": "addons"}], "mainGameItem": {"id": "x"}},
        }

        def bulk(request: httpx.Request):
            cid = request.url.params["id"]
            assert cid != "cat-known"  # item já conhecido: não busca o título de novo
            return httpx.Response(200, json={cid: catalog[cid]})

        mock.get(url__startswith=epic.CATALOG_URL).mock(side_effect=bulk)
        games = await client.fetch_library("epic-acc", {"refresh_token": "r1"}, saved, known={"cat-known"})

    assert calls[:3] == ["token", "save", "library"]  # o token novo é salvo antes de qualquer outra chamada
    assert saved.values == [{"refresh_token": "r2", "refresh_expires_at": "2026-11-15T00:00:00Z", "account_id": "epic-acc"}]
    by_id = {g.external_id: g for g in games}
    assert set(by_id) == {"cat-celeste", "cat-known"}
    assert by_id["cat-celeste"].name == "Celeste" and by_id["cat-celeste"].cover_url == "https://tall"
    assert by_id["cat-celeste"].playtime_minutes == 121
    assert by_id["cat-known"].name is None
    await client.aclose()


async def test_epic_refresh_rejected_is_not_retried():
    client = EpicClient()
    with respx.mock() as mock:
        route = epic_token(mock, status=400)
        with pytest.raises(AuthExpired):
            await client.fetch_library("epic-acc", {"refresh_token": "old"}, Saved(), known=set())
        assert route.call_count == 1
    await client.aclose()


# ---------- GOG ----------


def test_gog_extract_code_and_images():
    assert gog.extract_code("https://embed.gog.com/on_login_success?origin=client&code=AbC-123_xyzxyzxyzxyzxyz") == (
        "AbC-123_xyzxyzxyzxyzxyz"
    )
    with pytest.raises(ProviderError):
        gog.extract_code("https://embed.gog.com/on_login_success?origin=client")
    assert gog.image_url("//images-4.gog-statics.com/abc") == "https://images-4.gog-statics.com/abc_392.jpg"
    assert gog.image_url("https://x/y.png") == "https://x/y.png"


def gog_token(mock: respx.MockRouter, *, status: int = 200):
    body = (
        {"error": "invalid_grant"}
        if status != 200
        else {"access_token": "acc", "refresh_token": "g2", "user_id": "4807", "expires_in": 3600}
    )
    return mock.get(gog.TOKEN_URL).mock(return_value=httpx.Response(status, json=body))


async def test_gog_connect_and_library():
    client = GogClient()
    with respx.mock() as mock:
        token = gog_token(mock)
        mock.get(f"{gog.EMBED_URL}/userData.json").mock(
            return_value=httpx.Response(200, json={"username": "jogador", "galaxyUserId": "4807", "avatar": None})
        )
        profile = await client.connect("https://embed.gog.com/on_login_success?origin=client&code=" + "z" * 30)
        q = parse_qs(urlparse(str(token.calls[0].request.url)).query)
        assert q["grant_type"] == ["authorization_code"] and q["redirect_uri"] == [gog.REDIRECT_URI]
        assert profile.external_user_id == "4807" and profile.profile_url == "https://www.gog.com/u/jogador"
        assert profile.credentials == {"refresh_token": "g2"}

        pages = {
            "1": {"totalPages": 2, "products": [{"id": 1207658930, "title": "The Witcher 3", "image": "//img/w3", "url": "/en/game/the_witcher_3"}]},
            "2": {"totalPages": 2, "products": [{"id": 9, "title": "Gwent", "image": None, "url": None}]},
        }
        mock.get(f"{gog.EMBED_URL}/account/getFilteredProducts").mock(
            side_effect=lambda req: httpx.Response(200, json=pages[req.url.params["page"]])
        )
        saved = Saved()
        games = await client.fetch_library("4807", {"refresh_token": "g1"}, saved, known=set())
    assert saved.values == [{"refresh_token": "g2"}]
    assert [(g.external_id, g.name) for g in games] == [("1207658930", "The Witcher 3"), ("9", "Gwent")]
    assert games[0].cover_url == "https://img/w3_392.jpg" and games[0].url == "https://www.gog.com/en/game/the_witcher_3"
    assert games[0].playtime_minutes is None
    await client.aclose()


async def test_gog_refresh_rejected():
    client = GogClient()
    with respx.mock() as mock:
        route = gog_token(mock, status=400)
        with pytest.raises(AuthExpired):
            await client.fetch_library("4807", {"refresh_token": "old"}, Saved(), known=set())
        assert route.call_count == 1
    await client.aclose()
