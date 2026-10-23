"""Conversão tolerante de valores vindos da planilha (JSON, CSV ou XLSX)."""

import re
from datetime import date, datetime, timedelta

from app.domain import PRIORITIES, STATUS_LABELS, STATUS_SINGULAR, STATUSES, fold

_STATUS_ALIASES = {
    **{fold(v): k for k, v in STATUS_LABELS.items()},
    **{fold(v): k for k, v in STATUS_SINGULAR.items()},
    **{k: k for k in STATUSES},
    "lista": "backlog",
    "espera": "backlog",
    "fila": "backlog",
    "backlog": "backlog",
    "jogando": "playing",
    "zerado": "done",
    "zerados": "done",
    "finalizado": "done",
    "concluido": "done",
    "concluidos": "done",
    "abandonado": "dropped",
    "abandonados": "dropped",
    "dropado": "dropped",
    "desejo": "hype",
    "wishlist": "hype",
}


def parse_status(value: object) -> str | None:
    if value is None:
        return None
    key = fold(str(value))
    if not key:
        return None
    if key in _STATUS_ALIASES:
        return _STATUS_ALIASES[key]
    for alias, status in _STATUS_ALIASES.items():
        if alias in key:
            return status
    return None


def parse_priority(value: object) -> str | None:
    if value is None:
        return None
    key = fold(str(value))
    for p in PRIORITIES:
        if key == fold(p):
            return p
    return {"media": "Media", "alta": "Alta", "baixa": "Baixa", "high": "Alta", "medium": "Media", "low": "Baixa"}.get(
        key
    )


_HM = re.compile(r"^\s*(\d+)\s*[h:]\s*(\d{1,2})?\s*(?:m(?:in)?)?\s*$", re.I)


def parse_number(value: object) -> float | None:
    """Aceita 12, 12.5, '12,5', '12h30', '12:30', '12 h'."""
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, timedelta):
        return round(value.total_seconds() / 3600, 2)
    text = str(value).strip()
    if not text or text in {"-", "—", "?"}:
        return None
    m = _HM.match(text)
    if m and (m.group(2) is not None or "h" in text.lower()):
        return round(int(m.group(1)) + int(m.group(2) or 0) / 60, 2)
    text = text.lower().replace("horas", "").replace("hrs", "").replace("h", "").strip()
    if "," in text and "." in text:
        text = text.replace(".", "").replace(",", ".")
    else:
        text = text.replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return None


_EXCEL_EPOCH = date(1899, 12, 30)


def parse_date(value: object) -> tuple[date | None, str | None]:
    """Retorna (data, rótulo). Texto que não é data vira rótulo ("Antes de 2022")."""
    if value is None or value == "":
        return None, None
    if isinstance(value, datetime):
        return value.date(), None
    if isinstance(value, date):
        return value, None
    if isinstance(value, (int, float)) and 20000 < value < 80000:  # data serial do Excel
        return _EXCEL_EPOCH + timedelta(days=int(value)), None
    text = str(value).strip()
    if not text:
        return None, None
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", text)
    if m:
        try:
            return date(int(m[1]), int(m[2]), int(m[3])), None
        except ValueError:
            return None, text
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{2,4})$", text)
    if m:
        year = int(m[3]) + (2000 if len(m[3]) == 2 else 0)
        try:
            return date(year, int(m[2]), int(m[1])), None
        except ValueError:
            return None, text
    return None, text[:80]


def parse_int(value: object) -> int | None:
    n = parse_number(value)
    return None if n is None else int(round(n))


def clean_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None
