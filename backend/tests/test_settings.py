"""Chaves de API no banco (tela de Configurações) e o perfil do usuário."""

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app import db as dbmod
from app.config import get_settings
from app.integrations import registry as providers
from app.library import registry as stores
from app.main import create_app
from app.models import AppSetting
from app.services import api_keys

HEADERS = {"X-GamerHub": "1"}


@pytest.fixture
def client(data_dir):
    with TestClient(create_app(), headers=HEADERS) as c:
        yield c
    providers._providers.clear()
    stores._clients.clear()


def test_env_keys_are_copied_once(data_dir, monkeypatch):
    monkeypatch.setenv("RAWG_API_KEY", "rawg-do-env-1234")
    monkeypatch.setenv("STEAM_API_KEY", "steam-do-env-5678")
    get_settings.cache_clear()
    with dbmod.new_session() as db:
        assert api_keys.import_from_env(db, get_settings()) == ["rawg_api_key", "steam_api_key"]
        assert api_keys.import_from_env(db, get_settings()) == []  # já está no banco
        api_keys.save(db, {"rawg_api_key": ""})  # apagada pela tela
        keys = api_keys.startup(db, get_settings())
        assert keys.rawg_api_key == "" and keys.steam_api_key == "steam-do-env-5678"  # não volta do .env
        assert db.get(AppSetting, "rawg_api_key").value == ""


def test_keys_api_masks_and_applies_to_live_clients(client):
    igdb = providers.get_provider("igdb")
    steam = stores.get_store_client("steam")
    assert not igdb.enabled and not steam.enabled
    assert client.get("/api/settings/keys").json()["rawg_api_key"] == {"configured": False, "preview": None}

    r = client.put(
        "/api/settings/keys",
        json={"igdb_client_id": " cid-abcdef123 ", "igdb_client_secret": "segredo-muito-longo-9z9z", "steam_api_key": "ST"},
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["igdb_client_secret"] == {"configured": True, "preview": "••••9z9z"}
    assert out["steam_api_key"] == {"configured": True, "preview": "••••"}  # curta: nem o fim aparece
    assert "segredo" not in r.text
    assert igdb.enabled and igdb.client_id == "cid-abcdef123" and steam.api_key == "ST"  # mesma instância
    meta = client.get("/api/meta").json()
    assert meta["providers"]["igdb"] is True and meta["stores"]["steam"] is True

    # Campo ausente fica; vazio apaga.
    client.put("/api/settings/keys", json={"steam_api_key": ""})
    assert client.get("/api/settings/keys").json()["igdb_client_id"]["configured"] is True
    assert not steam.enabled


def test_key_test_reports_friendly_errors(client):
    assert client.post("/api/settings/keys/test", json={"provider": "rawg"}).json() == {
        "ok": False,
        "message": "Preencha a chave da RAWG.",
    }
    client.put("/api/settings/keys", json={"rawg_api_key": "errada", "igdb_client_id": "a", "igdb_client_secret": "b"})
    with respx.mock(assert_all_called=False) as mock:
        mock.get("https://api.rawg.io/api/games").mock(return_value=httpx.Response(401, json={"error": "x"}))
        mock.post("https://id.twitch.tv/oauth2/token").mock(return_value=httpx.Response(403, json={"message": "x"}))
        rawg = client.post("/api/settings/keys/test", json={"provider": "rawg"}).json()
        igdb = client.post("/api/settings/keys/test", json={"provider": "igdb"}).json()
    assert rawg == {"ok": False, "message": "A RAWG recusou a chave. Confira se copiou ela inteira."}
    assert igdb["ok"] is False and "Twitch recusou" in igdb["message"]

    with respx.mock(assert_all_called=False) as mock:
        mock.get("https://api.rawg.io/api/games").mock(return_value=httpx.Response(200, json={"results": []}))
        assert client.post("/api/settings/keys/test", json={"provider": "rawg"}).json()["ok"] is True


def test_profile_rename_and_reserved_names(client):
    me = client.get("/api/settings/profile").json()
    assert (me["username"], me["public_page"]) == ("principal", True)
    r = client.patch("/api/settings/profile", json={"username": "Bruno", "display_name": "Bruno S", "public_page": False})
    assert r.status_code == 200, r.text
    assert (r.json()["username"], r.json()["display_name"], r.json()["public_page"]) == ("Bruno", "Bruno S", False)
    assert client.get("/api/auth/me").json()["user"]["username"] == "Bruno"
    for name in ("biblioteca", "API", "configuracoes"):
        r = client.patch("/api/settings/profile", json={"username": name})
        assert r.status_code == 422 and "usado pelo app" in r.json()["detail"], name
    assert client.patch("/api/settings/profile", json={"username": "a b"}).status_code == 422
    assert client.patch("/api/settings/profile", json={"username": "bruno"}).status_code == 200  # só a caixa


@pytest.fixture
def auth_clients(data_dir, monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "true")
    get_settings.cache_clear()
    app = create_app()
    with TestClient(app, headers=HEADERS) as admin, TestClient(app, headers=HEADERS) as other:
        assert admin.post("/api/auth/signup", json={"username": "bruno", "password": "senha-forte-1"}).status_code == 201
        assert other.post("/api/auth/signup", json={"username": "ana", "password": "senha-forte-1"}).status_code == 201
        yield admin, other


def test_keys_are_admin_only_with_login(auth_clients):
    admin, other = auth_clients
    assert admin.get("/api/settings/keys").status_code == 200
    assert other.get("/api/settings/keys").status_code == 403
    assert other.put("/api/settings/keys", json={"rawg_api_key": "x"}).status_code == 403
    assert other.post("/api/settings/keys/test", json={"provider": "rawg"}).status_code == 403
    assert other.patch("/api/settings/profile", json={"username": "BRUNO"}).status_code == 409
    assert other.patch("/api/settings/profile", json={"display_name": "Ana Maria"}).json()["display_name"] == "Ana Maria"
    assert other.post("/api/auth/signup", json={"username": "jogos", "password": "senha-forte-1"}).status_code == 422
