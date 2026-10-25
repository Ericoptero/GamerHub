"""Steam Web API (https://steamcommunity.com/dev): perfil pela URL e jogos da conta.

Precisa da chave da Steam Web API (cadastrada em Configurações). A lista de jogos só vem se o perfil deixar "Detalhes do jogo" públicos.
"""

import json
import re
from datetime import datetime, timezone
from urllib.parse import unquote

from app.integrations.base import ProviderError
from app.integrations.http import RateLimitedClient
from app.library.base import SaveCredentials, StoreGame, StoreProfile

API_URL = "https://api.steampowered.com"
ASSETS_URL = "https://shared.akamai.steamstatic.com/store_item_assets/"
ASSETS_BATCH = 50

_ID64 = re.compile(r"^7656\d{13}$")
_PROFILE = re.compile(r"(?:https?://)?(?:www\.)?steamcommunity\.com/(id|profiles)/([^/?#\s]+)", re.IGNORECASE)
_VANITY = re.compile(r"^[\w\-]{2,64}$")


def parse_steam_ref(text: str) -> tuple[str, str]:
    """("id64", "7656…") ou ("vanity", "nome") a partir da URL do perfil, do id ou do nome."""
    t = text.strip()
    m = _PROFILE.search(t)
    if m:
        kind, value = m.group(1).lower(), unquote(m.group(2))
        if kind == "profiles":
            if not _ID64.match(value):
                raise ValueError(f"{value!r} não é um ID Steam (17 dígitos começando com 7656)")
            return "id64", value
        return "vanity", value
    if _ID64.match(t):
        return "id64", t
    if _VANITY.match(t):
        return "vanity", t
    raise ValueError("Não reconheci esse perfil. Cole a URL (steamcommunity.com/id/… ou /profiles/…).")


def library_cover(appid: str) -> str:
    """Capa vertical no caminho antigo; jogos mais novos usam caminho com hash (vem de GetItems)."""
    return f"{ASSETS_URL}steam/apps/{appid}/library_600x900.jpg"


def store_url(appid: str) -> str:
    return f"https://store.steampowered.com/app/{appid}/"


class SteamClient:
    store = "steam"

    def __init__(self, api_key: str):
        self.api_key = api_key
        self._http = RateLimitedClient("steam", rate=4, per=1, concurrency=2, base_url=API_URL)

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)

    def _require_key(self) -> None:
        if not self.enabled:
            raise ProviderError("steam: cadastre a chave da Steam Web API em Configurações")

    async def check(self) -> str:
        """Testa a chave resolvendo um perfil conhecido (o do Gabe Newell)."""
        if not self.enabled:
            raise ProviderError("Preencha a chave da Steam Web API.")
        resp = await self._http.request(
            "GET", "/ISteamUser/ResolveVanityURL/v1/", params={"key": self.api_key, "vanityurl": "gabelogannewell"}
        )
        if resp.status_code in (401, 403):
            raise ProviderError("A Steam recusou a chave. Confira se copiou ela inteira.")
        if resp.status_code >= 400:
            raise ProviderError(f"A Steam respondeu HTTP {resp.status_code}.")
        return "Steam respondeu: chave funcionando."

    async def resolve(self, ref: str) -> str:
        try:
            kind, value = parse_steam_ref(ref)
        except ValueError as e:
            raise ProviderError(str(e)) from None
        if kind == "id64":
            return value
        self._require_key()
        data = await self._http.get_json(
            "/ISteamUser/ResolveVanityURL/v1/", params={"key": self.api_key, "vanityurl": value}
        )
        resp = data.get("response") if isinstance(data, dict) else None
        if not resp or resp.get("success") != 1 or not resp.get("steamid"):
            raise ProviderError(f"Perfil Steam {value!r} não encontrado")
        return str(resp["steamid"])

    async def connect(self, ref: str) -> StoreProfile:
        steamid = await self.resolve(ref)
        self._require_key()
        data = await self._http.get_json(
            "/ISteamUser/GetPlayerSummaries/v2/", params={"key": self.api_key, "steamids": steamid}
        )
        players = (data.get("response") or {}).get("players") if isinstance(data, dict) else None
        if not players:
            raise ProviderError(f"Perfil Steam {steamid} não encontrado")
        p = players[0]
        return StoreProfile(
            external_user_id=steamid,
            display_name=p.get("personaname"),
            avatar_url=p.get("avatarfull") or p.get("avatarmedium"),
            profile_url=p.get("profileurl") or f"https://steamcommunity.com/profiles/{steamid}/",
        )

    async def fetch_library(
        self, external_user_id: str, credentials: dict, save_credentials: SaveCredentials, known: set[str]
    ) -> list[StoreGame]:
        self._require_key()
        data = await self._http.get_json(
            "/IPlayerService/GetOwnedGames/v1/",
            params={
                "key": self.api_key,
                "steamid": external_user_id,
                "include_appinfo": 1,
                "include_played_free_games": 1,
                "skip_unvetted_apps": 0,
                "format": "json",
            },
        )
        resp = data.get("response") if isinstance(data, dict) else None
        if resp is None or ("games" not in resp and resp.get("game_count") != 0):
            # Perfil privado: a Steam responde {"response": {}} em vez de erro.
            raise ProviderError(
                "A lista de jogos dessa conta Steam está privada. No perfil, em Privacidade, "
                "deixe “Detalhes do jogo” como Público."
            )
        games: list[StoreGame] = []
        for g in resp.get("games") or []:
            appid = str(g["appid"])
            last = g.get("rtime_last_played") or 0
            games.append(
                StoreGame(
                    external_id=appid,
                    name=(g.get("name") or "").strip() or f"App {appid}",
                    playtime_minutes=int(g.get("playtime_forever") or 0),
                    last_played_at=datetime.fromtimestamp(last, timezone.utc).replace(tzinfo=None) if last else None,
                    url=store_url(appid),
                )
            )
        new = [g for g in games if g.external_id not in known]
        covers = await self.covers([g.external_id for g in new]) if new else {}
        for g in new:
            g.cover_url = covers.get(g.external_id) or library_cover(g.external_id)
        return games

    async def covers(self, appids: list[str]) -> dict[str, str]:
        """URL atual da capa vertical (library_capsule) de cada app. Falha aqui não derruba a sync."""
        out: dict[str, str] = {}
        for i in range(0, len(appids), ASSETS_BATCH):
            batch = appids[i : i + ASSETS_BATCH]
            payload = {
                "ids": [{"appid": int(a)} for a in batch],
                "context": {"language": "english", "country_code": "US"},
                "data_request": {"include_assets": True},
            }
            try:
                data = await self._http.get_json(
                    "/IStoreBrowseService/GetItems/v1/", params={"key": self.api_key, "input_json": json.dumps(payload)}
                )
            except ProviderError:
                continue
            for item in ((data.get("response") or {}).get("store_items") or []) if isinstance(data, dict) else []:
                assets = item.get("assets") or {}
                fmt, capsule = assets.get("asset_url_format"), assets.get("library_capsule")
                if item.get("appid") and fmt and capsule:
                    out[str(item["appid"])] = ASSETS_URL + fmt.replace("${FILENAME}", capsule)
        return out

    async def aclose(self) -> None:
        await self._http.aclose()
