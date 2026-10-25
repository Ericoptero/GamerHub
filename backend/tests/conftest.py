import json
from pathlib import Path

import pytest

from app import db as dbmod
from app.config import get_settings
from app.migrate import migrate
from app.seed.seed_data import seed_catalogs
from app.services import api_keys

PLANILHA = Path(__file__).resolve().parent.parent / "app" / "seed" / "planilha.json"
FIXTURES = Path(__file__).resolve().parent / "fixtures"


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("WORKER_ENABLED", "false")
    for key in api_keys.KEY_NAMES:
        monkeypatch.setenv(key.upper(), "")
    api_keys.set_current(api_keys.ApiKeys())
    get_settings.cache_clear()
    get_settings().ensure_dirs()
    dbmod.configure(get_settings().database_url)
    migrate()
    yield tmp_path
    api_keys.set_current(api_keys.ApiKeys())
    dbmod.get_engine().dispose()
    get_settings.cache_clear()


@pytest.fixture
def db(data_dir):
    with dbmod.new_session() as session:
        seed_catalogs(session)
        yield session


@pytest.fixture(scope="session")
def planilha() -> list[dict]:
    return json.loads(PLANILHA.read_text(encoding="utf-8"))
