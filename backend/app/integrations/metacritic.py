"""Metacritic pelo backend JSON que o próprio site usa (não documentado, sem chave hoje).

Cadeia: finder (busca) → composer (metascore por plataforma) + user stats + críticas.
Se o composer falhar, lê o JSON-LD da página pública. A nota da RAWG é o último fallback
(aplicado no orquestrador).
"""

import asyncio
import json
import re
from datetime import date
from urllib.parse import quote

from app.domain import fold
from app.integrations.base import (
    Candidate,
    MatchContext,
    MetadataPatch,
    NotFound,
    ProviderError,
    ReviewRef,
    Scores,
    WrongLink,
)
from app.integrations.http import RateLimitedClient
from app.integrations.rawg import metacritic_slug
from app.services import api_keys

BACKEND = "https://backend.metacritic.com"
SITE = "https://www.metacritic.com"


def _date(value: str | None) -> date | None:
    try:
        return date.fromisoformat(value[:10]) if value else None
    except ValueError:
        return None


class MetacriticProvider:
    name = "metacritic"
    enabled = True

    def __init__(self) -> None:
        self._http = RateLimitedClient("metacritic", rate=1, per=1, concurrency=1)

    def _params(self, **params) -> dict:
        key = api_keys.current().metacritic_api_key
        return {**params, "apiKey": key} if key else params

    async def _json(self, path: str, **params) -> dict:
        data = await self._http.get_json(f"{BACKEND}{path}", params=self._params(**params))
        return data if isinstance(data, dict) else {}

    def _candidate(self, it: dict, ctx: MatchContext) -> Candidate:
        platforms = [p.get("name", "") for p in it.get("platforms") or []]
        on_platform = None
        if ctx.metacritic_platform and platforms:
            on_platform = fold(ctx.metacritic_platform) in {fold(p) for p in platforms}
        image = next((i.get("bucketPath") for i in it.get("images") or [] if i.get("typeName") == "cardImage"), None)
        return Candidate(
            provider=self.name,
            external_id=it["slug"],
            name=it.get("title", ""),
            year=it.get("premiereYear"),
            platforms=platforms,
            on_platform=on_platform,
            cover_thumb=f"https://www.metacritic.com/a/img/catalog{image}" if image else None,
            url=f"{SITE}/game/{it['slug']}/",
            extra={"score": (it.get("criticScoreSummary") or {}).get("score")},
        )

    async def search(self, query: str, ctx: MatchContext) -> list[Candidate]:
        data = await self._json(
            f"/finder/metacritic/search/{quote(query, safe='')}/web", mcoTypeId=13, offset=0, limit=10
        )
        items = (data.get("data") or {}).get("items") or []
        return [self._candidate(it, ctx) for it in items if it.get("slug") and it.get("typeId") == 13]

    async def from_link(self, url: str, ctx: MatchContext) -> Candidate | None:
        slug = metacritic_slug(url)
        if not slug:
            raise WrongLink("Cole o link da página do jogo no Metacritic (metacritic.com/game/…).")
        try:
            product = await self._product(slug)
        except NotFound:
            return None
        slug = product.get("slug") or slug
        platforms = [p.get("name", "") for p in product.get("platforms") or [] if p.get("name")]
        on_platform = None
        if ctx.metacritic_platform and platforms:
            on_platform = fold(ctx.metacritic_platform) in {fold(p) for p in platforms}
        return Candidate(
            provider=self.name,
            external_id=slug,
            name=product.get("title") or slug,
            year=product.get("premiereYear"),
            platforms=platforms,
            on_platform=on_platform,
            url=f"{SITE}/game/{slug}/",
            extra={"score": (product.get("criticScoreSummary") or {}).get("score")},
        )

    async def _product(self, slug: str) -> dict:
        data = await self._json(f"/composer/metacritic/pages/games/{slug}/web")
        for comp in data.get("components") or []:
            if (comp.get("meta") or {}).get("componentName") == "product":
                item = (comp.get("data") or {}).get("item")
                if item:
                    return item
        # O Metacritic responde 200 sem produto para um slug que não existe.
        raise NotFound("metacritic: página do jogo sem dados de produto")

    async def _jsonld_score(self, slug: str) -> int | None:
        resp = await self._http.request("GET", f"{SITE}/game/{slug}/")
        if resp.status_code != 200:
            return None
        for block in re.findall(r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>', resp.text, re.S):
            try:
                data = json.loads(block)
            except ValueError:
                continue
            rating = data.get("aggregateRating") if isinstance(data, dict) else None
            if rating and rating.get("ratingValue"):
                return round(float(rating["ratingValue"]))
        return None

    def _platform_entry(self, product: dict, ctx: MatchContext) -> dict | None:
        platforms = product.get("platforms") or []
        if ctx.metacritic_platform:
            want = fold(ctx.metacritic_platform)
            for p in platforms:
                if fold(p.get("name", "")) == want and (p.get("criticScoreSummary") or {}).get("score"):
                    return p
        lead = next((p for p in platforms if p.get("isLeadPlatform")), None)
        return lead

    async def fetch(self, external_id: str, ctx: MatchContext, hint: Candidate | None = None) -> MetadataPatch:
        slug = external_id
        try:
            product = await self._product(slug)
        except ProviderError:
            score = await self._jsonld_score(slug)
            if score is None and hint and hint.extra.get("score"):
                score = hint.extra["score"]
            if score is None:
                raise
            return MetadataPatch(
                url=f"{SITE}/game/{slug}/",
                metacritic=Scores(metascore=score, url=f"{SITE}/game/{slug}/", source="metacritic"),
            )

        entry = self._platform_entry(product, ctx)
        summary = (entry or {}).get("criticScoreSummary") or product.get("criticScoreSummary") or {}
        platform_slug = (entry or {}).get("slug")
        user, critics = await asyncio.gather(
            self._json(f"/reviews/metacritic/user/games/{slug}/stats/web"),
            self._json(
                f"/reviews/metacritic/critic/games/{slug}/web",
                offset=0,
                limit=3,
                sort="score",
                **({"platform": platform_slug} if platform_slug else {}),
            ),
            return_exceptions=True,
        )
        user_item = ((user if isinstance(user, dict) else {}).get("data") or {}).get("item") or {}
        user_score = user_item.get("score")
        reviews: list[ReviewRef] = []
        for it in ((critics if isinstance(critics, dict) else {}).get("data") or {}).get("items") or []:
            if not it.get("quote"):
                continue
            reviews.append(
                ReviewRef(
                    source="Metacritic · crítica",
                    outlet=it.get("publicationName"),
                    author=it.get("author") or None,
                    score_display=f"{it['score']}/100" if it.get("score") is not None else None,
                    score_norm=it.get("score"),
                    text=it.get("quote"),
                    url=it.get("url"),
                    review_date=_date(it.get("date")),
                )
            )
        if user_score is not None and user_item.get("reviewCount"):
            reviews.append(
                ReviewRef(
                    source="Metacritic · usuários",
                    score_display=f"{user_score}/10",
                    score_norm=round(float(user_score) * 10),
                    text=f"{user_item.get('sentiment') or 'Nota'} · {user_item['reviewCount']} avaliações.",
                    url=f"{SITE}/game/{slug}/user-reviews/",
                )
            )
        url = f"{SITE}/game/{slug}/"
        return MetadataPatch(
            canonical_name=product.get("title"),
            year=product.get("premiereYear"),
            url=url,
            metacritic=Scores(
                metascore=summary.get("score"),
                user_score=float(user_score) if user_score is not None else None,
                url=url,
                source="metacritic",
            ),
            reviews=reviews,
        )

    async def aclose(self) -> None:
        await self._http.aclose()
