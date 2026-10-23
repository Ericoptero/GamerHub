from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(BACKEND_DIR.parent / ".env", BACKEND_DIR / ".env"),
        extra="ignore",
    )

    data_dir: Path = BACKEND_DIR.parent / "data"
    static_dir: Path = BACKEND_DIR / "static"

    igdb_client_id: str = ""
    igdb_client_secret: str = ""
    rawg_api_key: str = ""
    metacritic_api_key: str = ""

    cache_screenshots: bool = True
    worker_enabled: bool = True
    backup_keep: int = 7

    @property
    def db_path(self) -> Path:
        return self.data_dir / "gamerhub.db"

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.db_path.as_posix()}"

    @property
    def media_dir(self) -> Path:
        return self.data_dir / "media"

    @property
    def backups_dir(self) -> Path:
        return self.data_dir / "backups"

    @property
    def imports_dir(self) -> Path:
        return self.data_dir / "imports"

    def ensure_dirs(self) -> None:
        for d in (self.data_dir, self.media_dir, self.backups_dir, self.imports_dir):
            d.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    return Settings()
