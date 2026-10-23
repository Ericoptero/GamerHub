"""HowLongToBeat via howlongtobeatpy (scraping; o HLTB muda a API com frequência).

A biblioteca usa aiohttp por dentro, então os testes substituem `_lib_search`/`_lib_by_id`.
Retorno `None` da biblioteca significa erro (não "sem resultado").
"""

from aiolimiter import AsyncLimiter
from howlongtobeatpy import HowLongToBeat, SearchModifiers

from app.domain import fold
from app.integrations.base import Candidate, MatchContext, MetadataPatch, ProviderError, Times


def _h(value: float | None) -> float | None:
    return round(float(value), 1) if value else None


class HLTBProvider:
    name = "hltb"
    enabled = True

    def __init__(self) -> None:
        self._limiter = AsyncLimiter(1, 1.5)
        self._lib = HowLongToBeat(0.3)

    async def _lib_search(self, query: str, modifiers: SearchModifiers = SearchModifiers.HIDE_DLC) -> list | None:
        return await self._lib.async_search(query, search_modifiers=modifiers, similarity_case_sensitive=False)

    async def _lib_by_id(self, game_id: int):
        return await self._lib.async_search_from_id(game_id)

    def _candidate(self, e, ctx: MatchContext, *, keep_kind: bool = True) -> Candidate:
        platforms = [p for p in (e.profile_platforms or []) if p]
        on_platform = None
        if ctx.hltb_platform and platforms:
            on_platform = fold(ctx.hltb_platform) in {fold(p) for p in platforms}
        year = e.release_world if isinstance(e.release_world, int) and e.release_world > 1950 else None
        return Candidate(
            provider=self.name,
            external_id=str(e.game_id),
            name=e.game_name or "",
            alt_names=[e.game_alias] if e.game_alias else [],
            year=year,
            platforms=platforms,
            on_platform=on_platform,
            cover_thumb=e.game_image_url,
            kind=e.game_type if keep_kind else None,
            url=e.game_web_link,
            extra={"main": _h(e.main_story), "extra": _h(e.main_extra), "complete": _h(e.completionist)},
        )

    async def search(self, query: str, ctx: MatchContext) -> list[Candidate]:
        async with self._limiter:
            entries = await self._lib_search(query)
        if entries == []:
            # Expansões (ex.: "F.E.A.R. Perseus Mandate") são DLC no HLTB e somem com HIDE_DLC.
            # Se não há jogo-base com esse nome, a DLC não deve ser penalizada no ranking.
            async with self._limiter:
                entries = await self._lib_search(query, SearchModifiers.NONE)
            if entries:
                return [self._candidate(e, ctx, keep_kind=False) for e in entries]
        if entries is None:
            raise ProviderError("hltb: a busca falhou (a API do HowLongToBeat pode ter mudado)")
        return [self._candidate(e, ctx) for e in entries]

    async def fetch(self, external_id: str, ctx: MatchContext, hint: Candidate | None = None) -> MetadataPatch:
        if hint is not None and hint.external_id == external_id and hint.extra:
            extra, url = hint.extra, hint.url
        else:
            async with self._limiter:
                entry = await self._lib_by_id(int(external_id))
            if entry is None:
                raise ProviderError(f"hltb: não consegui ler o jogo {external_id}")
            cand = self._candidate(entry, ctx)
            extra, url = cand.extra, cand.url
        times = Times(main=extra.get("main"), extra=extra.get("extra"), complete=extra.get("complete"))
        return MetadataPatch(url=url, hltb=times if any(times.model_dump().values()) else None)

    async def aclose(self) -> None:
        return None
