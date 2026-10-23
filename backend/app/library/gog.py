"""GOG, pelo client do GOG Galaxy (o mesmo que o Heroic/lgogdownloader usam).

Login: o usuário abre LOGIN_URL, entra, e o navegador para numa página em branco cuja URL
tem `code=…`. Ele cola essa URL (ou só o código). O refresh token gira a cada uso.
"""

import re
from urllib.parse import parse_qs, quote, urlparse

from app.integrations.base import ProviderError
from app.integrations.http import RateLimitedClient
from app.library.base import AuthExpired, SaveCredentials, StoreGame, StoreProfile

CLIENT_ID = "46899977096215655"
CLIENT_SECRET = "9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9"
REDIRECT_URI = "https://embed.gog.com/on_login_success?origin=client"
LOGIN_URL = (
    f"https://auth.gog.com/auth?client_id={CLIENT_ID}&redirect_uri={quote(REDIRECT_URI, safe='')}"
    "&response_type=code&layout=client2"
)
TOKEN_URL = "https://auth.gog.com/token"
EMBED_URL = "https://embed.gog.com"
# As imagens vêm sem protocolo nem extensão; o sufixo escolhe o tamanho.
IMAGE_SUFFIX = "_392.jpg"

_CODE = re.compile(r"^[\w\-]{20,}$")


def extract_code(text: str) -> str:
    t = text.strip()
    if "code=" in t:
        values = parse_qs(urlparse(t).query).get("code")
        if values:
            return values[0]
    if _CODE.match(t):
        return t
    raise ProviderError("Não achei o código. Cole a URL inteira da página em branco (a que tem code=…).")


def image_url(image: str | None) -> str | None:
    if not image:
        return None
    url = f"https:{image}" if image.startswith("//") else image
    return url if re.search(r"\.(jpe?g|png|webp)$", url) else url + IMAGE_SUFFIX


class GogClient:
    store = "gog"
    enabled = True

    def __init__(self) -> None:
        self._http = RateLimitedClient("gog", rate=3, per=1, concurrency=2)
        self._auth = RateLimitedClient("gog", rate=2, per=1, concurrency=1, attempts=1)

    async def _token(self, params: dict[str, str]) -> dict:
        resp = await self._auth.request(
            "GET", TOKEN_URL, params={"client_id": CLIENT_ID, "client_secret": CLIENT_SECRET, **params}
        )
        if resp.status_code in (400, 401, 403):
            raise AuthExpired(f"gog: login recusado (HTTP {resp.status_code})")
        if resp.status_code >= 400:
            raise ProviderError(f"gog: HTTP {resp.status_code} ao autenticar")
        data = resp.json()
        if "access_token" not in data:
            raise AuthExpired(f"gog: login recusado ({data.get('error', 'sem token')})")
        return data

    async def _user(self, access_token: str) -> dict:
        data = await self._http.get_json(f"{EMBED_URL}/userData.json", headers=self._bearer(access_token))
        return data if isinstance(data, dict) else {}

    @staticmethod
    def _bearer(access_token: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {access_token}"}

    async def connect(self, ref: str) -> StoreProfile:
        try:
            token = await self._token(
                {"grant_type": "authorization_code", "code": extract_code(ref), "redirect_uri": REDIRECT_URI}
            )
        except AuthExpired:
            raise ProviderError("Código da GOG inválido ou já usado. Faça o login de novo e cole a URL nova.") from None
        user = await self._user(token["access_token"])
        username = user.get("username")
        return StoreProfile(
            external_user_id=str(user.get("galaxyUserId") or token.get("user_id")),
            display_name=username,
            avatar_url=image_url(user.get("avatar")) if user.get("avatar") else None,
            profile_url=f"https://www.gog.com/u/{username}" if username else None,
            credentials={"refresh_token": token["refresh_token"]},
        )

    async def fetch_library(
        self, external_user_id: str, credentials: dict, save_credentials: SaveCredentials, known: set[str]
    ) -> list[StoreGame]:
        refresh = credentials.get("refresh_token")
        if not refresh:
            raise AuthExpired("gog: conta sem token salvo")
        token = await self._token({"grant_type": "refresh_token", "refresh_token": refresh})
        await save_credentials({"refresh_token": token["refresh_token"]})
        headers = self._bearer(token["access_token"])

        games: list[StoreGame] = []
        page, total = 1, 1
        while page <= total:
            data = await self._http.get_json(
                f"{EMBED_URL}/account/getFilteredProducts",
                params={"mediaType": 1, "sortBy": "title", "page": page},
                headers=headers,
            )
            total = int(data.get("totalPages") or 1)
            for p in data.get("products") or []:
                if not p.get("id") or p.get("isGame") is False:
                    continue
                games.append(
                    StoreGame(
                        external_id=str(p["id"]),
                        name=(p.get("title") or "").strip() or str(p["id"]),
                        cover_url=image_url(p.get("image")),
                        url=f"https://www.gog.com{p['url']}" if p.get("url") else None,
                    )
                )
            page += 1
        return games

    async def aclose(self) -> None:
        await self._http.aclose()
        await self._auth.aclose()
