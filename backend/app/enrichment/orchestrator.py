"""Enriquecimento de um jogo: resolve o link em cada provider, busca os metadados e faz o merge.

Ordem: IGDB primeiro (âncora: nome canônico, ano e aliases alimentam os outros), depois RAWG e
HLTB em paralelo, por fim Metacritic (usa o slug que a RAWG conhece).

Regras do merge:
- campos do usuário (status, nota, review, tempo jogado, datas, gênero, lojas…) nunca mudam;
- campo em `locked_fields` (editado à mão) não muda;
- resultado vazio nunca apaga valor existente;
- cada provider é isolado: falha de um vira status 'error' só dele.
"""

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy import delete

from app import db as dbmod
from app.domain import PROVIDERS, merge_tags
from app.integrations.base import Candidate, MatchContext, MetadataPatch, Provider, ProviderError
from app.integrations.cache import cached
from app.integrations.matching import decide, display_score, query_variants, rank
from app.integrations.registry import get_provider
from app.models import ExternalLink, Game, Media, StoreReview
from app.services.media_cache import cache_game_images

log = logging.getLogger(__name__)

PROVIDER_LABELS = {"igdb": "IGDB", "rawg": "RAWG", "hltb": "HLTB", "metacritic": "Metacritic"}


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


@dataclass
class LinkSnap:
    status: str
    external_id: str | None


@dataclass
class GameSnap:
    id: int
    name: str
    platform: str
    ctx: MatchContext
    links: dict[str, LinkSnap]


@dataclass
class ProviderResult:
    provider: str
    status: str  # ok | not_found | ambiguous | error | ignored | disabled
    link: dict | None = None
    patch: MetadataPatch | None = None
    message: str = ""
    candidates: list[Candidate] = field(default_factory=list)


def load_snapshot(game_id: int) -> GameSnap | None:
    with dbmod.new_session() as db:
        g = db.get(Game, game_id)
        if g is None:
            return None
        p = g.platform
        ctx = MatchContext(
            name=g.name,
            platform=p.name,
            igdb_platform_id=p.igdb_platform_id,
            rawg_platform_id=p.rawg_platform_id,
            metacritic_platform=p.metacritic_name,
            hltb_platform=p.hltb_name,
            year=g.release_date.year if g.release_date else None,
        )
        links = {lk.provider: LinkSnap(lk.status, lk.external_id) for lk in g.links}
        return GameSnap(id=g.id, name=g.name, platform=p.name, ctx=ctx, links=links)


async def search_ranked(provider: Provider, ctx: MatchContext, *, force: bool = False) -> list[Candidate]:
    """Busca com as variantes do nome até achar um match claro; junta e ranqueia os candidatos."""
    queries = [*ctx.queries()]
    for variant, penalty in query_variants(ctx.name)[1:]:
        if penalty and variant:
            queries.append(variant)
    seen: dict[str, Candidate] = {}
    ranked: list[Candidate] = []
    for q in dict.fromkeys(queries):
        found = await cached(
            provider.name,
            "search",
            (q, ctx.platform),
            lambda q=q: provider.search(q, ctx),
            list[Candidate],
            force=force,
        )
        for c in found:
            seen.setdefault(c.external_id, c)
        ranked = rank(list(seen.values()), ctx)
        if decide(ranked)[0] == "matched":
            break
    return ranked


def _candidates_json(ranked: list[Candidate]) -> list[dict]:
    return [
        {
            "external_id": c.external_id,
            "name": c.name,
            "year": c.year,
            "platforms": c.platforms[:8],
            "cover_thumb": c.cover_thumb,
            "url": c.url,
            "score": display_score(c.score),
        }
        for c in ranked[:5]
    ]


async def resolve_and_fetch(
    provider: Provider,
    ctx: MatchContext,
    link: LinkSnap | None,
    *,
    force: bool = False,
    rematch: bool = False,
    id_hint: str | None = None,
) -> ProviderResult:
    name = provider.name
    if not provider.enabled:
        return ProviderResult(name, "disabled")
    if link and link.status == "ignored" and not rematch:
        return ProviderResult(name, "ignored")

    keep = bool(link and link.external_id and link.status in ("matched", "confirmed") and not rematch)
    update: dict = {}
    hint: Candidate | None = None
    try:
        if keep:
            assert link is not None
            chosen = link.external_id
            update = {"status": link.status}
        else:
            ranked = await search_ranked(provider, ctx, force=force)
            decision, best = decide(ranked)
            if decision != "matched" and id_hint:
                # o slug veio de outra integração (ex.: metacritic_url da RAWG)
                best = next((c for c in ranked if c.external_id == id_hint), None) or Candidate(
                    provider=name, external_id=id_hint, name=ctx.canonical_name or ctx.name
                )
                decision = "matched"
            update = {"candidates": _candidates_json(ranked), "status": decision, "last_error": None}
            if decision != "matched" or best is None:
                update.update(external_id=None, matched_name=None, match_score=None, external_url=None)
                return ProviderResult(name, decision, link=update, candidates=ranked)
            chosen = best.external_id
            hint = best
            update.update(
                external_id=chosen,
                matched_name=best.name,
                match_score=display_score(best.score),
                external_url=best.url,
            )
        assert chosen is not None
        patch = await cached(
            name,
            "fetch",
            (chosen, ctx.platform),
            lambda: provider.fetch(chosen, ctx, hint),
            MetadataPatch,
            force=force,
        )
        if patch.url and not update.get("external_url"):
            update["external_url"] = patch.url
        update.update(last_error=None, last_synced_at=_now())
        return ProviderResult(name, "ok", link=update, patch=patch)
    except ProviderError as e:
        msg = str(e)
    except Exception as e:  # noqa: BLE001  (resposta inesperada não pode derrubar o lote)
        log.exception("erro inesperado em %s", name)
        msg = f"{name}: erro inesperado ({type(e).__name__}: {e})"
    status = link.status if keep and link else "error"
    return ProviderResult(name, "error", link={"status": status, "last_error": msg[:500]}, message=msg)


def _first(*values):
    for v in values:
        if v not in (None, "", []):
            return v
    return None


def _merge_tags(
    g: Game, locked: set[str], results: dict[str, ProviderResult], igdb: MetadataPatch, rawg: MetadataPatch
) -> None:
    """Tags = IGDB (gêneros, temas, perspectiva, modos) + comunidade da RAWG; os gêneros da RAWG só
    entram se o IGDB respondeu sem nada. Se uma das duas não rodou ou falhou, soma ao que o jogo já
    tem em vez de trocar, para não apagar as tags dela."""
    if "tags" in locked:
        return
    ran = {name: results[name].status for name in ("igdb", "rawg") if name in results}
    if "ok" not in ran.values():
        return
    partial = any(ran.get(name, "error") == "error" for name in ("igdb", "rawg"))
    tags = merge_tags(igdb.tags or (rawg.genres if ran.get("igdb", "error") != "error" else []), rawg.tags)
    if partial:
        tags = merge_tags(tags, g.tags)
    if tags and tags != g.tags:
        g.tags = tags


def apply_results(game_id: int, results: dict[str, ProviderResult]) -> None:
    with dbmod.new_session() as db:
        g = db.get(Game, game_id)
        if g is None:
            return
        locked = set(g.locked_fields or [])
        links = {lk.provider: lk for lk in g.links}
        for name, r in results.items():
            if r.link is None:
                continue
            lk = links.get(name)
            if lk is None:
                lk = ExternalLink(provider=name, candidates=[])
                g.links.append(lk)
            for k, v in r.link.items():
                setattr(lk, k, v)

        def ok(name: str) -> MetadataPatch:
            r = results.get(name)
            return r.patch if r and r.status == "ok" and r.patch else MetadataPatch()

        igdb, rawg, hltb, mc = ok("igdb"), ok("rawg"), ok("hltb"), ok("metacritic")

        def put(field_name: str, *values) -> None:
            if field_name in locked:
                return
            v = _first(*values)
            if v is not None and getattr(g, field_name) != v:
                setattr(g, field_name, v)
                if field_name in ("cover_url", "background_url"):
                    setattr(g, field_name.replace("_url", "_path"), None)

        put("description", igdb.description, rawg.description)
        put("storyline", igdb.storyline)
        put("cover_url", igdb.cover_url)
        put("background_url", igdb.background_url, rawg.background_url)
        put("release_date", igdb.release_date, rawg.release_date)
        put("developer", igdb.developer, rawg.developer)
        put("publisher", igdb.publisher, rawg.publisher)
        _merge_tags(g, locked, results, igdb, rawg)

        scores = mc.metacritic if mc.metacritic and mc.metacritic.metascore else rawg.metacritic
        if scores:
            if "metacritic_score" not in locked and scores.metascore:
                g.metacritic_score = scores.metascore
                g.metacritic_source = scores.source
            put("metacritic_user_score", scores.user_score)
            put("metacritic_url", scores.url)

        times = hltb.hltb if hltb.hltb and hltb.hltb.main else igdb.hltb
        if times:
            put("hltb_main_hours", times.main)
            put("hltb_extra_hours", times.extra)
            put("hltb_complete_hours", times.complete)

        # Mídia de integração é substituída em bloco; a cadastrada à mão fica. A mesma URL reaproveita a
        # linha (e o arquivo já baixado): apagar e inserir de novo no mesmo flush fere o UNIQUE da URL.
        for kind, sources in (
            ("screenshot", (("igdb", igdb.screenshots), ("rawg", rawg.screenshots))),
            ("video", (("igdb", igdb.videos), ("rawg", rawg.videos))),
        ):
            provider, refs = next(((p, r) for p, r in sources if r), (None, []))
            if not refs:
                continue
            keep = [m for m in g.media if m.kind == kind and m.provider == "manual"]
            old = {m.url: m for m in g.media if m.kind == kind and m.provider != "manual"}
            seen = {m.url for m in keep}
            fresh: list[Media] = []
            for ref in refs:
                if ref.url in seen:
                    continue
                seen.add(ref.url)
                m = old.pop(ref.url, None) or Media(kind=kind, url=ref.url)
                if m.thumb_url != ref.thumb_url:
                    m.thumb_path = None
                m.thumb_url, m.provider, m.provider_ref, m.title = ref.thumb_url, provider, ref.ref, ref.title
                m.position = len(keep) + len(fresh)
                fresh.append(m)
            g.media = [m for m in g.media if m.kind != kind] + keep + fresh

        for name in ("metacritic", "rawg", "igdb"):
            r = results.get(name)
            if not (r and r.status == "ok" and r.patch):
                continue
            db.execute(delete(StoreReview).where(StoreReview.game_id == g.id, StoreReview.provider == name))
            for rv in r.patch.reviews:
                db.add(StoreReview(game_id=g.id, provider=name, **rv.model_dump()))

        if any(r.status == "ok" for r in results.values()):
            g.last_enriched_at = _now()
        db.commit()


def summarize(game_label: str, results: dict[str, ProviderResult]) -> str:
    words = {
        "not_found": "sem correspondência",
        "ambiguous": "precisa confirmar",
        "error": "erro",
        "ignored": "ignorado",
        "disabled": "sem chave",
    }
    parts = []
    for name, r in results.items():
        label = PROVIDER_LABELS.get(name, name)
        if r.status == "ok":
            detail = "ok"
            if name == "metacritic":
                mc = r.patch.metacritic if r.patch else None
                detail = str(mc.metascore) if mc and mc.metascore else "sem nota ainda"
            elif name == "hltb" and r.patch and r.patch.hltb and r.patch.hltb.main:
                detail = f"{r.patch.hltb.main:g}h".replace(".", ",")
            parts.append(f"{label} {detail}")
        else:
            parts.append(f"{label} {words.get(r.status, r.status)}")
    return f"{game_label}: " + " · ".join(parts)


async def enrich_game(
    game_id: int,
    providers: list[str] | None = None,
    *,
    force: bool = False,
    rematch: bool = False,
) -> tuple[str, dict[str, ProviderResult]]:
    snap = await asyncio.to_thread(load_snapshot, game_id)
    if snap is None:
        return f"jogo {game_id} não existe mais", {}
    wanted = [p for p in PROVIDERS if providers is None or p in providers]
    ctx = snap.ctx
    results: dict[str, ProviderResult] = {}

    async def run(name: str, **kw) -> ProviderResult:
        return await resolve_and_fetch(
            get_provider(name), ctx, snap.links.get(name), force=force, rematch=rematch, **kw
        )

    if "igdb" in wanted:
        results["igdb"] = await run("igdb")
        p = results["igdb"].patch
        if p:
            ctx.canonical_name = p.canonical_name
            ctx.alt_names = p.alt_names[:10]
            ctx.year = ctx.year or p.year
    parallel = [n for n in ("rawg", "hltb") if n in wanted]
    for name, res in zip(parallel, await asyncio.gather(*(run(n) for n in parallel)), strict=True):
        results[name] = res
    if "metacritic" in wanted:
        rawg_patch = results.get("rawg").patch if results.get("rawg") else None
        hint = rawg_patch.hints.get("metacritic_slug") if rawg_patch else None
        results["metacritic"] = await run("metacritic", id_hint=hint)

    await asyncio.to_thread(apply_results, game_id, results)
    try:
        await cache_game_images(game_id)
    except Exception:  # noqa: BLE001
        log.exception("falha ao baixar imagens do jogo %s", game_id)
    return summarize(f"{snap.name} ({snap.platform})", results), results
