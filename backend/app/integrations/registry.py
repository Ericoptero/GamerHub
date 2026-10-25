"""Instâncias únicas dos providers (criadas sob demanda, fechadas no shutdown)."""

from app.integrations.base import Provider
from app.integrations.hltb import HLTBProvider
from app.integrations.igdb import IGDBProvider
from app.integrations.metacritic import MetacriticProvider
from app.integrations.rawg import RAWGProvider
from app.schemas import ProvidersStatus
from app.services import api_keys

_providers: dict[str, Provider] = {}


def get_provider(name: str) -> Provider:
    if name not in _providers:
        s = api_keys.current()
        factories = {
            "igdb": lambda: IGDBProvider(s.igdb_client_id, s.igdb_client_secret),
            "rawg": lambda: RAWGProvider(s.rawg_api_key),
            "hltb": HLTBProvider,
            "metacritic": MetacriticProvider,
        }
        if name not in factories:
            raise KeyError(name)
        _providers[name] = factories[name]()
    return _providers[name]


def set_provider(name: str, provider: Provider) -> None:
    """Usado pelos testes para injetar providers falsos."""
    _providers[name] = provider


def apply_keys(keys: api_keys.ApiKeys) -> None:
    """Chaves novas valem já, sem recriar o cliente (o limite de taxa e as requisições em curso ficam)."""
    igdb = _providers.get("igdb")
    if isinstance(igdb, IGDBProvider):
        igdb.set_credentials(keys.igdb_client_id, keys.igdb_client_secret)
    rawg = _providers.get("rawg")
    if isinstance(rawg, RAWGProvider):
        rawg.api_key = keys.rawg_api_key


def providers_status() -> ProvidersStatus:
    s = api_keys.current()
    return ProvidersStatus(
        igdb=bool(s.igdb_client_id and s.igdb_client_secret),
        rawg=bool(s.rawg_api_key),
        hltb=True,
        metacritic=True,
    )


async def close_all() -> None:
    for p in list(_providers.values()):
        close = getattr(p, "aclose", None)
        if close:
            await close()
    _providers.clear()
