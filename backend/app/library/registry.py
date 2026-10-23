"""Instâncias únicas dos clientes das lojas (criadas sob demanda, fechadas no shutdown)."""

from app.config import get_settings
from app.library.base import StoreClient
from app.library.epic import LOGIN_URL as EPIC_LOGIN_URL
from app.library.epic import EpicClient
from app.library.gog import LOGIN_URL as GOG_LOGIN_URL
from app.library.gog import GogClient
from app.library.steam import SteamClient

LOGIN_URLS = {"epic": EPIC_LOGIN_URL, "gog": GOG_LOGIN_URL}

_clients: dict[str, StoreClient] = {}


def get_store_client(store: str) -> StoreClient:
    if store not in _clients:
        factories = {
            "steam": lambda: SteamClient(get_settings().steam_api_key),
            "epic": EpicClient,
            "gog": GogClient,
        }
        if store not in factories:
            raise KeyError(store)
        _clients[store] = factories[store]()
    return _clients[store]


def set_store_client(store: str, client: StoreClient) -> None:
    """Usado pelos testes para injetar clientes falsos."""
    _clients[store] = client


def stores_status() -> dict[str, bool]:
    return {"steam": bool(get_settings().steam_api_key), "epic": True, "gog": True}


async def close_store_clients() -> None:
    for client in list(_clients.values()):
        await client.aclose()
    _clients.clear()
