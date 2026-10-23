import asyncio
import logging
import sqlite3
from datetime import datetime
from pathlib import Path

from app.config import get_settings

log = logging.getLogger(__name__)


def backup_to(dest: Path) -> Path:
    """Cópia consistente do banco (API de backup do SQLite, segura com WAL e escrita concorrente)."""
    settings = get_settings()
    dest.parent.mkdir(parents=True, exist_ok=True)
    src = sqlite3.connect(settings.db_path)
    try:
        out = sqlite3.connect(dest)
        try:
            src.backup(out)
        finally:
            out.close()
    finally:
        src.close()
    return dest


def make_backup(reason: str = "auto") -> Path | None:
    settings = get_settings()
    if not settings.db_path.exists():
        return None
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    path = backup_to(settings.backups_dir / f"gamerhub-{stamp}-{reason}.db")
    rotate_backups()
    return path


def rotate_backups() -> None:
    settings = get_settings()
    autos = sorted(settings.backups_dir.glob("gamerhub-*-diario.db"))
    for old in autos[: -settings.backup_keep]:
        old.unlink(missing_ok=True)


async def daily_backup_loop() -> None:
    """Um backup "diario" por dia; roda no lifespan do app."""
    settings = get_settings()
    while True:
        today = datetime.now().strftime("%Y%m%d")
        if not any(settings.backups_dir.glob(f"gamerhub-{today}-*-diario.db")):
            try:
                await asyncio.to_thread(make_backup, "diario")
            except Exception:  # noqa: BLE001
                log.exception("backup diário falhou")
        await asyncio.sleep(3600)
