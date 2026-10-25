"""IGDB v4 (https://api-docs.igdb.com). Autenticação por client credentials da Twitch."""

import asyncio
import re
import time
from datetime import datetime, timezone

from app.integrations.base import (
    Candidate,
    MatchContext,
    MediaRef,
    MetadataPatch,
    ProviderError,
    ReviewRef,
    Times,
    WrongLink,
)
from app.integrations.http import RateLimitedClient

TOKEN_URL = "https://id.twitch.tv/oauth2/token"
API_URL = "https://api.igdb.com/v4"
IMG = "https://images.igdb.com/igdb/image/upload/t_{size}/{id}.jpg"
LINK = re.compile(r"igdb\.com/games/([a-z0-9][a-z0-9-]*)", re.I)  # página do jogo no site

SEARCH_FIELDS = (
    "name, alternative_names.name, first_release_date, cover.image_id, "
    "game_type.type, genres.name, url, version_parent, platforms.name"
)
DETAIL_FIELDS = (
    "name, alternative_names.name, summary, storyline, first_release_date, url, "
    "cover.image_id, artworks.image_id, screenshots.image_id, videos.video_id, videos.name, "
    "genres.name, themes.name, player_perspectives.name, game_modes.name, aggregated_rating, aggregated_rating_count, "
    "involved_companies.company.name, involved_companies.developer, involved_companies.publisher"
)

# external_game_source do IGDB para as lojas que ele indexa por id (a Epic não tem id estável lá).
EXTERNAL_SOURCES = {"steam": 1, "gog": 5}
EXTERNAL_BATCH = 500


def img(image_id: str, size: str) -> str:
    return IMG.format(size=size, id=image_id)


def _quote(text: str) -> str:
    return text.replace("\\", " ").replace('"', " ")


def _year(ts: int | None) -> int | None:
    return datetime.fromtimestamp(ts, timezone.utc).year if ts else None


class IGDBProvider:
    name = "igdb"

    def __init__(self, client_id: str, client_secret: str):
        self.client_id = client_id
        self.client_secret = client_secret
        self._token: str | None = None
        self._token_expires = 0.0
        self._token_lock = asyncio.Lock()
        self._http = RateLimitedClient("igdb", rate=4, per=1, concurrency=4)

    @property
    def enabled(self) -> bool:
        return bool(self.client_id and self.client_secret)

    def set_credentials(self, client_id: str, client_secret: str) -> None:
        if (client_id, client_secret) != (self.client_id, self.client_secret):
            self.client_id, self.client_secret = client_id, client_secret
            self._token, self._token_expires = None, 0.0

    async def check(self) -> str:
        """Testa as credenciais pedindo um token novo à Twitch e fazendo uma consulta mínima."""
        if not self.enabled:
            raise ProviderError("Preencha o Client ID e o Client Secret.")
        try:
            await self._get_token(refresh=True)
        except ProviderError as e:
            if "autenticação" not in str(e):
                raise
            raise ProviderError("A Twitch recusou o Client ID ou o Client Secret. Confira os dois.") from None
        await self.query("games", "fields id; limit 1;")
        return "IGDB respondeu: credenciais funcionando."

    async def _get_token(self, refresh: bool = False) -> str:
        async with self._token_lock:
            if refresh or not self._token or time.time() > self._token_expires - 60:
                resp = await self._http.request(
                    "POST",
                    TOKEN_URL,
                    params={
                        "client_id": self.client_id,
                        "client_secret": self.client_secret,
                        "grant_type": "client_credentials",
                    },
                )
                if resp.status_code != 200:
                    raise ProviderError(f"igdb: autenticação na Twitch falhou (HTTP {resp.status_code})")
                data = resp.json()
                self._token = data["access_token"]
                self._token_expires = time.time() + float(data.get("expires_in", 3600))
            return self._token  # type: ignore[return-value]

    async def query(self, endpoint: str, body: str) -> list[dict]:
        if not self.enabled:
            raise ProviderError("igdb: credenciais não configuradas")
        for attempt in range(2):
            token = await self._get_token(refresh=attempt > 0)
            resp = await self._http.request(
                "POST",
                f"{API_URL}/{endpoint}",
                content=body,
                headers={"Client-ID": self.client_id, "Authorization": f"Bearer {token}", "Accept": "application/json"},
            )
            if resp.status_code == 401 and attempt == 0:
                continue
            if resp.status_code >= 400:
                raise ProviderError(f"igdb: HTTP {resp.status_code}: {resp.text[:200]}")
            data = resp.json()
            if not isinstance(data, list):
                raise ProviderError("igdb: resposta inesperada")
            return data
        raise ProviderError("igdb: token recusado")

    def _candidate(self, g: dict, ctx: MatchContext) -> Candidate:
        platforms = [p for p in g.get("platforms") or [] if isinstance(p, dict)]
        ids = [p["id"] for p in platforms if p.get("id")]
        on_platform = None
        if ctx.igdb_platform_id and ids:
            on_platform = ctx.igdb_platform_id in ids
        cover = (g.get("cover") or {}).get("image_id")
        return Candidate(
            provider=self.name,
            external_id=str(g["id"]),
            name=g.get("name", ""),
            alt_names=[a["name"] for a in g.get("alternative_names") or [] if a.get("name")],
            year=_year(g.get("first_release_date")),
            platforms=[p.get("name", "") for p in platforms if p.get("name")],
            platform_ids=ids,
            on_platform=on_platform,
            cover_thumb=img(cover, "cover_small") if cover else None,
            kind=((g.get("game_type") or {}).get("type") or "").lower() or None,
            genres=[x["name"] for x in g.get("genres") or [] if x.get("name")],
            url=g.get("url"),
        )

    async def lookup_external(self, source: int, uids: list[str]) -> dict[str, int]:
        """Id do jogo IGDB para cada id de loja (external_games). Edições sobem para o jogo base
        (version_parent), então "Complete Edition" na GOG e o jogo base na Steam dão o mesmo id."""
        out: dict[str, int] = {}
        for i in range(0, len(uids), EXTERNAL_BATCH):
            quoted = ",".join(f'"{_quote(u)}"' for u in uids[i : i + EXTERNAL_BATCH])
            body = (
                f"fields uid, game.id, game.version_parent; "
                f"where external_game_source = {source} & uid = ({quoted}); limit {EXTERNAL_BATCH};"
            )
            for row in await self.query("external_games", body):
                game = row.get("game") if isinstance(row.get("game"), dict) else {}
                gid = game.get("version_parent") or game.get("id")
                if row.get("uid") and gid:
                    out[str(row["uid"])] = int(gid)
        return out

    async def search(self, query: str, ctx: MatchContext) -> list[Candidate]:
        body = f'search "{_quote(query)}"; fields {SEARCH_FIELDS}; where version_parent = null; limit 20;'
        return [self._candidate(g, ctx) for g in await self.query("games", body)]

    async def from_link(self, url: str, ctx: MatchContext) -> Candidate | None:
        m = LINK.search(url)
        if not m:
            raise WrongLink("Cole o link da página do jogo no IGDB (igdb.com/games/…).")
        body = f'fields {SEARCH_FIELDS}; where slug = "{_quote(m.group(1).lower())}"; limit 1;'
        return next((self._candidate(g, ctx) for g in await self.query("games", body)), None)

    async def fetch(self, external_id: str, ctx: MatchContext, hint: Candidate | None = None) -> MetadataPatch:
        gid = int(external_id)
        games, ttb = await asyncio.gather(
            self.query("games", f"fields {DETAIL_FIELDS}; where id = {gid};"),
            self.query("game_time_to_beats", f"fields hastily, normally, completely; where game_id = {gid};"),
        )
        if not games:
            raise ProviderError(f"igdb: jogo {gid} não existe mais")
        g = games[0]
        companies = g.get("involved_companies") or []
        dev = next((c["company"]["name"] for c in companies if c.get("developer") and c.get("company")), None)
        pub = next((c["company"]["name"] for c in companies if c.get("publisher") and c.get("company")), None)
        cover = (g.get("cover") or {}).get("image_id")
        artworks = [a["image_id"] for a in g.get("artworks") or [] if a.get("image_id")]
        shots = [s["image_id"] for s in g.get("screenshots") or [] if s.get("image_id")]
        videos = sorted(
            (v for v in g.get("videos") or [] if v.get("video_id")),
            key=lambda v: 0 if "trailer" in (v.get("name") or "").lower() else 1,
        )
        release = g.get("first_release_date")
        reviews: list[ReviewRef] = []
        if g.get("aggregated_rating"):
            score = round(g["aggregated_rating"])
            reviews.append(
                ReviewRef(
                    source="IGDB · crítica agregada",
                    score_display=f"{score}/100",
                    score_norm=score,
                    text=f"Média de {g.get('aggregated_rating_count') or '?'} veículos de crítica.",
                    url=g.get("url"),
                )
            )
        times = None
        if ttb:
            t = ttb[0]

            def hours(key: str) -> float | None:
                return round(t[key] / 3600, 1) if t.get(key) else None

            times = Times(main=hours("normally") or hours("hastily"), complete=hours("completely"))
        return MetadataPatch(
            canonical_name=g.get("name"),
            alt_names=[a["name"] for a in g.get("alternative_names") or [] if a.get("name")],
            year=_year(release),
            url=g.get("url"),
            description=g.get("summary"),
            storyline=g.get("storyline"),
            release_date=datetime.fromtimestamp(release, timezone.utc).date() if release else None,
            cover_url=img(cover, "cover_big_2x") if cover else None,
            background_url=img(artworks[0], "1080p") if artworks else (img(shots[0], "1080p") if shots else None),
            screenshots=[MediaRef(url=img(s, "screenshot_huge"), thumb_url=img(s, "screenshot_med"), ref=s) for s in shots[:8]],
            videos=[
                MediaRef(url=f"https://www.youtube.com/watch?v={v['video_id']}", ref=v["video_id"], title=v.get("name"))
                for v in videos[:3]
            ],
            tags=[
                x["name"]
                for key in ("genres", "themes", "player_perspectives", "game_modes")
                for x in g.get(key) or []
                if x.get("name")
            ],
            genres=[x["name"] for x in g.get("genres") or [] if x.get("name")],
            developer=dev,
            publisher=pub,
            hltb=times,
            reviews=reviews,
        )

    async def aclose(self) -> None:
        await self._http.aclose()
