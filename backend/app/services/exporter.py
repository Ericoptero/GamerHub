"""Exportação (JSON completo e CSV no formato da planilha) e restauração do JSON completo."""

import csv
import io
from datetime import date, datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.domain import PRIORITY_LABELS, STATUS_SINGULAR, fold, normalize_title
from app.models import (
    Comment,
    Device,
    ExternalLink,
    Game,
    Genre,
    LibraryAccount,
    LibraryItem,
    Media,
    Platform,
    Store,
    StoreReview,
)
from app.services.catalog import CatalogCache

EXPORT_VERSION = 1

_GAME_FIELDS = (
    "name", "status", "priority", "hltb_main_hours", "hltb_extra_hours", "hltb_complete_hours", "played_hours",
    "played_hours_source", "user_score", "review_text", "story_summary", "times_completed", "finished_at", "finished_label",
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


def _ownerships(db: Session, user_id: int) -> dict[int, list[dict]]:
    """Em quais contas de loja está cada jogo (sem credenciais), para religar depois de restaurar."""
    rows = db.execute(
        select(LibraryItem.game_id, LibraryAccount.store, LibraryAccount.external_user_id, LibraryItem.external_id)
        .join(LibraryAccount, LibraryAccount.id == LibraryItem.account_id)
        .where(LibraryAccount.user_id == user_id, LibraryItem.game_id.is_not(None))
    )
    out: dict[int, list[dict]] = {}
    for gid, store, ext_user, ext_id in rows:
        out.setdefault(gid, []).append({"store": store, "external_user_id": ext_user, "external_id": ext_id})
    return out


def export_json(db: Session, user_id: int) -> dict:
    """Biblioteca do usuário + catálogos compartilhados (plataformas, gêneros, lojas).

    As contas de loja e os tokens delas não entram; cada jogo leva só em quais contas está.
    """
    games = db.scalars(select(Game).where(Game.user_id == user_id).order_by(Game.import_order, Game.id)).all()
    owned = _ownerships(db, user_id)
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
            for d in db.scalars(select(Device).where(Device.user_id == user_id).order_by(Device.sort_order, Device.id))
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
                "ownerships": owned.get(g.id, []),
            }
            for g in games
        ],
    }


def _parse_dt(v: str | None) -> datetime | None:
    return datetime.fromisoformat(v) if v else None


def _parse_d(v: str | None) -> date | None:
    return date.fromisoformat(v) if v else None


def restore_json(db: Session, user_id: int, data: dict) -> dict:
    """Substitui a biblioteca do usuário pela de um export.json (faz backup antes).

    Plataformas, gêneros e lojas são de todos os usuários: só entram os que faltam.
    """
    from app.services.backup import make_backup

    if data.get("version") != EXPORT_VERSION:
        raise ValueError(f"versão de export não suportada: {data.get('version')!r}")
    make_backup(reason="antes-de-restaurar")
    for model in (Game, Device):
        db.execute(delete(model).where(model.user_id == user_id))
    db.flush()

    cat = CatalogCache(db)
    for p in data.get("platforms", []):
        if fold(p["name"]) not in cat.platforms:
            platform = Platform(**p)
            db.add(platform)
            db.flush()
            cat.platforms[fold(platform.name)] = platform
    for name in data.get("genres", []):
        cat.genre(name)
    for name in data.get("stores", []):
        cat.store(name)
    for i, d in enumerate(data.get("devices", [])):
        db.add(
            Device(
                user_id=user_id,
                name=d["name"],
                kind=d["kind"],
                sort_order=i,
                platforms=[cat.platform(p) for p in d["platforms"]],
            )
        )

    restored: list[tuple[Game, list[dict]]] = []
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
        game = Game(
            **fields, user_id=user_id, name_norm=normalize_title(raw["name"]), platform=cat.platform(raw["platform"])
        )
        game.genre = cat.genre(raw.get("genre"))[0]
        game.stores = cat.stores_from(raw.get("stores", []))
        game.comments = [Comment(body=c["body"], created_at=_parse_dt(c["created_at"])) for c in raw.get("comments", [])]
        game.media = [Media(**m) for m in raw.get("media", [])]
        game.store_reviews = [
            StoreReview(**{**r, "review_date": _parse_d(r.get("review_date"))}) for r in raw.get("store_reviews", [])
        ]
        game.links = [ExternalLink(**lk) for lk in raw.get("links", [])]
        db.add(game)
        restored.append((game, raw.get("ownerships") or []))
    db.flush()
    _relink(db, user_id, restored)
    db.commit()
    return {"games": len(data.get("games", [])), "devices": len(data.get("devices", []))}


def _relink(db: Session, user_id: int, restored: list[tuple[Game, list[dict]]]) -> None:
    """Liga de novo os itens das contas de loja aos jogos restaurados (preserva mesclagens).
    O que não casar fica sem jogo e é religado pelo nome na próxima sincronização."""
    accounts = {
        (a.store, a.external_user_id): a.id
        for a in db.scalars(select(LibraryAccount).where(LibraryAccount.user_id == user_id))
    }
    for game, owned in restored:
        for o in owned:
            account_id = accounts.get((o.get("store"), o.get("external_user_id")))
            if account_id is None:
                continue
            item = db.scalar(
                select(LibraryItem).where(
                    LibraryItem.account_id == account_id, LibraryItem.external_id == o.get("external_id")
                )
            )
            if item is not None:
                item.game_id, item.ignored = game.id, False


CSV_HEADERS = [
    "Nome", "Plataforma", "Gênero", "Lista", "Prioridade", "HLTB (h)", "Lojas", "Data", "Horas jogadas",
    "Nota", "Review", "História", "Zerado (vezes)", "Metacritic",
]  # fmt: skip


def _num(v: float | int | None) -> str:
    if v is None:
        return ""
    return f"{v:g}".replace(".", ",")


def export_csv(db: Session, user_id: int) -> str:
    buf = io.StringIO()
    buf.write("﻿")  # BOM para o Excel reconhecer UTF-8
    w = csv.writer(buf, delimiter=";", lineterminator="\r\n")
    w.writerow(CSV_HEADERS)
    for g in db.scalars(select(Game).where(Game.user_id == user_id).order_by(Game.import_order, Game.id)):
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
