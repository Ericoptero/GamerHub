"""Sincronização das contas de loja: resolução/mesclagem, horas jogadas, ignorados, job e checagem diária."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.enrichment import jobs
from app.integrations import registry as providers
from app.library import registry as stores
from app.library.base import AuthExpired, StoreGame, StoreProfile
from app.library.scheduler import due_accounts, queue_due_syncs
from app.library.sync import sync_account
from app.main import create_app
from app.models import Comment, ExternalLink, Game, Job, LibraryAccount, LibraryItem, Media
from app.schemas import GamePatch
from app.services import games as svc
from app.services.importer import import_short_json


class FakeStore:
    """Cliente de loja falso: cada conta (external_user_id) tem sua lista de jogos."""

    def __init__(self, store: str, libraries: dict[str, list[StoreGame]] | None = None, enabled: bool = True):
        self.store = store
        self.enabled = enabled
        self.libraries = libraries or {}
        self.error: Exception | None = None

    async def connect(self, ref: str) -> StoreProfile:
        return StoreProfile(external_user_id=ref.rstrip("/").split("/")[-1], display_name="Perfil", credentials={})

    async def fetch_library(self, external_user_id, credentials, save_credentials, known):
        if self.error:
            raise self.error
        await save_credentials({"refresh_token": "novo"})
        return [g.model_copy() for g in self.libraries.get(external_user_id, [])]

    async def aclose(self) -> None:
        pass


class FakeIGDB:
    name = "igdb"
    enabled = True

    def __init__(self, ids: dict[str, int] | None = None):
        self.ids = ids or {}

    async def lookup_external(self, source: int, uids: list[str]) -> dict[str, int]:
        return {u: self.ids[u] for u in uids if u in self.ids}


@pytest.fixture
def fake(db):
    clients = {s: FakeStore(s) for s in ("steam", "epic", "gog")}
    for s, c in clients.items():
        stores.set_store_client(s, c)
    igdb = FakeIGDB()
    providers.set_provider("igdb", igdb)
    yield SimpleNamespace(**clients, igdb=igdb)
    stores._clients.clear()
    providers._providers.clear()


def account(db, store: str, ext: str, nickname: str = "Conta", user_id: int = 1) -> int:
    a = LibraryAccount(
        user_id=user_id, store=store, nickname=nickname, external_user_id=ext, credentials={}, enabled=True, status="never"
    )
    db.add(a)
    db.commit()
    return a.id


def g(ext: str, name: str, minutes: int | None = None, cover: str | None = None) -> StoreGame:
    return StoreGame(external_id=ext, name=name, playtime_minutes=minutes, cover_url=cover)


def games_named(db, name: str) -> list[Game]:
    db.expire_all()
    return list(db.scalars(select(Game).where(Game.name == name)))


async def test_same_appid_in_two_steam_accounts_is_one_game(db, fake):
    a = account(db, "steam", "A", "Principal")
    b = account(db, "steam", "B", "Irmão")
    fake.steam.libraries = {"A": [g("1145360", "Hades", 600, "https://c/h.jpg")], "B": [g("1145360", "Hades", 120)]}

    first = await sync_account(a)
    second = await sync_account(b)

    assert len(first.created) == 1 and second.created == [] and second.linked == 1
    (hades,) = games_named(db, "Hades")
    assert hades.status == "owned" and hades.origin == "steam" and hades.platform.name == "PC"
    assert hades.cover_url == "https://c/h.jpg"
    assert [s.name for s in hades.stores] == ["Steam"]
    assert (hades.played_hours, hades.played_hours_source) == (12.0, "store")
    assert svc.ownership_index(db, 1)[hades.id][0] == [a, b]
    acc = db.get(LibraryAccount, a)
    assert acc.status == "ok" and acc.credentials == {"refresh_token": "novo"}


async def test_same_name_across_stores_is_one_game(db, fake):
    s, e = account(db, "steam", "S"), account(db, "epic", "E")
    fake.steam.libraries = {"S": [g("504230", "Celeste")]}
    fake.epic.libraries = {"E": [g("cat-celeste", "Celeste")]}
    await sync_account(s)
    await sync_account(e)
    (celeste,) = games_named(db, "Celeste")
    assert sorted(st.name for st in celeste.stores) == ["Epic", "Steam"]


async def test_igdb_id_merges_editions_and_prelinks(db, fake):
    s, gg = account(db, "steam", "S"), account(db, "gog", "G")
    fake.igdb.ids = {"292030": 1942, "1207664663": 1942}
    fake.steam.libraries = {"S": [g("292030", "The Witcher 3: Wild Hunt")]}
    fake.gog.libraries = {"G": [g("1207664663", "The Witcher 3: Wild Hunt - Complete Edition")]}
    await sync_account(s)
    report = await sync_account(gg)
    assert report.linked == 1 and report.created == []
    (w3,) = games_named(db, "The Witcher 3: Wild Hunt")
    link = db.scalar(select(ExternalLink).where(ExternalLink.game_id == w3.id))
    assert (link.provider, link.external_id, link.status) == ("igdb", "1942", "matched")


async def test_two_ids_of_one_account_never_merge(db, fake):
    s = account(db, "steam", "S")
    fake.steam.libraries = {"S": [g("379720", "DOOM"), g("2280", "DOOM"), g("2281", "Ultimate Doom")]}
    report = await sync_account(s)
    assert len(report.created) == 3
    doom = games_named(db, "DOOM")[0]
    dupes = {d.name for d in svc.to_detail(db, doom).duplicates}
    assert dupes == {"DOOM", "Ultimate Doom"}  # só sugestão de mesclar


async def test_igdb_veto_on_same_name(db, fake):
    import_short_json(db, 1, [{"n": "Prey", "p": "PC", "st": "done"}])
    prey = games_named(db, "Prey")[0]
    db.add(ExternalLink(game_id=prey.id, provider="igdb", external_id="17020", status="confirmed", candidates=[]))
    db.commit()
    s = account(db, "steam", "S")
    fake.igdb.ids = {"9999": 2026}  # o Prey de 2006, outro jogo no IGDB
    fake.steam.libraries = {"S": [g("9999", "Prey")]}
    report = await sync_account(s)
    assert len(report.created) == 1 and len(games_named(db, "Prey")) == 2


async def test_reuses_spreadsheet_game_and_keeps_typed_hours(db, fake):
    import_short_json(db, 1, [{"n": "Hollow Knight", "p": "PC", "st": "backlog", "pr": "Alta", "t": 10}])
    s = account(db, "steam", "S")
    fake.steam.libraries = {"S": [g("367520", "Hollow Knight", 900, "https://c/hk.jpg")]}
    report = await sync_account(s)
    assert report.linked == 1 and report.created == []
    (hk,) = games_named(db, "Hollow Knight")
    assert hk.status == "backlog" and hk.priority == "Alta"
    assert hk.cover_url == "https://c/hk.jpg"  # sem capa até agora: usa a da loja
    assert (hk.played_hours, hk.played_hours_source) == (10, "user")  # digitado na planilha
    assert [st.name for st in hk.stores] == ["Steam"]


async def test_store_account_means_you_own_it(db, fake):
    import_short_json(db, 1, [{"n": "Hollow Knight", "p": "PC", "st": "hype"}])
    (hk,) = games_named(db, "Hollow Knight")
    hk.access = "wishlist"
    db.commit()
    s = account(db, "steam", "S")
    fake.steam.libraries = {"S": [g("367520", "Hollow Knight")]}
    await sync_account(s)
    (hk,) = games_named(db, "Hollow Knight")
    assert (hk.status, hk.access) == ("hype", "owned")


async def test_played_hours_follow_store_until_user_edits(db, fake):
    s = account(db, "steam", "S")
    fake.steam.libraries = {"S": [g("1", "Tunic", 60)]}
    await sync_account(s)
    fake.steam.libraries = {"S": [g("1", "Tunic", 120)]}
    await sync_account(s)
    (tunic,) = games_named(db, "Tunic")
    assert (tunic.played_hours, tunic.played_hours_source) == (2.0, "store")

    svc.patch_game(db, tunic, GamePatch(played_hours=None))  # apagar também conta como "digitei"
    fake.steam.libraries = {"S": [g("1", "Tunic", 300)]}
    await sync_account(s)
    (tunic,) = games_named(db, "Tunic")
    assert (tunic.played_hours, tunic.played_hours_source) == (None, "user")


async def test_deleted_game_does_not_come_back(db, fake):
    a, b = account(db, "steam", "A"), account(db, "steam", "B")
    fake.steam.libraries = {"A": [g("10", "Spacewar")], "B": [g("10", "Spacewar")]}
    await sync_account(a)
    svc.delete_game(db, games_named(db, "Spacewar")[0])

    again = await sync_account(a)
    other = await sync_account(b)
    assert again.created == [] and again.ignored == 1
    assert other.created == [] and other.ignored == 1  # nem por outra conta da mesma loja
    assert games_named(db, "Spacewar") == []


async def test_auth_expired_marks_reauth(db, fake):
    e = account(db, "epic", "E")
    fake.epic.error = AuthExpired("epic: login recusado")
    with pytest.raises(AuthExpired):
        await sync_account(e)
    db.expire_all()
    acc = db.get(LibraryAccount, e)
    assert acc.status == "reauth" and "reconecte" in acc.last_error and acc.last_attempt_at is not None


async def test_job_queues_metadata_only_for_new_games(db, fake):
    s = account(db, "steam", "S", "Principal")
    fake.steam.libraries = {"S": [g("1", "Tunic"), g("2", "Celeste")]}
    job = jobs.request_library_sync(db, 1, [s], "teste")
    assert jobs.request_library_sync(db, 1, [s], "de novo").id == job.id  # o mesmo pedido na fila
    await jobs.run_job(job.id)
    db.expire_all()
    done = db.get(Job, job.id)
    assert done.status == "done" and done.succeeded == 1
    assert done.log[0].startswith("Steam · Principal: 2 na conta, 2 novos")
    enrich = db.scalars(select(Job).where(Job.kind == "enrich")).all()
    assert len(enrich) == 1 and sorted(enrich[0].params["game_ids"]) == sorted(
        x.id for x in games_named(db, "Tunic") + games_named(db, "Celeste")
    )

    again = jobs.request_library_sync(db, 1, [s], "teste")
    await jobs.run_job(again.id)
    assert len(db.scalars(select(Job).where(Job.kind == "enrich")).all()) == 1  # nada novo, nenhum enrich


def test_due_accounts_respects_hour_and_local_day():
    tz = timezone(timedelta(hours=-4))  # America/Manaus
    now = datetime(2026, 10, 23, 6, 0, tzinfo=tz)
    utc = lambda *a: datetime(*a)  # noqa: E731 (naive UTC, como no banco)
    accs = [
        SimpleNamespace(id=1, user_id=1, enabled=True, status="ok", last_attempt_at=None),
        SimpleNamespace(id=2, user_id=1, enabled=True, status="ok", last_attempt_at=utc(2026, 10, 23, 3, 30)),  # 22/10 23:30 local
        SimpleNamespace(id=3, user_id=1, enabled=True, status="ok", last_attempt_at=utc(2026, 10, 23, 9, 0)),  # hoje 05:00 local
        SimpleNamespace(id=4, user_id=2, enabled=True, status="error", last_attempt_at=None),
        SimpleNamespace(id=5, user_id=2, enabled=False, status="ok", last_attempt_at=None),
        SimpleNamespace(id=6, user_id=2, enabled=True, status="reauth", last_attempt_at=None),
    ]
    assert due_accounts(accs, now, hour=5) == {1: [1, 2], 2: [4]}
    assert due_accounts(accs, now.replace(hour=4), hour=5) == {}


def test_queue_due_syncs_once_per_day(db, fake):
    account(db, "steam", "S")
    now = datetime.now().astimezone().replace(hour=23)
    assert queue_due_syncs(now) == 1
    assert queue_due_syncs(now) == 0  # já marcada como tentada hoje
    assert len(db.scalars(select(Job).where(Job.kind == "library_sync")).all()) == 1


async def test_import_promotes_owned_game(db, fake):
    s = account(db, "steam", "S")
    fake.steam.libraries = {"S": [g("1145360", "Hades", 600)]}
    await sync_account(s)
    report = import_short_json(db, 1, [{"n": "Hades", "p": "PC", "st": "done", "u": 9, "t": 40}], mode="novos")
    assert report.created == 0 and report.updated == 1
    (hades,) = games_named(db, "Hades")
    assert (hades.status, hades.user_score, hades.played_hours, hades.played_hours_source) == ("done", 9, 40, "user")


async def test_merge_games(db, fake):
    s = account(db, "steam", "S")
    fake.steam.libraries = {"S": [g("1", "Witcher 3", 300)]}
    await sync_account(s)
    import_short_json(db, 1, [{"n": "The Witcher 3: Wild Hunt", "p": "PC", "st": "backlog", "pr": "Alta", "u": 10}])
    target = games_named(db, "Witcher 3")[0]
    source = games_named(db, "The Witcher 3: Wild Hunt")[0]
    target.media.append(Media(kind="screenshot", url="https://x/1.jpg", provider="manual", position=0))
    target.links.append(ExternalLink(provider="igdb", external_id="1942", status="matched", candidates=[]))
    source.media.append(Media(kind="screenshot", url="https://x/1.jpg", provider="manual", position=0))
    source.media.append(Media(kind="screenshot", url="https://x/2.jpg", provider="manual", position=1))
    source.links.append(ExternalLink(provider="rawg", external_id="3328", status="confirmed", candidates=[]))
    source.comments.append(Comment(body="zerar o DLC"))
    target.access = "gamepass"
    db.commit()
    source_id = source.id

    merged = svc.merge_games(db, target, source)

    db.expire_all()
    assert db.get(Game, source_id) is None
    assert (merged.status, merged.priority, merged.user_score) == ("backlog", "Alta", 10)
    assert merged.access == "owned"  # a origem você tem
    assert [c.body for c in merged.comments] == ["zerar o DLC"]
    assert sorted(m.url for m in merged.media) == ["https://x/1.jpg", "https://x/2.jpg"]
    assert sorted(lk.provider for lk in merged.links) == ["igdb", "rawg"]
    assert db.scalar(select(LibraryItem.game_id).where(LibraryItem.account_id == s)) == merged.id
    assert merged.played_hours == 5.0
    with pytest.raises(HTTPException):
        svc.merge_games(db, merged, merged)


def test_accounts_api(data_dir, fake):
    with TestClient(create_app()) as c:
        r = c.post("/api/accounts", json={"store": "steam", "nickname": "Principal", "ref": "https://steamcommunity.com/id/JogadorExemplo/"})
        assert r.status_code == 201, r.text
        acc = r.json()
        assert acc["external_user_id"] == "JogadorExemplo" and acc["status"] == "never" and "credentials" not in acc
        assert [j["kind"] for j in c.get("/api/jobs").json()] == ["library_sync"]
        dup = c.post("/api/accounts", json={"store": "steam", "nickname": "De novo", "ref": "JogadorExemplo"})
        assert dup.status_code == 409 and "Principal" in dup.json()["detail"]

        assert c.patch(f"/api/accounts/{acc['id']}", json={"nickname": "Bruno"}).json()["nickname"] == "Bruno"
        assert c.post("/api/accounts/sync", json={}).status_code == 202
        assert c.get("/api/accounts/login-url", params={"store": "epic"}).json()["url"].startswith("https://www.epicgames.com/")
        assert c.get("/api/accounts/login-url", params={"store": "steam"}).status_code == 404
        meta = c.get("/api/meta").json()
        assert meta["stores"] == {"steam": False, "epic": True, "gog": True} and meta["library_sync_hour"] == 5

        fake.steam.enabled = False
        r = c.post("/api/accounts", json={"store": "steam", "nickname": "X", "ref": "outro"})
        assert r.status_code == 409 and "Configurações" in r.json()["detail"]

        assert c.delete(f"/api/accounts/{acc['id']}").status_code == 204
        assert c.get("/api/accounts").json() == []


async def test_card_and_detail_show_accounts(db, fake):
    a, b = account(db, "steam", "A", "Principal"), account(db, "epic", "B", "Epic do Bruno")
    fake.steam.libraries = {"A": [g("1145360", "Hades", 600)]}
    fake.epic.libraries = {"B": [g("cat", "Hades", 60)]}
    await sync_account(a)
    await sync_account(b)
    (hades,) = games_named(db, "Hades")
    card = svc.to_card(hades, svc.ownership_index(db, 1))
    assert card.account_ids == [a, b] and sorted(card.stores) == ["Epic", "Steam"] and card.enriched is False
    detail = svc.to_detail(db, hades)
    assert [(o.store, o.nickname, o.playtime_hours) for o in detail.ownerships] == [
        ("steam", "Principal", 10.0),
        ("epic", "Epic do Bruno", 1.0),
    ]


async def test_restore_relinks_ownerships(db, fake):
    from app.services.exporter import export_json, restore_json

    a = account(db, "steam", "A")
    fake.steam.libraries = {"A": [g("1", "Witcher 3"), g("2", "Witcher 3 GOTY")]}
    await sync_account(a)
    w3, goty = games_named(db, "Witcher 3")[0], games_named(db, "Witcher 3 GOTY")[0]
    svc.merge_games(db, w3, goty)  # mesclado à mão: o restore precisa manter

    restored = restore_json(db, 1, export_json(db, 1))
    assert restored["games"] == 1
    (w3,) = games_named(db, "Witcher 3")
    items = db.scalars(select(LibraryItem).where(LibraryItem.account_id == a)).all()
    assert {i.game_id for i in items} == {w3.id}
