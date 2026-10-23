"""Exportação (JSON completo e CSV no formato da planilha) e restauração do JSON completo."""

import csv
import io
from datetime import date, datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.domain import PRIORITY_LABELS, STATUS_SINGULAR, normalize_title
from app.models import Comment, Device, ExternalLink, Game, Genre, Media, Platform, Store, StoreReview
from app.services.catalog import CatalogCache

EXPORT_VERSION = 1

_GAME_FIELDS = (
    "name", "status", "priority", "hltb_main_hours", "hltb_extra_hours", "hltb_complete_hours", "played_hours",
    "user_score", "review_text", "story_summary", "times_completed", "finished_at", "finished_label",
    "release_date", "description", "storyline", "cover_url", "background_url", "metacritic_score",
    "metacritic_user_score", "metacritic_url", "metacritic_source", "tags", "developer", "publisher", "origin",
    "locked_fields", "import_key", "import_order", "created_at", "last_enriched_at",
)  # fmt: skip
_MEDIA_FIELDS = ("kind", "url", "thumb_url", "provider", "provider_ref", "title", "position")
_REVIEW_FIELDS = ("source", "outlet", "author", "score_display", "score_norm", "text", "url", "review_date", "provider")
_LINK_FIELDS = ("provider", "external_id", "external_url", "matched_name", "match_score", "status", "candidates")


def _jsonable(v: object) -> object:
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    return v


def _pick(obj: object, fields: tuple[str, ...]) -> dict:
    return {f: _jsonable(getattr(obj, f)) for f in fields}


def export_json(db: Session) -> dict:
    games = db.scalars(select(Game).order_by(Game.import_order, Game.id)).all()
    return {
        "version": EXPORT_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "platforms": [
            {
                "name": p.name,
                "sort_order": p.sort_order,
                "igdb_platform_id": p.igdb_platform_id,
                "rawg_platform_id": p.rawg_platform_id,
                "metacritic_name": p.metacritic_name,
                "hltb_name": p.hltb_name,
            }
            for p in db.scalars(select(Platform).order_by(Platform.sort_order, Platform.name))
        ],
        "genres": [g.name for g in db.scalars(select(Genre).order_by(Genre.sort_order, Genre.name))],
        "stores": [s.name for s in db.scalars(select(Store).order_by(Store.name))],
        "devices": [
            {"name": d.name, "kind": d.kind, "platforms": [p.name for p in d.platforms]}
            for d in db.scalars(select(Device).order_by(Device.sort_order, Device.id))
        ],
        "games": [
            {
                **_pick(g, _GAME_FIELDS),
                "platform": g.platform.name,
                "genre": g.genre.name if g.genre else None,
                "stores": [s.name for s in g.stores],
                "comments": [{"body": c.body, "created_at": _jsonable(c.created_at)} for c in g.comments],
                "media": [_pick(m, _MEDIA_FIELDS) for m in g.media],
                "store_reviews": [_pick(r, _REVIEW_FIELDS) for r in g.store_reviews],
                "links": [_pick(lk, _LINK_FIELDS) for lk in g.links],
            }
            for g in games
        ],
    }


def _parse_dt(v: str | None) -> datetime | None:
    return datetime.fromisoformat(v) if v else None


def _parse_d(v: str | None) -> date | None:
    return date.fromisoformat(v) if v else None


def restore_json(db: Session, data: dict) -> dict:
    """Substitui todo o conteúdo pelo de um export.json (faz backup antes)."""
    from app.services.backup import make_backup

    if data.get("version") != EXPORT_VERSION:
        raise ValueError(f"versão de export não suportada: {data.get('version')!r}")
    make_backup(reason="antes-de-restaurar")
    for model in (Game, Device, Store, Genre, Platform):
        db.execute(delete(model))
    db.flush()

    for p in data.get("platforms", []):
        db.add(Platform(**p))
    for i, name in enumerate(data.get("genres", [])):
        db.add(Genre(name=name, sort_order=i))
    db.flush()
    cat = CatalogCache(db)
    for name in data.get("stores", []):
        cat.store(name)
    for i, d in enumerate(data.get("devices", [])):
        db.add(Device(name=d["name"], kind=d["kind"], sort_order=i, platforms=[cat.platform(p) for p in d["platforms"]]))

    for raw in data.get("games", []):
        fields = {f: raw.get(f) for f in _GAME_FIELDS}
        for f in ("finished_at", "release_date"):
            fields[f] = _parse_d(fields[f])
        for f in ("created_at", "last_enriched_at"):
            fields[f] = _parse_dt(fields[f])
        if fields["created_at"] is None:
            del fields["created_at"]
        fields["tags"] = fields["tags"] or []
        fields["locked_fields"] = fields["locked_fields"] or []
        game = Game(**fields, name_norm=normalize_title(raw["name"]), platform=cat.platform(raw["platform"]))
        game.genre = cat.genre(raw.get("genre"))[0]
        game.stores = cat.stores_from(raw.get("stores", []))
        game.comments = [Comment(body=c["body"], created_at=_parse_dt(c["created_at"])) for c in raw.get("comments", [])]
        game.media = [Media(**m) for m in raw.get("media", [])]
        game.store_reviews = [
            StoreReview(**{**r, "review_date": _parse_d(r.get("review_date"))}) for r in raw.get("store_reviews", [])
        ]
        game.links = [ExternalLink(**lk) for lk in raw.get("links", [])]
        db.add(game)
    db.commit()
    return {"games": len(data.get("games", [])), "devices": len(data.get("devices", []))}


CSV_HEADERS = [
    "Nome", "Plataforma", "Gênero", "Lista", "Prioridade", "HLTB (h)", "Lojas", "Data", "Horas jogadas",
    "Nota", "Review", "História", "Zerado (vezes)", "Metacritic",
]  # fmt: skip


def _num(v: float | int | None) -> str:
    if v is None:
        return ""
    return f"{v:g}".replace(".", ",")


def export_csv(db: Session) -> str:
    buf = io.StringIO()
    buf.write("﻿")  # BOM para o Excel reconhecer UTF-8
    w = csv.writer(buf, delimiter=";", lineterminator="\r\n")
    w.writerow(CSV_HEADERS)
    for g in db.scalars(select(Game).order_by(Game.import_order, Game.id)):
        d = g.release_date if g.status == "hype" else g.finished_at
        w.writerow(
            [
                g.name,
                g.platform.name,
                g.genre.name if g.genre else "",
                STATUS_SINGULAR[g.status],
                PRIORITY_LABELS.get(g.priority or "", ""),
                _num(g.hltb_main_hours),
                ", ".join(s.name for s in g.stores),
                d.strftime("%d/%m/%Y") if d else (g.finished_label or ""),
                _num(g.played_hours),
                _num(g.user_score),
                g.review_text or "",
                g.story_summary or "",
                _num(g.times_completed),
                _num(g.metacritic_score),
            ]
        )
    return buf.getvalue()
