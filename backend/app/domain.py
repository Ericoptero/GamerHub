"""Vocabulário do domínio, compartilhado por modelos, API e importadores."""

import re
import unicodedata

STATUSES = ("backlog", "playing", "done", "dropped", "hype")
STATUS_LABELS = {
    "backlog": "Lista de espera",
    "playing": "Jogando",
    "done": "Finalizados",
    "dropped": "Dropados",
    "hype": "Hype",
}
STATUS_SINGULAR = {
    "backlog": "Na fila",
    "playing": "Jogando",
    "done": "Finalizado",
    "dropped": "Dropado",
    "hype": "Hype",
}

PRIORITIES = ("Alta", "Media", "Baixa")
PRIORITY_LABELS = {"Alta": "Alta", "Media": "Média", "Baixa": "Baixa"}

DEVICE_KINDS = ("Console", "Portátil", "PC", "Emulador / retro", "Celular", "Outro")

PROVIDERS = ("igdb", "rawg", "hltb", "metacritic")
LINK_STATUSES = ("matched", "confirmed", "ambiguous", "not_found", "error", "ignored")

# Campos que vêm das integrações e podem ser travados quando editados à mão.
META_FIELDS = (
    "hltb_main_hours",
    "hltb_extra_hours",
    "hltb_complete_hours",
    "metacritic_score",
    "metacritic_user_score",
    "metacritic_url",
    "description",
    "storyline",
    "cover_url",
    "background_url",
    "release_date",
    "developer",
    "publisher",
    "tags",
)


def strip_accents(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))


def fold(text: str) -> str:
    """Comparação tolerante: sem acento, minúsculo, espaços colapsados."""
    return re.sub(r"\s+", " ", strip_accents(text).casefold()).strip()


# "x" e "i" ficam de fora: "Mega Man X" não é "Mega Man 10".
_ROMAN = {"ii": "2", "iii": "3", "iv": "4", "v": "5", "vi": "6", "vii": "7", "viii": "8", "ix": "9"}


def normalize_title(text: str) -> str:
    """Forma canônica de um título para deduplicar e casar com as integrações."""
    t = strip_accents(text).casefold()
    t = re.sub(r"[™®©]", "", t).replace("&", " and ")
    t = re.sub(r"[^\w\s]|_", " ", t)
    words = [_ROMAN.get(w, w) for w in t.split()]
    if len(words) > 1 and words[0] == "the":
        words = words[1:]
    return " ".join(words)
