import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app import db as dbmod
from app.config import get_settings
from app.migrate import migrate


@pytest.fixture
def empty_db(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    get_settings().ensure_dirs()
    dbmod.configure(get_settings().database_url)
    yield
    dbmod.get_engine().dispose()
    get_settings.cache_clear()


def _count(conn, table: str) -> int:
    return conn.execute(text(f"SELECT count(*) FROM {table}")).scalar_one()


def test_upgrade_from_0001_keeps_children(empty_db):
    migrate("0001")
    with dbmod.get_engine().begin() as conn:
        conn.execute(text("INSERT INTO platforms (id, name, sort_order) VALUES (1, 'PC', 0)"))
        conn.execute(text("INSERT INTO stores (id, name) VALUES (1, 'Steam')"))
        conn.execute(text("INSERT INTO devices (id, name, kind, sort_order) VALUES (1, 'Deck', 'Portátil', 0)"))
        conn.execute(text("INSERT INTO device_platforms (device_id, platform_id) VALUES (1, 1)"))
        conn.execute(
            text(
                "INSERT INTO games (id, name, name_norm, platform_id, status, tags, origin, locked_fields)"
                " VALUES (1, 'Hades', 'hades', 1, 'done', '[]', 'manual', '[]')"
            )
        )
        conn.execute(text("INSERT INTO comments (game_id, body) VALUES (1, 'bom demais')"))
        conn.execute(
            text(
                "INSERT INTO external_links (game_id, provider, external_id, status, candidates)"
                " VALUES (1, 'igdb', '113112', 'confirmed', '[]')"
            )
        )
        conn.execute(text("INSERT INTO game_stores (game_id, store_id) VALUES (1, 1)"))
        conn.execute(text("INSERT INTO media (game_id, kind, url, provider, position) VALUES (1, 'screenshot', 'u', 'igdb', 0)"))
        conn.execute(text("INSERT INTO store_reviews (game_id, source, provider) VALUES (1, 'Metacritic', 'metacritic')"))
        conn.execute(
            text(
                "INSERT INTO jobs (kind, status, priority, params, total, processed, succeeded, failed, log)"
                " VALUES ('enrich', 'done', 5, '{}', 0, 0, 0, 0, '[]')"
            )
        )

    migrate()

    with dbmod.get_engine().begin() as conn:
        for table in ("games", "comments", "external_links", "game_stores", "media", "store_reviews", "device_platforms"):
            assert _count(conn, table) == 1, table
        assert conn.execute(text("SELECT user_id FROM games")).scalar_one() == 1
        assert conn.execute(text("SELECT user_id FROM devices")).scalar_one() == 1
        assert conn.execute(text("SELECT user_id FROM jobs")).scalar_one() == 1
        assert conn.execute(text("SELECT username, password_hash FROM users")).one() == ("principal", None)
        conn.execute(text("UPDATE games SET status = 'owned'"))
        assert conn.execute(text("PRAGMA foreign_keys")).scalar_one() == 1

    # O dono é obrigatório (sem default que jogaria tudo no usuário 1) e o CHECK de status continua valendo.
    with pytest.raises(IntegrityError), dbmod.get_engine().begin() as conn:
        conn.execute(
            text(
                "INSERT INTO games (name, name_norm, platform_id, status, tags, origin, locked_fields)"
                " VALUES ('X', 'x', 1, 'backlog', '[]', 'manual', '[]')"
            )
        )
    with pytest.raises(IntegrityError), dbmod.get_engine().begin() as conn:
        conn.execute(text("UPDATE games SET status = 'whatever'"))
