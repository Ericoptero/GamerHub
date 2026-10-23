"""Catálogos iniciais. Gêneros, aparelhos e tipos vêm do protótipo (docs/prototype/Main.dc.html)."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain import DEFAULT_USER_ID, fold
from app.models import Device, Genre, Platform

GENRES = [
    "Ação (beat'em up, hack'n slash, luta)",
    "Ação e aventura (Metroidvania, open world)",
    "Aventura (Visual Novel, point and click)",
    "Corrida",
    "Estratégia (Tatics, tower defense, RTS)",
    "Plataforma",
    "Puzzles e Quebra cabeça",
    "RPG",
    "RPG de ação",
    "Simulação (construção, esportes)",
    "Sobrevivência e Sandbox",
    "Terror",
    "Tiro (FPS, TPS)",
]

# nome, igdb_platform_id, rawg_platform_id, nome no Metacritic, nome no HLTB
PLATFORMS: list[tuple[str, int | None, int | None, str | None, str | None]] = [
    ("PC", 6, 4, "PC", "PC"),
    ("Switch", 130, 7, "Nintendo Switch", "Nintendo Switch"),
    ("3DS", 37, 8, "3DS", "Nintendo 3DS"),
    ("NDS", 20, 9, "DS", "Nintendo DS"),
    ("GBA", 24, 24, "Game Boy Advance", "Game Boy Advance"),
    ("GB", 33, 26, None, "Game Boy"),
    ("GBC", 22, 43, None, "Game Boy Color"),
    ("NES", 18, 49, None, "NES"),
    ("SNES", 19, 79, None, "Super Nintendo"),
    ("N64", 4, 83, "Nintendo 64", "Nintendo 64"),
    ("Gamecube", 21, 105, "GameCube", "Nintendo GameCube"),
    ("PS1", 7, 27, "PlayStation", "PlayStation"),
    ("PS3", 9, 16, "PlayStation 3", "PlayStation 3"),
    ("PS4", 48, 18, "PlayStation 4", "PlayStation 4"),
    ("PSP", 38, 17, "PSP", "PlayStation Portable"),
    ("PS Vita", 46, 19, "PlayStation Vita", "PlayStation Vita"),
    ("Master System", 64, 74, None, "Sega Master System"),
    ("Mega Drive", 29, 167, None, "Sega Mega Drive/Genesis"),
    ("Android", 34, 21, None, "Mobile"),
    ("Outro", None, None, None, None),
]

DEVICES: list[tuple[str, str, list[str]]] = [
    ("PC", "PC", ["PC"]),
    ("Steam Deck", "Portátil", ["PC"]),
    ("Nintendo Switch", "Console", ["Switch"]),
    ("Nintendo 3DS", "Portátil", ["3DS", "NDS"]),
    ("PS Vita", "Portátil", ["PS Vita", "PSP"]),
    ("Miyoo Mini Plus", "Emulador / retro", ["GB", "GBC", "GBA", "NES", "SNES", "Master System", "Mega Drive", "PS1"]),
    ("Retroid Pocket 5", "Emulador / retro", ["GBA", "NDS", "PS1", "PSP", "SNES", "N64", "Gamecube", "Mega Drive"]),
]

# Gênero do IGDB/RAWG -> categoria do usuário (sugestão ao adicionar pela integração).
EXTERNAL_GENRE_HINTS: list[tuple[str, str]] = [
    ("shooter", "Tiro (FPS, TPS)"),
    ("racing", "Corrida"),
    ("horror", "Terror"),
    ("survival", "Sobrevivência e Sandbox"),
    ("sandbox", "Sobrevivência e Sandbox"),
    ("platform", "Plataforma"),
    ("puzzle", "Puzzles e Quebra cabeça"),
    ("strategy", "Estratégia (Tatics, tower defense, RTS)"),
    ("tactical", "Estratégia (Tatics, tower defense, RTS)"),
    ("real time strategy", "Estratégia (Tatics, tower defense, RTS)"),
    ("turn-based strategy", "Estratégia (Tatics, tower defense, RTS)"),
    ("simulator", "Simulação (construção, esportes)"),
    ("simulation", "Simulação (construção, esportes)"),
    ("sport", "Simulação (construção, esportes)"),
    ("visual novel", "Aventura (Visual Novel, point and click)"),
    ("point-and-click", "Aventura (Visual Novel, point and click)"),
    ("fighting", "Ação (beat'em up, hack'n slash, luta)"),
    ("hack and slash", "Ação (beat'em up, hack'n slash, luta)"),
    ("beat 'em up", "Ação (beat'em up, hack'n slash, luta)"),
    ("role-playing", "RPG"),
    ("rpg", "RPG"),
    ("adventure", "Ação e aventura (Metroidvania, open world)"),
    ("action", "Ação e aventura (Metroidvania, open world)"),
]


def suggest_genre(external_genres: list[str]) -> str | None:
    lowered = [g.lower() for g in external_genres]
    if any("role-playing" in g or g == "rpg" for g in lowered) and any("action" in g or "hack" in g for g in lowered):
        return "RPG de ação"
    for needle, genre in EXTERNAL_GENRE_HINTS:
        if any(needle in g for g in lowered):
            return genre
    return None


def seed_devices(db: Session, user_id: int) -> None:
    """Aparelhos padrão de um usuário. Plataformas renomeadas ou removidas ficam de fora."""
    platforms = {fold(p.name): p for p in db.scalars(select(Platform))}
    for i, (name, kind, plats) in enumerate(DEVICES):
        found = [platforms[fold(p)] for p in plats if fold(p) in platforms]
        db.add(Device(user_id=user_id, name=name, kind=kind, sort_order=i, platforms=found))


def seed_catalogs(db: Session) -> bool:
    """Popula gêneros, plataformas e os aparelhos do usuário principal se o banco estiver vazio. Idempotente."""
    if db.scalar(select(Platform.id).limit(1)) is not None:
        return False
    for i, name in enumerate(GENRES):
        db.add(Genre(name=name, sort_order=i))
    for i, (name, igdb, rawg, mc, hltb) in enumerate(PLATFORMS):
        db.add(
            Platform(
                name=name, sort_order=i, igdb_platform_id=igdb, rawg_platform_id=rawg, metacritic_name=mc, hltb_name=hltb
            )
        )
    db.flush()
    seed_devices(db, DEFAULT_USER_ID)
    db.commit()
    return True
