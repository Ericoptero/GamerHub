from alembic import command
from alembic.config import Config
from sqlalchemy import text

from app.config import BACKEND_DIR
from app.db import get_engine


def migrate(revision: str = "head") -> None:
    """Aplica as migrações pendentes no banco configurado (usado no boot e nos testes).

    As migrações em lote do SQLite recriam a tabela (CREATE nova, copia, DROP antiga). Com
    foreign_keys=ON (ligado em toda conexão por app.db), o DROP dispararia os ON DELETE CASCADE
    e apagaria comentários, mídia, links… dos jogos. Por isso as FKs ficam desligadas durante
    o upgrade e a integridade é conferida no fim.
    """
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.attributes["configure_logger"] = False
    with get_engine().connect() as connection:
        # O PRAGMA não tem efeito dentro de uma transação: roda e fecha antes do begin().
        connection.execute(text("PRAGMA foreign_keys=OFF"))
        connection.commit()
        try:
            with connection.begin():
                cfg.attributes["connection"] = connection
                command.upgrade(cfg, revision)
                broken = connection.execute(text("PRAGMA foreign_key_check")).fetchall()
                if broken:
                    raise RuntimeError(f"migração deixou referências quebradas: {broken[:5]}")
        finally:
            connection.execute(text("PRAGMA foreign_keys=ON"))
            connection.commit()
