from collections.abc import Iterator

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    pass


_engine: Engine | None = None
_session_factory: sessionmaker[Session] | None = None


def _set_pragmas(dbapi_conn, _record) -> None:
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA synchronous=NORMAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.execute("PRAGMA busy_timeout=5000")
    cur.close()


def configure(url: str | None = None) -> Engine:
    """(Re)cria o engine. Os testes chamam com um banco temporário."""
    global _engine, _session_factory
    if _engine is not None:
        _engine.dispose()
    _engine = create_engine(url or get_settings().database_url, connect_args={"check_same_thread": False})
    event.listen(_engine, "connect", _set_pragmas)
    _session_factory = sessionmaker(_engine, expire_on_commit=False)
    return _engine


def get_engine() -> Engine:
    if _engine is None:
        configure()
    assert _engine is not None
    return _engine


def new_session() -> Session:
    if _session_factory is None:
        configure()
    assert _session_factory is not None
    return _session_factory()


def get_db() -> Iterator[Session]:
    with new_session() as session:
        yield session
