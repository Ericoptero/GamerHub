"""Importação de jogos da planilha: formato curto do JSON exportado (n, p, g, st…) e linhas de CSV/XLSX.

As duas fontes viram `GameRow` e passam por `upsert_rows`, que aplica o modo:
- novos: ignora linhas cuja chave (nome normalizado, plataforma, status) já existe;
- atualizar: sobrescreve os campos presentes na linha; se a chave não existe mas há
  exatamente um jogo com o mesmo (nome, plataforma), atualiza esse (mudança de status);
- substituir: faz backup e apaga todos os jogos antes de importar.
"""

from dataclasses import dataclass, field
from datetime import date

from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.domain import STATUSES, fold, normalize_title
from app.models import Game
from app.services.catalog import CatalogCache, split_stores
from app.services.normalize import (
    clean_text,
    parse_date,
    parse_int,
    parse_number,
    parse_priority,
    parse_status,
)

IMPORT_MODES = ("novos", "atualizar", "substituir")


@dataclass
class GameRow:
    name: str
    platform: str | None = None
    genre: str | None = None
    status: str | None = None
    priority: str | None = None
    hltb_hours: float | None = None
    stores: list[str] = field(default_factory=list)
    date_value: date | None = None
    date_label: str | None = None
    played_hours: float | None = None
    user_score: int | None = None
    review: str | None = None
    story: str | None = None
    times_completed: int | None = None
    metacritic: int | None = None
    line: str = ""


class ImportReport(BaseModel):
    created: int = 0
    updated: int = 0
    skipped: int = 0
    warnings: list[str] = []
    new_genres: list[str] = []
    # Na simulação (dry_run): como cada linha seria tratada, para a prévia da UI.
    rows: list[dict] = []


def row_from_short(raw: dict, index: int) -> GameRow:
    """Linha no formato do JSON exportado do protótipo."""
    d_value, d_label = parse_date(raw.get("d"))
    played = parse_number(raw.get("t"))
    return GameRow(
        name=str(raw.get("n") or "").strip(),
        platform=clean_text(raw.get("p")),
        genre=clean_text(raw.get("g")),
        status=parse_status(raw.get("st")),
        priority=parse_priority(raw.get("pr")),
        hltb_hours=parse_number(raw.get("hl")),
        stores=split_stores(raw.get("o")),
        date_value=d_value,
        date_label=d_label,
        # Na planilha, 0 horas acompanha "Antes de 2022": significa "não sei".
        played_hours=played if played else None,
        user_score=parse_int(raw.get("u")),
        review=clean_text(raw.get("c")),
        story=clean_text(raw.get("h")),
        times_completed=parse_int(raw.get("z")),
        metacritic=parse_int(raw.get("mc")),
        line=f"item {index + 1}",
    )


def import_key(name_norm: str, platform: str, status: str) -> str:
    return f"{name_norm}|{fold(platform)}|{status}"


def _apply(game: Game, row: GameRow, cat: CatalogCache, report: ImportReport, *, creating: bool) -> None:
    """Copia para o jogo os campos presentes na linha. Na atualização, valores vazios não apagam nada."""

    def put(attr: str, value: object) -> None:
        if creating or value is not None:
            setattr(game, attr, value)

    if row.genre:
        genre, created = cat.genre(row.genre)
        if created:
            report.new_genres.append(row.genre)
            report.warnings.append(f"{row.line}: gênero novo criado: {row.genre!r}")
        game.genre = genre
    put("priority", row.priority)
    put("hltb_main_hours", row.hltb_hours)
    put("played_hours", row.played_hours)
    if row.user_score is not None and not 1 <= row.user_score <= 10:
        report.warnings.append(f"{row.line}: nota {row.user_score} fora de 1–10, ignorada")
        row.user_score = None
    put("user_score", row.user_score)
    put("review_text", row.review)
    put("story_summary", row.story)
    put("times_completed", row.times_completed)
    if row.metacritic is not None:
        game.metacritic_score = row.metacritic
        game.metacritic_source = "manual"
    status = row.status or game.status
    if row.date_value:
        if status == "hype":
            game.release_date = row.date_value
        else:
            game.finished_at = row.date_value
            game.finished_label = None
    elif row.date_label:
        game.finished_label = row.date_label
    if row.stores:
        game.stores = cat.stores_from(row.stores)


def _preview_row(row: GameRow, platform: str, status: str, action: str) -> dict:
    return {
        "action": action,
        "name": row.name,
        "platform": platform,
        "status": status,
        "priority": row.priority,
        "genre": row.genre,
        "hltb_hours": row.hltb_hours,
        "played_hours": row.played_hours,
        "user_score": row.user_score,
        "date": row.date_value.isoformat() if row.date_value else row.date_label,
        "stores": row.stores,
    }


def upsert_rows(db: Session, rows: list[GameRow], mode: str = "novos", *, dry_run: bool = False) -> ImportReport:
    if mode not in IMPORT_MODES:
        raise ValueError(f"modo inválido: {mode}")
    report = ImportReport()
    if mode == "substituir":
        if not dry_run:
            from app.services.backup import make_backup

            make_backup(reason="antes-de-substituir")
        db.execute(delete(Game))
        db.flush()

    cat = CatalogCache(db)
    existing = list(db.scalars(select(Game)))
    by_key: dict[str, Game] = {}
    by_name_platform: dict[tuple[str, int], list[Game]] = {}
    for g in existing:
        by_key[import_key(g.name_norm, g.platform.name, g.status)] = g
        by_name_platform.setdefault((g.name_norm, g.platform_id), []).append(g)

    next_order = (max((g.import_order or 0 for g in existing), default=0) or 0) + 1
    for row in rows:
        if not row.name:
            report.skipped += 1
            report.warnings.append(f"{row.line}: sem nome, ignorada")
            continue
        status = row.status or "backlog"
        if status not in STATUSES:
            status = "backlog"
        platform = cat.platform(row.platform)
        name_norm = normalize_title(row.name)
        key = import_key(name_norm, platform.name, status)

        target = by_key.get(key)
        if target is None and mode == "atualizar":
            same = by_name_platform.get((name_norm, platform.id), [])
            if len(same) == 1:
                target = same[0]
            elif len(same) > 1:
                report.skipped += 1
                report.warnings.append(
                    f"{row.line}: {row.name!r} ({platform.name}) existe {len(same)} vezes com outros status; pulei"
                )
                continue

        if target is not None:
            if mode == "novos":
                report.skipped += 1
                if dry_run:
                    report.rows.append(_preview_row(row, platform.name, status, "ignorar"))
                continue
            target.status = status
            _apply(target, row, cat, report, creating=False)
            report.updated += 1
            if dry_run:
                report.rows.append(_preview_row(row, platform.name, status, "atualizar"))
            continue

        game = Game(
            name=row.name,
            name_norm=name_norm,
            platform=platform,
            status=status,
            origin="planilha",
            import_key=key,
            import_order=next_order,
            tags=[],
            locked_fields=[],
        )
        next_order += 1
        _apply(game, row, cat, report, creating=True)
        db.add(game)
        report.created += 1
        if dry_run:
            report.rows.append(_preview_row(row, platform.name, status, "criar"))

    if dry_run:
        db.rollback()
    else:
        db.commit()
    return report


def import_short_json(db: Session, items: list[dict], mode: str = "novos") -> ImportReport:
    return upsert_rows(db, [row_from_short(it, i) for i, it in enumerate(items)], mode)
