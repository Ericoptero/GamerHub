"""Vocabulário do domínio, compartilhado por modelos, API e importadores."""

import re
import unicodedata

# "owned": jogos que você tem (vindos das contas de loja) mas ainda não pôs na fila.
STATUSES = ("backlog", "playing", "done", "dropped", "hype", "owned")
STATUS_LABELS = {
    "backlog": "Lista de espera",
    "playing": "Jogando",
    "done": "Finalizados",
    "dropped": "Dropados",
    "hype": "Hype",
    "owned": "Biblioteca",
}
STATUS_SINGULAR = {
    "backlog": "Na fila",
    "playing": "Jogando",
    "done": "Finalizado",
    "dropped": "Dropado",
    "hype": "Hype",
    "owned": "Na biblioteca",
}

# Dono de tudo quando o login está desligado (e de tudo o que existia antes do multiusuário).
DEFAULT_USER_ID = 1

# A página pública fica em /<username>: nomes que já são caminhos do app (rotas do frontend, da API e
# arquivos servidos na raiz) não podem virar usuário.
RESERVED_USERNAMES = frozenset(
    {
        "api",
        "media",
        "assets",
        "docs",
        "redoc",
        "openapi.json",
        "entrar",
        "biblioteca",
        "jogos",
        "listas",
        "adicionar",
        "consoles",
        "integracoes",
        "usuarios",
        "configuracoes",
        "favicon.svg",
        "index.html",
        "robots.txt",
    }
)

PRIORITIES = ("Alta", "Media", "Baixa")
PRIORITY_LABELS = {"Alta": "Alta", "Media": "Média", "Baixa": "Baixa"}

# Posse: se você tem o jogo, à parte do status (um jogo na fila pode ainda não ter sido comprado).
ACCESS = ("owned", "unreleased", "wishlist", "gamepass")
ACCESS_LABELS = {
    "owned": "Tenho",
    "unreleased": "Aguardando lançamento",
    "wishlist": "Ainda não comprei",
    "gamepass": "Game Pass",
}

DEVICE_KINDS = ("Console", "Portátil", "PC", "Emulador / retro", "Celular", "Outro")

PROVIDERS = ("igdb", "rawg", "hltb", "metacritic")

# Lojas com contas sincronizadas e a etiqueta de loja (tabela stores) que cada uma põe no jogo.
LIBRARY_STORES = ("steam", "epic", "gog")
STORE_TAG = {"steam": "Steam", "epic": "Epic", "gog": "GOG"}
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


# A mesma tag com grafias diferentes entre IGDB e RAWG (a chave já ignora espaço, hífen e caixa).
_TAG_ALIASES = {
    "coop": "cooperative",
    "scifi": "sciencefiction",
    "rpg": "roleplayingrpg",
    "platformer": "platform",
    "simulation": "simulator",
    "sports": "sport",
    "massivelymultiplayer": "massivelymultiplayeronlinemmo",
    "mmo": "massivelymultiplayeronlinemmo",
    "sharedsplitscreen": "splitscreen",
}


def tag_key(tag: str) -> str:
    key = re.sub(r"[^0-9a-z]", "", strip_accents(tag).casefold())
    return _TAG_ALIASES.get(key, key)


def merge_tags(*lists: list[str] | None) -> list[str]:
    """Junta listas de tags sem repetir ("Single player" = "Singleplayer"); vale a primeira grafia."""
    seen: set[str] = set()
    out: list[str] = []
    for tags in lists:
        for tag in tags or []:
            tag = (tag or "").strip()
            key = tag_key(tag)
            if key and key not in seen:
                seen.add(key)
                out.append(tag)
    return out
