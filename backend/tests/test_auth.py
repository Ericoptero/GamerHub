import json
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update

from app import db as dbmod
from app.auth.passwords import hash_password, verify_password
from app.auth.sessions import throttle
from app.config import get_settings
from app.main import create_app
from app.models import Game, UserSession
from app.services.importer import import_short_json

HEADERS = {"X-GamerHub": "1"}
SAMPLE = [
    {"n": "Hades", "p": "PC", "st": "done", "u": 9},
    {"n": "Celeste", "p": "Switch", "st": "backlog", "pr": "Alta"},
]


def test_password_hash_roundtrip():
    stored = hash_password("correct horse")
    assert stored.startswith("scrypt$") and stored != hash_password("correct horse")
    assert verify_password("correct horse", stored)
    assert not verify_password("wrong", stored)
    assert not verify_password("x", None) and not verify_password("x", "lixo")


@pytest.fixture
def app_with_auth(data_dir, monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "true")
    get_settings.cache_clear()
    throttle.reset()
    with dbmod.new_session() as db:
        from app.seed.seed_data import seed_catalogs

        seed_catalogs(db)
        import_short_json(db, 1, SAMPLE)
    return create_app()


def _client(app) -> TestClient:
    return TestClient(app, headers=HEADERS)


def _signup(c: TestClient, username: str, password: str = "senha-forte-1", status: int = 201) -> dict:
    r = c.post("/api/auth/signup", json={"username": username, "password": password})
    assert r.status_code == status, r.text
    return r.json()


def test_login_off_keeps_single_user_mode(data_dir):
    with TestClient(create_app()) as c:
        me = c.get("/api/auth/me").json()
        assert me["auth_enabled"] is False and me["user"]["id"] == 1
        assert c.post("/api/auth/signup", json={"username": "bruno", "password": "12345678"}).status_code == 409
        assert c.get("/api/games").status_code == 200  # sem cookie, sem cabeçalho: como sempre foi


def test_first_signup_claims_existing_library(app_with_auth):
    with _client(app_with_auth) as c:
        assert c.get("/api/games").status_code == 401
        me = c.get("/api/auth/me").json()
        assert me == {"auth_enabled": True, "signup_allowed": True, "needs_setup": True, "user": None}
        user = _signup(c, "Bruno")
        assert user["id"] == 1 and user["is_admin"] is True and user["display_name"] == "Bruno"
        assert sorted(g["name"] for g in c.get("/api/games").json()) == ["Celeste", "Hades"]
        me = c.get("/api/auth/me").json()
        assert me["needs_setup"] is False and me["user"]["username"] == "Bruno"


def test_users_are_isolated(app_with_auth):
    with _client(app_with_auth) as bruno, _client(app_with_auth) as ana:
        _signup(bruno, "bruno")
        hades = next(g for g in bruno.get("/api/games").json() if g["name"] == "Hades")
        comment = bruno.post(f"/api/games/{hades['id']}/comments", json={"body": "obra-prima"}).json()
        job = bruno.post("/api/jobs/enrich", json={"scope": "all"}).json()
        bruno_device = bruno.get("/api/devices").json()[0]

        user = _signup(ana, "ana")
        assert user["id"] != 1 and user["is_admin"] is False
        _signup(ana, "ANA", status=409)  # nome de usuário não diferencia maiúsculas
        assert ana.get("/api/games").json() == []
        assert len(ana.get("/api/devices").json()) == 7  # aparelhos padrão
        for method, url in [
            ("get", f"/api/games/{hades['id']}"),
            ("patch", f"/api/games/{hades['id']}"),
            ("delete", f"/api/games/{hades['id']}"),
            ("get", f"/api/games/{hades['id']}/comments"),
            ("delete", f"/api/comments/{comment['id']}"),
            ("post", f"/api/games/{hades['id']}/refresh"),
            ("get", f"/api/jobs/{job['id']}"),
            ("delete", f"/api/devices/{bruno_device['id']}"),
        ]:
            kwargs = {"json": {}} if method in ("patch", "post") else {}
            assert getattr(ana, method)(url, **kwargs).status_code == 404, url
        assert ana.get("/api/jobs").json() == []
        pc = next(p for p in ana.get("/api/platforms").json() if p["name"] == "PC")
        assert pc["game_count"] == 0

        # Restaurar a biblioteca (vazia) da Ana não toca nos jogos do Bruno.
        export = ana.get("/api/export.json").json()
        assert export["games"] == []
        files = {"file": ("export.json", json.dumps(export), "application/json")}
        assert ana.post("/api/import/json?mode=substituir", files=files).status_code == 200
        assert len(bruno.get("/api/games").json()) == 2
        assert bruno.get(f"/api/games/{hades['id']}/comments").json()[0]["body"] == "obra-prima"


def test_logout_login_and_throttle(app_with_auth):
    with _client(app_with_auth) as c:
        _signup(c, "bruno", "senha-forte-1")
        assert c.post("/api/auth/logout").status_code == 204
        assert c.get("/api/games").status_code == 401
        for _ in range(5):
            assert c.post("/api/auth/login", json={"username": "bruno", "password": "errada"}).status_code == 401
        r = c.post("/api/auth/login", json={"username": "bruno", "password": "senha-forte-1"})
        assert r.status_code == 429 and int(r.headers["Retry-After"]) > 0
        throttle.reset()
        assert c.post("/api/auth/login", json={"username": "BRUNO", "password": "senha-forte-1"}).status_code == 200
        assert c.get("/api/games").status_code == 200


def test_guard_header_media_and_expired_session(app_with_auth):
    with _client(app_with_auth) as c:
        _signup(c, "bruno")
        bare = TestClient(app_with_auth)
        bare.cookies.update(c.cookies)
        assert bare.post("/api/games", json={"name": "X", "platform_id": 1}).status_code == 403  # sem X-GamerHub
        assert bare.get("/api/games").status_code == 200

        anon = TestClient(app_with_auth)
        # Jogo de quem tem página pública: a imagem passa do guarda (404 porque o arquivo não existe).
        assert anon.get("/media/1/cover.webp").status_code == 404
        assert anon.get("/media/999/cover.webp").status_code == 401
        assert anon.get("/media/x.webp").status_code == 401
        assert c.patch("/api/settings/profile", json={"public_page": False}).status_code == 200
        assert anon.get("/media/1/cover.webp").status_code == 401
        assert c.get("/media/1/cover.webp").status_code == 404  # logado: passa do guarda, arquivo não existe

        with dbmod.new_session() as db:
            db.execute(update(UserSession).values(expires_at=datetime.now() - timedelta(days=1)))
            db.commit()
        assert c.get("/api/games").status_code == 401


def test_change_password(app_with_auth):
    with _client(app_with_auth) as c:
        _signup(c, "bruno", "senha-forte-1")
        bad = c.post("/api/auth/password", json={"current_password": "x", "new_password": "outra-senha-2"})
        assert bad.status_code == 400
        ok = c.post("/api/auth/password", json={"current_password": "senha-forte-1", "new_password": "outra-senha-2"})
        assert ok.status_code == 204
        assert c.get("/api/games").status_code == 200  # a sessão atual continua
        c.post("/api/auth/logout")
        assert c.post("/api/auth/login", json={"username": "bruno", "password": "senha-forte-1"}).status_code == 401
        assert c.post("/api/auth/login", json={"username": "bruno", "password": "outra-senha-2"}).status_code == 200


def test_closed_signup_and_admin_rules(app_with_auth, monkeypatch):
    monkeypatch.setenv("AUTH_ALLOW_SIGNUP", "false")
    get_settings.cache_clear()
    with _client(app_with_auth) as admin, _client(app_with_auth) as other:
        assert admin.get("/api/auth/me").json()["signup_allowed"] is True  # o 1º cadastro sempre pode
        _signup(admin, "bruno")
        assert other.get("/api/auth/me").json()["signup_allowed"] is False
        _signup(other, "ana", status=403)

        r = admin.post("/api/users", json={"username": "ana", "password": "senha-da-ana"})
        assert r.status_code == 201
        ana_id = r.json()["id"]
        assert other.post("/api/auth/login", json={"username": "ana", "password": "senha-da-ana"}).status_code == 200
        other.post("/api/games", json={"name": "Hollow Knight", "platform_id": 1})

        assert other.get("/api/users").status_code == 403
        assert other.get("/api/backup.sqlite").status_code == 403
        assert admin.delete("/api/users/1").status_code == 409  # a si mesmo
        assert admin.patch("/api/users/1", json={"is_admin": False}).status_code == 409  # último admin
        users = {u["username"]: u for u in admin.get("/api/users").json()}
        assert users["ana"]["game_count"] == 1 and users["bruno"]["game_count"] == 2

        assert admin.post(f"/api/users/{ana_id}/password", json={"password": "nova-senha-ana"}).status_code == 204
        assert other.get("/api/games").status_code == 401  # redefinir derruba as sessões dela
        assert admin.delete(f"/api/users/{ana_id}").status_code == 204
        with dbmod.new_session() as db:
            assert db.scalars(select(Game.name).where(Game.user_id == ana_id)).all() == []
