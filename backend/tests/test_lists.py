"""Listas criadas pelo usuário: CRUD, ordem, dono, mesclagem, página pública e export."""

import json

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app
from tests.conftest import BIBLIOTECA

HEADERS = {"X-GamerHub": "1"}


@pytest.fixture
def loaded(data_dir):
    with TestClient(create_app(), headers=HEADERS) as c:
        r = c.post("/api/import/json", files={"file": ("b.json", BIBLIOTECA.read_bytes(), "application/json")})
        assert r.status_code == 200, r.text
        yield c


def _ids(client, *names):
    games = client.get("/api/games").json()
    return [next(g["id"] for g in games if g["name"] == n) for n in names]


def _new_list(client, **data):
    r = client.post("/api/lists", json={"name": "Metroidvanias", **data})
    assert r.status_code == 201, r.text
    return r.json()


def test_crud_and_order(loaded):
    lst = _new_list(loaded, name="  Metroidvanias  ", description="  ")
    assert (lst["name"], lst["description"], lst["ranked"], lst["public"], lst["game_ids"]) == (
        "Metroidvanias",
        None,
        False,
        True,
        [],
    )
    hk, mf, silk = _ids(loaded, "Hollow Knight", "Metroid Fusion", "Hollow Knight: Silksong")
    url = f"/api/lists/{lst['id']}"
    for gid in (hk, mf, silk, hk):  # o repetido não entra de novo
        assert loaded.post(f"{url}/games", json={"game_id": gid}).status_code == 201
    assert loaded.get(url).json()["game_ids"] == [hk, mf, silk]

    assert loaded.put(f"{url}/games", json={"game_ids": [silk, hk, mf]}).json()["game_ids"] == [silk, hk, mf]
    for bad in ([silk, hk], [silk, hk, mf, mf], [silk, hk, mf, 9999]):
        assert loaded.put(f"{url}/games", json={"game_ids": bad}).status_code == 422
    assert loaded.delete(f"{url}/games/{hk}").json()["game_ids"] == [silk, mf]
    assert loaded.delete(f"{url}/games/{hk}").status_code == 200  # tirar de novo não é erro
    assert loaded.post(f"{url}/games", json={"game_id": hk}).json()["game_ids"] == [silk, mf, hk]

    body = {"ranked": True, "public": False, "description": "Os melhores", "name": None}
    patched = loaded.patch(url, json=body).json()
    assert (patched["name"], patched["ranked"], patched["public"], patched["description"]) == (
        "Metroidvanias",
        True,
        False,
        "Os melhores",
    )
    assert loaded.post(f"{url}/games", json={"game_id": 9999}).status_code == 404

    other = _new_list(loaded, name="Curtos")
    order = lambda: [x["id"] for x in loaded.get("/api/lists").json()]  # noqa: E731
    assert order() == [other["id"], lst["id"]]  # recentes primeiro
    loaded.post(f"{url}/games", json={"game_id": mf})  # já está: nada muda, não sobe
    assert order() == [other["id"], lst["id"]]
    loaded.put(f"{url}/games", json={"game_ids": [mf, silk, hk]})
    assert order() == [lst["id"], other["id"]]

    assert loaded.delete(url).status_code == 204
    assert loaded.get(url).status_code == 404
    assert [x["id"] for x in loaded.get("/api/lists").json()] == [other["id"]]


def test_deleted_game_leaves_lists_and_merge_moves_it(loaded):
    hades_done, hades_backlog = (g["id"] for g in loaded.get("/api/games").json() if g["name"] == "Hades")
    celeste, dead = _ids(loaded, "Celeste", "Dead Space")
    a = _new_list(loaded, name="A")
    b = _new_list(loaded, name="B")
    for gid in (hades_backlog, celeste, dead):
        loaded.post(f"/api/lists/{a['id']}/games", json={"game_id": gid})
    for gid in (hades_done, hades_backlog):
        loaded.post(f"/api/lists/{b['id']}/games", json={"game_id": gid})

    assert loaded.delete(f"/api/games/{dead}").status_code == 204
    r = loaded.post(f"/api/games/{hades_done}/merge", json={"source_id": hades_backlog})
    assert r.status_code == 200, r.text
    # A: o destino herda o lugar da origem. B: já tinha o destino, a origem só sai.
    assert loaded.get(f"/api/lists/{a['id']}").json()["game_ids"] == [hades_done, celeste]
    assert loaded.get(f"/api/lists/{b['id']}").json()["game_ids"] == [hades_done]


def test_public_page_shows_public_lists_without_hidden_games(loaded):
    hk, mf, celeste = _ids(loaded, "Hollow Knight", "Metroid Fusion", "Celeste")
    pub = _new_list(loaded, name="Pública", ranked=True)
    priv = _new_list(loaded, name="Privada", public=False)
    only_hidden = _new_list(loaded, name="Só oculto")
    for lst, gids in ((pub, (hk, mf)), (priv, (celeste,)), (only_hidden, (celeste,))):
        for gid in gids:
            loaded.post(f"/api/lists/{lst['id']}/games", json={"game_id": gid})
    loaded.patch(f"/api/games/{mf}", json={"hidden": True})
    loaded.patch(f"/api/games/{celeste}", json={"hidden": True})

    page = loaded.get("/api/public/principal").json()
    assert page["lists"] == [
        {"id": pub["id"], "name": "Pública", "description": None, "ranked": True, "game_ids": [hk]}
    ]


def test_lists_belong_to_their_owner(data_dir, monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "true")
    get_settings.cache_clear()
    app = create_app()
    with TestClient(app, headers=HEADERS) as ana, TestClient(app, headers=HEADERS) as bia:
        assert ana.post("/api/auth/signup", json={"username": "ana", "password": "senha-forte-1"}).status_code == 201
        assert bia.post("/api/auth/signup", json={"username": "bia", "password": "senha-forte-2"}).status_code == 201
        platform = ana.get("/api/platforms").json()[0]["id"]
        game = ana.post("/api/games", json={"name": "Hades", "platform_id": platform}).json()
        lst = _new_list(ana)
        assert ana.post(f"/api/lists/{lst['id']}/games", json={"game_id": game["id"]}).status_code == 201

        assert bia.get("/api/lists").json() == []
        assert bia.get(f"/api/lists/{lst['id']}").status_code == 404
        assert bia.patch(f"/api/lists/{lst['id']}", json={"name": "minha"}).status_code == 404
        mine = _new_list(bia)
        assert bia.post(f"/api/lists/{mine['id']}/games", json={"game_id": game["id"]}).status_code == 404
        assert TestClient(app).get("/api/lists").status_code == 401

        r = ana.patch("/api/settings/profile", json={"username": "listas"})
        assert r.status_code == 422, r.text


def test_export_roundtrip_keeps_lists(loaded):
    hk, mf = _ids(loaded, "Hollow Knight", "Metroid Fusion")
    lst = _new_list(loaded, ranked=True, public=False, description="Os melhores")
    loaded.put(f"/api/lists/{lst['id']}/games", json={"game_ids": []})
    for gid in (mf, hk):
        loaded.post(f"/api/lists/{lst['id']}/games", json={"game_id": gid})
    _new_list(loaded, name="Vazia")

    exported = loaded.get("/api/export.json").json()
    assert [x["name"] for x in exported["lists"]] == ["Metroidvanias", "Vazia"]
    r = loaded.post(
        "/api/import/json?mode=substituir",
        files={"file": ("export.json", json.dumps(exported).encode(), "application/json")},
    )
    assert r.status_code == 200, r.text
    lists = {x["name"]: x for x in loaded.get("/api/lists").json()}
    assert set(lists) == {"Metroidvanias", "Vazia"}
    restored = lists["Metroidvanias"]
    assert (restored["ranked"], restored["public"], restored["description"]) == (True, False, "Os melhores")
    assert restored["game_ids"] == _ids(loaded, "Metroid Fusion", "Hollow Knight")
    assert loaded.get("/api/export.json").json()["lists"] == exported["lists"]

    del exported["lists"]  # export de antes das listas
    r = loaded.post(
        "/api/import/json?mode=substituir",
        files={"file": ("export.json", json.dumps(exported).encode(), "application/json")},
    )
    assert r.status_code == 200, r.text
    assert loaded.get("/api/lists").json() == []
