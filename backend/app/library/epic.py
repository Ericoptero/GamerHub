"""Epic Games Store, pelos mesmos endpoints do launcher que o Legendary/Heroic usam.

Login: o usuário abre LOGIN_URL (já logado na Epic), copia o `authorizationCode` da página
e cola aqui. O refresh token gira a cada uso e vale algumas semanas; a sync diária o mantém vivo.
"""

import json
import re
from typing import Any

import httpx

from app.integrations.base import ProviderError
from app.integrations.cache import cached
from app.integrations.http import RateLimitedClient
from app.library.base import AuthExpired, SaveCredentials, StoreGame, StoreProfile

# Client público do Epic Games Launcher (o mesmo do Legendary).
CLIENT_ID = "34a02cf8f4414e29b15921876da36f9a"
CLIENT_SECRET = "daafbccc737745039dffe53d94fc76cf"
LOGIN_URL = (
    "https://www.epicgames.com/id/login?redirectUrl="
    f"https%3A%2F%2Fwww.epicgames.com%2Fid%2Fapi%2Fredirect%3FclientId%3D{CLIENT_ID}%26responseType%3Dcode"
)
OAUTH_URL = "https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token"
LIBRARY_URL = "https://library-service.live.use1a.on.epicgames.com/library/api/public"
CATALOG_URL = "https://catalog-public-service-prod06.ol.epicgames.com/catalog/api/shared/namespace"
# Capa vertical primeiro.
COVER_TYPES = ("DieselGameBoxTall", "OfferImageTall", "Thumbnail", "DieselGameBox")

_CODE = re.compile(r"\b[0-9a-f]{32}\b")


def extract_code(text: str) -> str:
    """Aceita o código sozinho ou o JSON inteiro da página de redirecionamento."""
    t = text.strip()
    try:
        data = json.loads(t)
        if isinstance(data, dict) and data.get("authorizationCode"):
            return str(data["authorizationCode"])
    except ValueError:
        pass
    m = _CODE.search(t)
    if not m:
        raise ProviderError("Não achei o código. Cole o authorizationCode (32 letras e números) da página da Epic.")
    return m.group(0)


def _cover(item: dict) -> str | None:
    images = {img.get("type"): img.get("url") for img in item.get("keyImages") or [] if img.get("url")}
    return next((images[t] for t in COVER_TYPES if t in images), None)


def is_base_game(item: dict) -> bool:
    if item.get("mainGameItem"):
        return False  # DLC
    paths = {c.get("path") for c in item.get("categories") or []}
    return not paths or "games" in paths


class EpicClient:
    store = "epic"
    enabled = True

    def __init__(self) -> None:
        self._http = RateLimitedClient("epic", rate=5, per=1, concurrency=4)
        # Token: sem retentativa. Repetir um refresh que o servidor já girou vira "invalid_grant".
        self._auth = RateLimitedClient("epic", rate=2, per=1, concurrency=1, attempts=1)

    async def _token(self, form: dict[str, str]) -> dict:
        resp = await self._auth.request(
            "POST", OAUTH_URL, data={**form, "token_type": "eg1"}, auth=httpx.BasicAuth(CLIENT_ID, CLIENT_SECRET)
        )
        if resp.status_code in (400, 401, 403):
            try:
                code = (resp.json() or {}).get("errorCode", "")
            except ValueError:
                code = ""
            raise AuthExpired(f"epic: login recusado ({code or resp.status_code})")
        if resp.status_code >= 400:
            raise ProviderError(f"epic: HTTP {resp.status_code} ao autenticar")
        return resp.json()

    @staticmethod
    def _credentials(token: dict) -> dict:
        return {
            "refresh_token": token["refresh_token"],
            "refresh_expires_at": token.get("refresh_expires_at"),
            "account_id": token.get("account_id"),
        }

    async def connect(self, ref: str) -> StoreProfile:
        try:
            token = await self._token({"grant_type": "authorization_code", "code": extract_code(ref)})
        except AuthExpired:
            raise ProviderError("Código da Epic inválido ou expirado (vale poucos minutos). Gere outro.") from None
        return StoreProfile(
            external_user_id=token["account_id"],
            display_name=token.get("displayName"),
            credentials=self._credentials(token),
        )

    async def fetch_library(
        self, external_user_id: str, credentials: dict, save_credentials: SaveCredentials, known: set[str]
    ) -> list[StoreGame]:
        refresh = credentials.get("refresh_token")
        if not refresh:
            raise AuthExpired("epic: conta sem token salvo")
        token = await self._token({"grant_type": "refresh_token", "refresh_token": refresh})
        await save_credentials(self._credentials(token))
        headers = {"Authorization": f"Bearer {token['access_token']}"}

        records: list[dict] = []
        cursor: str | None = None
        while True:
            params: dict[str, Any] = {"includeMetadata": "true"}
            if cursor:
                params["cursor"] = cursor
            page = await self._http.get_json(f"{LIBRARY_URL}/items", params=params, headers=headers)
            records += [r for r in page.get("records") or [] if r.get("namespace") != "ue"]
            cursor = (page.get("responseMetadata") or {}).get("nextCursor")
            if not cursor:
                break

        try:
            plays = await self._http.get_json(
                f"{LIBRARY_URL}/playtime/account/{external_user_id}/all", headers=headers
            )
            minutes = {p.get("artifactId"): int(p.get("totalTime") or 0) // 60 for p in plays if isinstance(p, dict)}
        except ProviderError:
            minutes = {}

        games: dict[str, StoreGame] = {}
        for r in records:
            cid, ns = r.get("catalogItemId"), r.get("namespace")
            if not cid or not ns or cid in games:
                continue
            game = StoreGame(external_id=cid, playtime_minutes=minutes.get(r.get("appName")))
            if cid not in known:
                item = await self._catalog(ns, cid, headers)
                if item is None or not is_base_game(item):
                    continue
                game.name = (item.get("title") or "").strip() or r.get("appName") or cid
                game.cover_url = _cover(item)
            games[cid] = game
        return list(games.values())

    async def _catalog(self, namespace: str, catalog_id: str, headers: dict) -> dict | None:
        async def load() -> dict | None:
            data = await self._http.get_json(
                f"{CATALOG_URL}/{namespace}/bulk/items",
                params={
                    "id": catalog_id,
                    "includeDLCDetails": "true",
                    "includeMainGameDetails": "true",
                    "country": "US",
                    "locale": "en-US",
                },
                headers=headers,
            )
            item = data.get(catalog_id) if isinstance(data, dict) else None
            if not item:
                return None
            return {k: item.get(k) for k in ("title", "keyImages", "categories", "mainGameItem")}

        try:
            return await cached("epic", "catalog", (namespace, catalog_id), load, dict | None)
        except ProviderError:
            return None

    async def aclose(self) -> None:
        await self._http.aclose()
        await self._auth.aclose()
