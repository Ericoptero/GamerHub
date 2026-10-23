import json
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from tests.conftest import PLANILHA


@pytest.fixture
def client(data_dir):
    with TestClient(create_app()) as c:
        yield c


@pytest.fixture
def loaded(client):
    r = client.post("/api/import/json", files={"file": ("planilha.json", PLANILHA.read_bytes(), "application/json")})
    assert r.status_code == 200, r.text
    assert r.json()["created"] == 240
    return client


def _find(client, name):
    return next(g for g in client.get("/api/games").json() if g["name"] == name)


def test_health_and_meta(client):
    assert client.get("/api/health").json() == {"status": "ok"}
    meta = client.get("/api/meta").json()
    assert meta["statuses"]["backlog"] == "Lista de espera"
    assert meta["providers"] == {"igdb": False, "rawg": False, "hltb": True, "metacritic": True}
    assert len(client.get("/api/genres").json()) == 13
    assert len(client.get("/api/devices").json()) == 7


def test_list_and_detail(loaded):
    games = loaded.get("/api/games").json()
    assert len(games) == 240
    card = _find(loaded, "Eastward")
    detail = loaded.get(f"/api/games/{card['id']}").json()
    assert detail["platform"] == "PC" and detail["status"] == "done" and detail["user_score"] == 8
    assert detail["review_text"].startswith("Eastward é um jogo")
    assert detail["comments"] == [] and detail["locked_fields"] == []


def test_patch_status_review_and_lock(loaded):
    gid = _find(loaded, "Alien: Isolation")["id"]
    r = loaded.patch(f"/api/games/{gid}", json={"status": "done", "user_score": 9, "review_text": "Tenso!"})
    body = r.json()
    assert body["status"] == "done" and body["finished_at"] == date.today().isoformat()
    assert body["locked_fields"] == []

    r = loaded.patch(f"/api/games/{gid}", json={"hltb_main_hours": 20, "metacritic_score": 81})
    body = r.json()
    assert body["locked_fields"] == ["hltb_main_hours", "metacritic_score"]
    assert body["metacritic_source"] == "manual"

    body = loaded.patch(f"/api/games/{gid}", json={"unlock": ["hltb_main_hours"]}).json()
    assert body["locked_fields"] == ["metacritic_score"] and body["hltb_main_hours"] == 20

    assert loaded.patch(f"/api/games/{gid}", json={"user_score": 11}).status_code == 422


def test_comments_crud(loaded):
    gid = _find(loaded, "Eastward")["id"]
    c = loaded.post(f"/api/games/{gid}/comments", json={"body": "parei no capítulo 6"}).json()
    loaded.post(f"/api/games/{gid}/comments", json={"body": "voltei"})
    detail = loaded.get(f"/api/games/{gid}").json()
    assert [x["body"] for x in detail["comments"]] == ["voltei", "parei no capítulo 6"]
    loaded.patch(f"/api/comments/{c['id']}", json={"body": "editado"})
    assert loaded.delete(f"/api/comments/{c['id']}").status_code == 204
    assert len(loaded.get(f"/api/games/{gid}").json()["comments"]) == 1


def test_create_manual_game(loaded):
    pc = next(p for p in loaded.get("/api/platforms").json() if p["name"] == "PC")
    r = loaded.post(
        "/api/games",
        json={
            "name": "Hollow Knight",
            "platform_id": pc["id"],
            "status": "backlog",
            "priority": "Alta",
            "hltb_main_hours": 27,
            "stores": ["Steam"],
            "video_url": "https://www.youtube.com/watch?v=UAO2urG23S4",
            "screenshots": ["https://example.com/a.jpg", ""],
        },
    )
    assert r.status_code == 201, r.text
    g = r.json()
    assert g["origin"] == "manual" and g["stores"] == ["Steam"]
    assert g["locked_fields"] == ["hltb_main_hours"]
    kinds = sorted(m["kind"] for m in g["media"])
    assert kinds == ["screenshot", "video"]
    video = next(m for m in g["media"] if m["kind"] == "video")
    assert video["thumb"] == "https://i.ytimg.com/vi/UAO2urG23S4/hqdefault.jpg"
    assert loaded.delete(f"/api/games/{g['id']}").status_code == 204
    assert loaded.get(f"/api/games/{g['id']}").status_code == 404


def test_platform_delete_conflict_and_devices(loaded):
    plats = {p["name"]: p for p in loaded.get("/api/platforms").json()}
    assert plats["GBA"]["game_count"] == 29
    r = loaded.delete(f"/api/platforms/{plats['GBA']['id']}")
    assert r.status_code == 409 and "29" in r.json()["detail"]
    assert loaded.post("/api/platforms", json={"name": "gba"}).status_code == 409

    new = loaded.post("/api/platforms", json={"name": "PC Engine"}).json()
    dev = loaded.post(
        "/api/devices", json={"name": "Anbernic RG35XX", "kind": "Emulador / retro", "platform_ids": [new["id"]]}
    ).json()
    assert dev["platform_ids"] == [new["id"]]
    dev = loaded.patch(f"/api/devices/{dev['id']}", json={"platform_ids": [new["id"], plats["GBA"]["id"]]}).json()
    assert len(dev["platform_ids"]) == 2
    assert loaded.delete(f"/api/platforms/{new['id']}").status_code == 204
    assert loaded.delete(f"/api/devices/{dev['id']}").status_code == 204


def test_export_roundtrip(loaded, tmp_path):
    gid = _find(loaded, "Eastward")["id"]
    loaded.post(f"/api/games/{gid}/comments", json={"body": "nota de progresso"})
    exported = loaded.get("/api/export.json").json()
    assert exported["version"] == 1 and len(exported["games"]) == 240

    csv_text = loaded.get("/api/export.csv").content.decode("utf-8")
    assert csv_text.startswith("﻿Nome;Plataforma")
    assert len(csv_text.strip().splitlines()) == 241

    r = loaded.post(
        "/api/import/json?mode=substituir",
        files={"file": ("export.json", json.dumps(exported).encode(), "application/json")},
    )
    assert r.status_code == 200, r.text
    again = loaded.get("/api/export.json").json()
    strip = lambda d: [{k: v for k, v in g.items() if k != "created_at"} for g in d["games"]]  # noqa: E731
    assert strip(again) == strip(exported)
    assert again["devices"] == exported["devices"]
    eastward = _find(loaded, "Eastward")
    assert loaded.get(f"/api/games/{eastward['id']}").json()["comments"][0]["body"] == "nota de progresso"


def test_backup_download(loaded):
    r = loaded.get("/api/backup.sqlite")
    assert r.status_code == 200 and r.content[:15] == b"SQLite format 3"


def test_spa_fallback_without_build(client):
    r = client.get("/biblioteca")
    assert r.status_code == 200 and "GamerHub" in r.text
    assert client.get("/api/nada").status_code == 404


def test_integration_and_job_endpoints(loaded):
    r = loaded.get("/api/integrations/search", params={"provider": "igdb", "q": "Hollow Knight"})
    assert r.status_code == 409  # sem chave no teste

    gid = _find(loaded, "Eastward")["id"]
    job = loaded.post(f"/api/games/{gid}/refresh", json={"providers": ["hltb"]}).json()
    assert job["status"] == "queued" and job["kind"] == "refresh" and job["params"]["game_ids"] == [gid]
    assert loaded.get(f"/api/jobs/{job['id']}").json()["id"] == job["id"]
    assert loaded.post(f"/api/jobs/{job['id']}/cancel").json()["status"] == "cancelled"

    batch = loaded.post("/api/jobs/enrich", json={"scope": "missing"}).json()
    assert batch["total"] == 240
    assert [j["id"] for j in loaded.get("/api/jobs").json()][:2] == [batch["id"], job["id"]]

    job = loaded.put(f"/api/games/{gid}/links/metacritic", json={"external_id": "eastward"}).json()
    assert job["params"]["providers"] == ["metacritic"]
    links = loaded.delete(f"/api/games/{gid}/links/hltb").json()
    assert {lk["provider"]: lk["status"] for lk in links} == {"hltb": "ignored", "metacritic": "confirmed"}
    assert loaded.get("/api/integrations/pending").json() == []
    assert loaded.put(f"/api/games/{gid}/links/steam", json={"external_id": "1"}).status_code == 404
