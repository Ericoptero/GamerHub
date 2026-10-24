"""'Precisa da sua ajuda': pendências agrupadas por jogo, busca avulsa por outro nome e confirmação."""

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import db as dbmod
from app.integrations import registry
from app.integrations.base import Candidate, MatchContext
from app.main import create_app
from app.models import ExternalLink, Game, Job


class FakeSearch:
    """Provider que só busca: guarda o contexto recebido e devolve candidatos fixos."""

    def __init__(self, name: str):
        self.name = name
        self.enabled = True
        self.contexts: list[MatchContext] = []

    async def search(self, query: str, ctx: MatchContext) -> list[Candidate]:
        self.contexts.append(ctx)
        return [
            Candidate(provider=self.name, external_id="10270", name="Pokémon Emerald", year=2004, url="https://hltb/10270"),
            Candidate(provider=self.name, external_id="999", name="Pokémon Ruby", year=2002),
        ]

    async def fetch(self, external_id, ctx, hint=None):
        raise AssertionError("não deveria buscar detalhes aqui")


@pytest.fixture
def client(data_dir):
    with TestClient(create_app()) as c:
        yield c
    registry._providers.clear()


def _game(client, name: str, platform: str = "GBA", release: date | None = None) -> int:
    pid = next(p["id"] for p in client.get("/api/platforms").json() if p["name"] == platform)
    body = {"name": name, "platform_id": pid, "release_date": release.isoformat() if release else None}
    return client.post("/api/games", json=body).json()["id"]


def _links(game_id: int, **statuses: str) -> None:
    with dbmod.new_session() as db:
        for provider, status in statuses.items():
            db.add(
                ExternalLink(
                    game_id=game_id,
                    provider=provider,
                    status=status,
                    external_id="1" if status in ("matched", "confirmed") else None,
                    matched_name="Algo" if status in ("matched", "confirmed") else None,
                    candidates=[{"external_id": "5", "name": "Talvez"}] if status == "ambiguous" else [],
                    last_error="timeout" if status == "error" else None,
                )
            )
        db.commit()


def test_pending_is_one_item_per_game_with_all_links(client):
    emerald = _game(client, "Pokémon Esmeralda", release=date(2004, 5, 1))
    _links(emerald, igdb="ambiguous", rawg="matched", hltb="not_found", metacritic="error")
    ok = _game(client, "Advance Wars")
    _links(ok, igdb="confirmed", hltb="matched")
    only_hltb = _game(client, "Golden Sun")
    _links(only_hltb, hltb="not_found")

    items = client.get("/api/integrations/pending").json()
    assert [i["name"] for i in items] == ["Golden Sun", "Pokémon Esmeralda"]
    first = items[1]
    assert first["platform"] == "GBA" and first["release_date"] == "2004-05-01"
    assert {lk["provider"]: lk["status"] for lk in first["links"]} == {
        "igdb": "ambiguous",
        "rawg": "matched",
        "hltb": "not_found",
        "metacritic": "error",
    }
    assert [i["name"] for i in client.get("/api/integrations/pending", params={"provider": "igdb"}).json()] == [
        "Pokémon Esmeralda"
    ]


def test_search_by_other_name_uses_game_context(client):
    hltb = FakeSearch("hltb")
    registry.set_provider("hltb", hltb)
    gid = _game(client, "Pokémon Esmeralda", release=date(2004, 5, 1))

    r = client.get("/api/integrations/search", params={"provider": "hltb", "q": "Pokemon Emerald", "game_id": gid})
    assert r.status_code == 200, r.text
    assert [c["external_id"] for c in r.json()] == ["10270", "999"]  # ranqueado: nome e ano batem
    ctx = hltb.contexts[-1]
    assert ctx.name == "Pokemon Emerald" and ctx.year == 2004
    assert ctx.platform == "GBA" and ctx.hltb_platform == "Game Boy Advance"

    assert client.get("/api/integrations/search", params={"provider": "hltb", "q": "x", "game_id": gid}).status_code == 422
    assert (
        client.get("/api/integrations/search", params={"provider": "hltb", "q": "Pokemon", "game_id": 99999}).status_code
        == 404
    )


def test_confirm_result_from_other_name_keeps_name_and_url(client):
    gid = _game(client, "Pokémon Esmeralda")
    _links(gid, hltb="not_found")
    body = {"external_id": "10270", "name": "Pokémon Emerald", "url": "https://hltb/10270", "score": 98}
    job = client.put(f"/api/games/{gid}/links/hltb", json=body)
    assert job.status_code == 202 and job.json()["params"]["providers"] == ["hltb"]
    with dbmod.new_session() as db:
        link = db.scalar(select(ExternalLink).where(ExternalLink.game_id == gid, ExternalLink.provider == "hltb"))
        assert (link.status, link.external_id, link.matched_name, link.external_url) == (
            "confirmed",
            "10270",
            "Pokémon Emerald",
            "https://hltb/10270",
        )
        assert db.get(Job, job.json()["id"]).kind == "refresh"
    assert client.get("/api/integrations/pending").json() == []


def test_pending_skips_hidden_games(client):
    gid = _game(client, "Metroid Fusion")
    _links(gid, igdb="not_found")
    assert len(client.get("/api/integrations/pending").json()) == 1
    client.patch(f"/api/games/{gid}", json={"hidden": True})
    assert client.get("/api/integrations/pending").json() == []


def test_pending_hides_other_users_games(client):
    gid = _game(client, "Metroid Fusion")
    _links(gid, igdb="not_found")
    with dbmod.new_session() as db:
        from app.models import User

        db.add(User(id=2, username="ana", display_name="Ana", is_admin=False))
        db.get(Game, gid).user_id = 2
        db.commit()
    assert client.get("/api/integrations/pending").json() == []
