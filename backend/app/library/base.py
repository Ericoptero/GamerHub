from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Protocol

from pydantic import BaseModel

from app.integrations.base import ProviderError


class StoreGame(BaseModel):
    external_id: str
    # None quando o cliente pulou a busca do título porque o item já é conhecido (Epic).
    name: str | None = None
    playtime_minutes: int | None = None
    last_played_at: datetime | None = None
    cover_url: str | None = None
    url: str | None = None


class StoreProfile(BaseModel):
    external_user_id: str
    display_name: str | None = None
    avatar_url: str | None = None
    profile_url: str | None = None
    credentials: dict = {}


class AuthExpired(ProviderError):
    """A loja recusou o token salvo: o usuário precisa reconectar a conta."""


SaveCredentials = Callable[[dict], Awaitable[None]]


class StoreClient(Protocol):
    store: str

    @property
    def enabled(self) -> bool: ...

    async def connect(self, ref: str) -> StoreProfile:
        """Steam: URL/ID do perfil. Epic/GOG: código (ou URL/JSON) colado após o login."""
        ...

    async def fetch_library(
        self, external_user_id: str, credentials: dict, save_credentials: SaveCredentials, known: set[str]
    ) -> list[StoreGame]:
        """Jogos da conta. Tokens renovados vão para `save_credentials` antes de qualquer outra chamada.

        `known` são os ids já salvos: o cliente pode pular buscas caras (título, capa) para eles.
        """
        ...

    async def aclose(self) -> None: ...
