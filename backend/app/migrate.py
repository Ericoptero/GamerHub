from alembic import command
from alembic.config import Config

from app.config import BACKEND_DIR
from app.db import get_engine


def migrate() -> None:
    """Aplica as migrações pendentes no banco configurado (usado no boot e nos testes)."""
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.attributes["configure_logger"] = False
    with get_engine().begin() as connection:
        cfg.attributes["connection"] = connection
        command.upgrade(cfg, "head")
