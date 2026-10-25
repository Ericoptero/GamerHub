"""RAWG (https://rawg.io/apidocs). Fallback de metadados e fonte de metacritic_url/nota."""

import asyncio
import re
from datetime import date

from app.integrations.base import (
    Candidate,
    MatchContext,
    MediaRef,
    MetadataPatch,
    NotFound,
    ProviderError,
    ReviewRef,
    Scores,
    WrongLink,
)
from app.integrations.http import RateLimitedClient

API_URL = "https://api.rawg.io/api"
LINK = re.compile(r"rawg\.io/games/([a-z0-9][a-z0-9-]*)", re.I)  # página do jogo no site


def resized(url: str | None, width: int = 640) -> str | None:
    """A RAWG serve versões redimensionadas trocando o caminho da mídia."""
    if not url or "media.rawg.io/media/" not in url:
        return url
    return url.replace("media.rawg.io/media/", f"media.rawg.io/media/resize/{width}/-/", 1)


def metacritic_slug(url: str | None) -> str | None:
    """Aceita /game/{slug}/ e o formato antigo /game/{plataforma}/{slug}."""
    if not url:
        return None
    m = re.search(r"metacritic\.com/game/([^/?#]+)(?:/([^/?#]+))?", url)
    if not m:
        return None
    first, second = m.group(1), m.group(2)
    old_platforms = {"pc", "switch", "playstation-4", "playstation-3", "xbox-one", "3ds", "ds", "game-boy-advance"}
    if second and second not in {"critic-reviews", "user-reviews", "details"} and first in old_platforms:
        return second
    return first


# Tags da comunidade que falam da loja ou do PC (conquistas, nuvem, controle, legendas…), não do jogo.
_TAG_NOISE = re.compile(
    r"steam|achievement|controller|cloud|trading card|workshop|leaderboard|caption|commentary|remote play|"
    r"in-app|anti-cheat|family sharing|exclusive|sdk|hdr|timeline|includes|cross-platform|mouse only|"
    r"^stats$|^online$|^console$",
    re.I,
)
TAGS_MAX = 12


def community_tags(raw: list[dict] | None) -> list[str]:
    """Tags em inglês da RAWG (Metroidvania, Souls-like, Atmospheric…), sem o ruído de loja."""
    out: list[str] = []
    for t in raw or []:
        name = (t.get("name") or "").strip()
        if not name or t.get("language", "eng") != "eng" or _TAG_NOISE.search(name):
            continue
        out.append(name[:1].upper() + name[1:])
        if len(out) == TAGS_MAX:
            break
    return out


def _year(released: str | None) -> int | None:
    return int(released[:4]) if released and released[:4].isdigit() else None


class RAWGProvider:
    name = "rawg"

    def __init__(self, api_key: str):
        self.api_key = api_key
        self._http = RateLimitedClient("rawg", rate=5, per=1, concurrency=4, base_url=API_URL)

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)

    async def check(self) -> str:
        if not self.enabled:
            raise ProviderError("Preencha a chave da RAWG.")
        resp = await self._http.request("GET", "/games", params={"key": self.api_key, "page_size": 1})
        if resp.status_code in (401, 403):
            raise ProviderError("A RAWG recusou a chave. Confira se copiou ela inteira.")
        if resp.status_code >= 400:
            raise ProviderError(f"A RAWG respondeu HTTP {resp.status_code}.")
        return "RAWG respondeu: chave funcionando."

    async def _get(self, path: str, **params) -> dict:
        data = await self._http.get_json(path, params={"key": self.api_key, **params})
        return data if isinstance(data, dict) else {}

    def _candidate(self, g: dict, ctx: MatchContext) -> Candidate:
        plats = [p["platform"] for p in g.get("platforms") or [] if p.get("platform")]
        on_platform = None
        if ctx.rawg_platform_id and plats:
            on_platform = any(p.get("id") == ctx.rawg_platform_id for p in plats)
        return Candidate(
            provider=self.name,
            external_id=str(g["id"]),
            name=g.get("name", ""),
            year=_year(g.get("released")),
            platforms=[p.get("name", "") for p in plats],
            platform_ids=[p["id"] for p in plats if p.get("id")],
            on_platform=on_platform,
            cover_thumb=resized(g.get("background_image"), 200),
            genres=[x["name"] for x in g.get("genres") or [] if x.get("name")],
            url=f"https://rawg.io/games/{g.get('slug')}" if g.get("slug") else None,
            extra={"metacritic": g.get("metacritic")},
        )

    async def search(self, query: str, ctx: MatchContext) -> list[Candidate]:
        data = await self._get("/games", search=query, search_precise="true", page_size=12)
        return [self._candidate(g, ctx) for g in data.get("results") or []]

    async def from_link(self, url: str, ctx: MatchContext) -> Candidate | None:
        m = LINK.search(url)
        if not m:
            raise WrongLink("Cole o link da página do jogo na RAWG (rawg.io/games/…).")
        try:
            g = await self._get(f"/games/{m.group(1).lower()}")
            if g.get("redirect") and g.get("slug"):  # slug antigo: a RAWG aponta o novo
                g = await self._get(f"/games/{g['slug']}")
        except NotFound:
            return None
        return self._candidate(g, ctx) if g.get("id") else None

    async def fetch(self, external_id: str, ctx: MatchContext, hint: Candidate | None = None) -> MetadataPatch:
        gid = int(external_id)
        g, shots, movies = await asyncio.gather(
            self._get(f"/games/{gid}"),
            self._get(f"/games/{gid}/screenshots", page_size=8),
            self._get(f"/games/{gid}/movies"),
        )
        mc_url = g.get("metacritic_url") or None
        mc_score = g.get("metacritic")
        for mp in g.get("metacritic_platforms") or []:
            pname = (mp.get("platform") or {}).get("name", "")
            if ctx.metacritic_platform and pname.lower() == ctx.metacritic_platform.lower() and mp.get("metascore"):
                mc_score = mp["metascore"]
                mc_url = mp.get("url") or mc_url
        hints = {}
        if slug := metacritic_slug(mc_url):
            hints["metacritic_slug"] = slug
        released = g.get("released")
        reviews = []
        if g.get("rating") and g.get("ratings_count"):
            reviews.append(
                ReviewRef(
                    source="RAWG · usuários",
                    score_display=f"{g['rating']:.1f}/5",
                    score_norm=round(g["rating"] * 20),
                    text=f"{g['ratings_count']} avaliações na RAWG.",
                    url=f"https://rawg.io/games/{g.get('slug')}",
                )
            )
        devs = [d["name"] for d in g.get("developers") or [] if d.get("name")]
        pubs = [p["name"] for p in g.get("publishers") or [] if p.get("name")]
        return MetadataPatch(
            canonical_name=g.get("name"),
            alt_names=[n for n in g.get("alternative_names") or [] if n],
            year=_year(released),
            url=f"https://rawg.io/games/{g.get('slug')}" if g.get("slug") else None,
            description=(g.get("description_raw") or "").strip() or None,
            release_date=date.fromisoformat(released) if released else None,
            background_url=g.get("background_image") or None,
            screenshots=[
                MediaRef(url=s["image"], thumb_url=resized(s["image"], 640), ref=str(s.get("id")))
                for s in shots.get("results") or []
                if s.get("image")
            ],
            videos=[
                MediaRef(
                    url=(m.get("data") or {}).get("max") or (m.get("data") or {}).get("480"),
                    thumb_url=m.get("preview"),
                    ref=str(m.get("id")),
                    title=m.get("name"),
                )
                for m in movies.get("results") or []
                if (m.get("data") or {}).get("max") or (m.get("data") or {}).get("480")
            ][:2],
            tags=community_tags(g.get("tags")),
            genres=[x["name"] for x in g.get("genres") or [] if x.get("name")],
            developer=devs[0] if devs else None,
            publisher=pubs[0] if pubs else None,
            metacritic=Scores(metascore=mc_score, url=mc_url, source="rawg") if mc_score else None,
            reviews=reviews,
            hints=hints,
        )

    async def aclose(self) -> None:
        await self._http.aclose()
