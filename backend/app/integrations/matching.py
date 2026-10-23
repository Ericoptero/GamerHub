"""Casamento de um jogo local com candidatos das integrações (rapidfuzz).

Pontuação (0–~120, só ordena; a UI mostra limitada a 100):
- base: token_sort_ratio entre os nomes normalizados; se o candidato só acrescenta palavras de
  edição ("definitive", "remastered"…), vale ao menos 95;
- +10 nome idêntico; +8 roda na plataforma / −15 sabidamente não roda; +5 ano a ±1;
- −25 DLC/bundle/pacote quando a busca não pede isso;
- variantes degradadas da busca (sem parênteses, só o prefixo antes de ":") perdem 5 / 15;
  o prefixo do nome do candidato antes de ":" também concorre, perdendo 15.
Decisão: ≥ 90 com folga ≥ 5 sobre o segundo → matched; ≥ 70 → ambiguous; senão not_found.
"""

import re

from rapidfuzz import fuzz

from app.domain import normalize_title
from app.integrations.base import Candidate, MatchContext

MATCHED_MIN = 90.0
MATCH_MARGIN = 5.0
AMBIGUOUS_MIN = 70.0

EDITION_WORDS = {
    "edition", "version", "remastered", "remaster", "definitive", "deluxe", "complete", "goty", "game", "of",
    "year", "hd", "directors", "director", "cut", "enhanced", "anniversary", "collection", "classic", "the",
    "standard", "ultimate", "gold", "special", "royal", "plus", "dx", "redux", "and",
}  # fmt: skip
EXTRA_CONTENT_KINDS = {"dlc", "bundle", "pack", "expansion", "mod", "episode", "season", "update", "addon"}
EXTRA_CONTENT_QUERY = {"dlc", "pass", "expansion", "pack", "bundle", "episode", "season"}


def query_variants(name: str) -> list[tuple[str, float]]:
    """(texto normalizado, penalidade) — nome inteiro, sem parênteses e prefixo antes de ':'."""
    out: list[tuple[str, float]] = [(normalize_title(name), 0.0)]
    no_parens = re.sub(r"\s*[\(\[].*?[\)\]]\s*", " ", name).strip()
    if no_parens and no_parens != name:
        out.append((normalize_title(no_parens), 5.0))
    for sep in (":", " - "):
        if sep in name:
            out.append((normalize_title(name.split(sep, 1)[0]), 15.0))
            break
    seen: set[str] = set()
    return [(q, p) for q, p in out if q and not (q in seen or seen.add(q))]


def name_score(query: str, candidate: str) -> float:
    if not query or not candidate:
        return 0.0
    if query == candidate:
        return 110.0
    score = float(fuzz.token_sort_ratio(query, candidate))
    q_tokens, c_tokens = set(query.split()), set(candidate.split())
    if q_tokens <= c_tokens and (c_tokens - q_tokens) <= EDITION_WORDS:
        score = max(score, 95.0)
    elif c_tokens <= q_tokens and (q_tokens - c_tokens) <= EDITION_WORDS:
        score = max(score, 93.0)
    return score


def score_candidate(cand: Candidate, ctx: MatchContext, variants: list[tuple[str, float]] | None = None) -> float:
    variants = variants or query_variants(ctx.name)
    extra_names = [ctx.canonical_name, *ctx.alt_names] if ctx.canonical_name else []
    for alias in extra_names:
        if alias:
            variants = [*variants, (normalize_title(alias), 0.0)]
    names = [(normalize_title(n), 0.0) for n in [cand.name, *cand.alt_names] if n]
    # "Resident Evil 3: Nemesis" também concorre como "Resident Evil 3", com penalidade
    for sep in (":", " - "):
        if sep in cand.name:
            names.append((normalize_title(cand.name.split(sep, 1)[0]), 15.0))
            break
    best = max(
        (name_score(q, n) - qp - np for q, qp in variants for n, np in names if n),
        default=0.0,
    )

    if cand.on_platform is True:
        best += 8
    elif cand.on_platform is False:
        best -= 15
    year = ctx.year
    if year and cand.year and abs(year - cand.year) <= 1:
        best += 5
    kind = (cand.kind or "").lower()
    query_words = set(normalize_title(ctx.name).split())
    if any(k in kind for k in EXTRA_CONTENT_KINDS) and not (query_words & EXTRA_CONTENT_QUERY):
        best -= 25
    return round(best, 1)


def rank(candidates: list[Candidate], ctx: MatchContext) -> list[Candidate]:
    variants = query_variants(ctx.name)
    for c in candidates:
        c.score = score_candidate(c, ctx, variants)
    # Desempate estável: mantém a ordem de relevância do provider.
    return sorted(candidates, key=lambda c: -c.score)


def decide(ranked: list[Candidate]) -> tuple[str, Candidate | None]:
    """('matched', melhor) | ('ambiguous', None) | ('not_found', None)."""
    if not ranked:
        return "not_found", None
    best = ranked[0]
    second = ranked[1].score if len(ranked) > 1 else 0.0
    if best.score >= MATCHED_MIN and best.score - second >= MATCH_MARGIN:
        return "matched", best
    if best.score >= AMBIGUOUS_MIN:
        return "ambiguous", None
    return "not_found", None


def display_score(score: float) -> float:
    return max(0.0, min(100.0, score))
