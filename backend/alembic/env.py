from logging.config import fileConfig

from alembic import context

from app import models  # noqa: F401  (registra as tabelas)
from app.db import Base, get_engine

config = context.config
# Rodando via CLI configura logging; via app.migrate() o app já tem o seu.
if config.config_file_name is not None and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_online() -> None:
    connection = config.attributes.get("connection")
    if connection is not None:
        _run(connection)
        return
    with get_engine().connect() as connection:
        _run(connection)


def _run(connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


run_migrations_online()
