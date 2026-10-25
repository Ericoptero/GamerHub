"""Página pública /<username>: só os cards, sem os ocultos e sem dados privados."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import db as dbmod
from app.config import get_settings
from app.main import create_app
from app.models import Game
from app.services.importer import import_short_json

HEADERS = {"X-GamerHub": "1"}
SAMPLE = [
    {"n": "Hades", "p": "PC", "st": "done", "u": 9},
    {"n": "Celeste", "p": "Switch", "st": "backlog", "pr": "Alta"},
    {"n": "Segredo", "p": "PC", "st": "playing"},
]


@pytest.fixture
def seeded(data_dir):
    with dbmod.new_session() as db:
        from app.seed.seed_data import seed_catalogs

        seed_catalogs(db)
        import_short_json(db, 1, SAMPLE)
        db.scalars(select(Game).where(Game.name == "Segredo")).one().hidden = True
        db.scalars(select(Game).where(Game.name == "Hades")).one().tags = ["Roguelike", "Action"]
        db.commit()


def test_public_page_lists_cards_without_private_data(seeded):
    with TestClient(create_app(), headers=HEADERS) as c:
        r = c.get("/api/public/PRINCIPAL")  # o nome não diferencia maiúsculas
        assert r.status_code == 200, r.text
        page = r.json()
        assert (page["username"], page["display_name"]) == ("principal", "Principal")
        assert {g["name"] for g in page["games"]} == {"Hades", "Celeste"}  # o oculto nunca aparece
        hades = next(g for g in page["games"] if g["name"] == "Hades")
        assert hades["tags"] == ["Roguelike", "Action"] and hades["user_score"] == 9
        for private in ("priority", "account_ids", "last_played_at", "hidden", "comments", "created_at"):
            assert private not in hades, private

        assert c.get("/api/public/ninguem").status_code == 404
        c.patch("/api/settings/profile", json={"public_page": False})
        assert c.get("/api/public/principal").json() == {"detail": "Página não encontrada"}


def test_public_page_opens_without_login(seeded, monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "true")
    get_settings.cache_clear()
    app = create_app()
    with TestClient(app, headers=HEADERS) as owner:
        owner.post("/api/auth/signup", json={"username": "bruno", "password": "senha-forte-1"})
        anon = TestClient(app)
        assert anon.get("/api/games").status_code == 401
        assert len(anon.get("/api/public/bruno").json()["games"]) == 2
        hidden_id = next(g["id"] for g in owner.get("/api/games").json() if g["hidden"])
        assert anon.get(f"/media/{hidden_id}/cover.webp").status_code == 401  # oculto: a imagem também não
