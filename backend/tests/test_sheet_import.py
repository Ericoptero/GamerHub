import io
from datetime import date, datetime

from openpyxl import Workbook
from sqlalchemy import select

from app.models import Game
from app.services import sheet_import
from app.services.normalize import parse_date, parse_number, parse_priority, parse_status


def test_normalizers():
    assert parse_number("12,5") == 12.5
    assert parse_number("12h30") == 12.5
    assert parse_number("12:45") == 12.75
    assert parse_number("1.234,5") == 1234.5
    assert parse_number("—") is None and parse_number("") is None
    assert parse_date("17/01/2026") == (date(2026, 1, 17), None)
    assert parse_date(datetime(2026, 1, 17, 0, 0)) == (date(2026, 1, 17), None)
    assert parse_date(46039) == (date(2026, 1, 17), None)  # serial do Excel
    assert parse_date("Antes de 2022") == (None, "Antes de 2022")
    assert parse_status("Lista de espera") == "backlog"
    assert parse_status("Finalizados 2025") == "done"
    assert parse_status("Dropados") == "dropped"
    assert parse_priority("Média") == "Media"


def test_suggest_mapping():
    headers = ["Jogo", "Plataforma", "Gênero", "Prioridade", "HLTB", "Loja", "Zerado em", "Tempo", "Nota", "Comentário"]
    m = sheet_import.suggest_mapping(headers)
    assert m == {
        "name": 0, "platform": 1, "genre": 2, "priority": 3, "hltb_hours": 4, "stores": 5,
        "date": 6, "played_hours": 7, "user_score": 8, "review": 9,
    }  # fmt: skip
    # o CSV que o próprio app exporta é reconhecido inteiro
    from app.services.exporter import CSV_HEADERS

    assert len(sheet_import.suggest_mapping(CSV_HEADERS)) == len(CSV_HEADERS)


def _xlsx() -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Lista de espera"
    ws.append(["Jogo", "Plataforma", "Prioridade", "HLTB", "Loja"])
    ws.append(["Hollow Knight", "PC", "Alta", "27,5", "Steam, GOG"])
    ws.append(["Advance Wars", "GBA", "Média", 15, None])
    ws.append([None, None, None, None, None])
    done = wb.create_sheet("Finalizados")
    done.append(["Nome", "Plataforma", "Zerado em", "Tempo", "Nota", "Review"])
    done.append(["Celeste", "Switch", datetime(2025, 3, 2), "12h30", 9, "Perfeito"])
    done.append(["Doom", "PC", "Antes de 2022", None, 8, None])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_xlsx_preview_dry_run_and_commit(db):
    prev = sheet_import.preview("minha planilha.xlsx", _xlsx())
    assert [s.name for s in prev.sheets] == ["Lista de espera", "Finalizados"]
    wait, done = prev.sheets
    assert wait.status_hint == "backlog" and done.status_hint == "done"
    assert wait.row_count == 2 and done.sample[0][2] == "02/03/2025"
    assert done.mapping["date"] == 2 and done.mapping["played_hours"] == 3

    choices = [sheet_import.SheetChoice(name=s.name, mapping=s.mapping) for s in prev.sheets]
    dry = sheet_import.commit(db, 1, sheet_import.SheetCommit(token=prev.token, sheets=choices, dry_run=True))
    assert dry.created == 4 and [r["action"] for r in dry.rows] == ["criar"] * 4
    assert db.scalar(select(Game.id)) is None  # simulação não grava

    report = sheet_import.commit(db, 1, sheet_import.SheetCommit(token=prev.token, sheets=choices))
    assert report.created == 4
    games = {g.name: g for g in db.scalars(select(Game))}
    hk = games["Hollow Knight"]
    assert (hk.status, hk.priority, hk.hltb_main_hours) == ("backlog", "Alta", 27.5)
    assert sorted(s.name for s in hk.stores) == ["GOG", "Steam"]
    assert games["Advance Wars"].priority == "Media"
    celeste = games["Celeste"]
    assert (celeste.status, celeste.finished_at, celeste.played_hours, celeste.user_score) == (
        "done", date(2025, 3, 2), 12.5, 9
    )  # fmt: skip
    assert games["Doom"].finished_label == "Antes de 2022"


def test_csv_semicolon_cp1252(db):
    data = "Nome;Plataforma;Lista;Nota\r\nPokémon Emerald;GBA;Finalizado;8\r\nChrono Trigger;SNES;Lista de espera;\r\n"
    prev = sheet_import.preview("jogos.csv", data.encode("cp1252"))
    sheet = prev.sheets[0]
    assert sheet.mapping == {"name": 0, "platform": 1, "status": 2, "user_score": 3}
    report = sheet_import.commit(
        db,
        1,
        sheet_import.SheetCommit(
            token=prev.token, sheets=[sheet_import.SheetChoice(name=sheet.name, mapping=sheet.mapping)]
        ),
    )
    assert report.created == 2
    pk = db.scalars(select(Game).where(Game.name == "Pokémon Emerald")).one()
    assert (pk.status, pk.user_score, pk.platform.name) == ("done", 8, "GBA")


def test_rejects_unknown_extension():
    import pytest

    with pytest.raises(ValueError):
        sheet_import.preview("dados.ods", b"x")
