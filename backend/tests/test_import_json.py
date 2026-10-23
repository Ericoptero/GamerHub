from collections import Counter
from datetime import date

from sqlalchemy import func, select

from app.models import Device, Game, Platform, Store
from app.services.importer import import_short_json


def test_import_planilha_counts(db, planilha):
    report = import_short_json(db, 1, planilha)
    assert report.created == 240
    assert report.new_genres == []

    games = db.scalars(select(Game)).all()
    assert Counter(g.status for g in games) == {"backlog": 157, "done": 79, "dropped": 2, "hype": 2}
    assert db.scalar(select(func.count(Platform.id))) == 20
    assert db.scalar(select(func.count(Device.id))) == 7

    assert round(sum(g.hltb_main_hours or 0 for g in games if g.status == "backlog")) == 1875
    assert round(sum(g.played_hours or 0 for g in games if g.status == "done")) == 1259
    assert sum(1 for g in games if g.status == "backlog" and g.priority == "Alta") == 26
    scores = [g.user_score for g in games if g.status == "done" and g.user_score is not None]
    assert len(scores) == 71
    assert round(sum(scores) / len(scores), 1) == 7.8
    assert all(isinstance(s, int) for s in scores)


def test_import_dates_and_unknown_hours(db, planilha):
    import_short_json(db, 1, planilha)
    games = db.scalars(select(Game)).all()
    labelled = [g for g in games if g.finished_label == "Antes de 2022"]
    assert len(labelled) == 46
    assert all(g.finished_at is None for g in labelled)
    # t = 0 na planilha significa "não sei": vira NULL (45 dos 46 "Antes de 2022" têm t = 0)
    assert sum(1 for g in labelled if g.played_hours is None) == 45
    assert not any(g.played_hours == 0 for g in games)

    hype = [g for g in games if g.status == "hype"]
    assert len(hype) == 2
    assert all(g.release_date and g.finished_at is None for g in hype)
    totk = next(g for g in hype if "Tears of the Kingdom" in g.name)
    assert totk.release_date == date(2023, 5, 12)


def test_import_stores_normalized(db, planilha):
    import_short_json(db, 1, planilha)
    names = sorted(s.name for s in db.scalars(select(Store)))
    assert names.count("Steam") == 1 and names.count("Epic") == 1
    both = [g for g in db.scalars(select(Game)) if {s.name for s in g.stores} == {"Steam", "Epic"}]
    assert len(both) == 6


def test_duplicates_kept_and_reimport_is_noop(db, planilha):
    import_short_json(db, 1, planilha)
    hades = db.scalars(select(Game).where(Game.name == "Hades")).all()
    assert sorted(g.status for g in hades) == ["backlog", "done"]

    again = import_short_json(db, 1, planilha, mode="novos")
    assert again.created == 0 and again.skipped == 240


def test_update_mode_moves_status(db, planilha):
    import_short_json(db, 1, planilha)
    game = db.scalars(select(Game).where(Game.name == "Alien: Isolation")).one()
    assert game.status == "backlog"
    report = import_short_json(
        db, 1, [{"n": "Alien: Isolation", "p": "PC", "st": "done", "d": "2026-10-20", "t": 30, "u": 8}], mode="atualizar"
    )
    assert report.updated == 1 and report.created == 0
    db.refresh(game)
    assert (game.status, game.finished_at, game.user_score) == ("done", date(2026, 10, 20), 8)
    # campos ausentes na linha não são apagados
    assert game.genre is not None and game.hltb_main_hours == 18.5 and game.priority == "Media"
