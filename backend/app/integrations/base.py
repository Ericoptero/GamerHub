"""Contrato comum dos providers de metadados (IGDB, RAWG, HLTB, Metacritic).

Os tipos são Pydantic para poderem ir e voltar do cache (provider_cache) como JSON.
"""

from datetime import date
from typing import Protocol

from pydantic import BaseModel


class ProviderError(Exception):
    """Falha transitória ou de configuração de um provider (vira link com status 'error')."""


class Candidate(BaseModel):
    provider: str
    external_id: str
    name: str
    alt_names: list[str] = []
    year: int | None = None
    platforms: list[str] = []  # nomes legíveis
    platform_ids: list[int] = []  # ids nativos do provider (IGDB, RAWG)
    on_platform: bool | None = None  # roda na plataforma do jogo? None = não dá para saber
    cover_thumb: str | None = None
    kind: str | None = None  # main, dlc, bundle, remake, port…
    genres: list[str] = []
    url: str | None = None
    score: float = 0.0
    extra: dict = {}  # dados que o provider já trouxe na busca (ex.: tempos do HLTB)


class MediaRef(BaseModel):
    url: str
    thumb_url: str | None = None
    ref: str | None = None
    title: str | None = None


class ReviewRef(BaseModel):
    source: str
    outlet: str | None = None
    author: str | None = None
    score_display: str | None = None
    score_norm: int | None = None
    text: str | None = None
    url: str | None = None
    review_date: date | None = None


class Scores(BaseModel):
    metascore: int | None = None
    user_score: float | None = None  # 0–10
    url: str | None = None
    source: str = "metacritic"


class Times(BaseModel):
    main: float | None = None
    extra: float | None = None
    complete: float | None = None


class MetadataPatch(BaseModel):
    """Tudo opcional; o orquestrador decide o que entra no jogo."""

    canonical_name: str | None = None
    alt_names: list[str] = []
    year: int | None = None
    url: str | None = None
    description: str | None = None
    storyline: str | None = None
    release_date: date | None = None
    cover_url: str | None = None
    background_url: str | None = None
    screenshots: list[MediaRef] = []
    videos: list[MediaRef] = []
    tags: list[str] = []
    genres: list[str] = []
    developer: str | None = None
    publisher: str | None = None
    metacritic: Scores | None = None
    hltb: Times | None = None
    reviews: list[ReviewRef] = []
    hints: dict[str, str] = {}  # ex.: metacritic_slug vindo da RAWG


class MatchContext(BaseModel):
    """O que se sabe do jogo local ao buscar nas integrações."""

    name: str
    platform: str | None = None
    igdb_platform_id: int | None = None
    rawg_platform_id: int | None = None
    metacritic_platform: str | None = None
    hltb_platform: str | None = None
    year: int | None = None
    canonical_name: str | None = None
    alt_names: list[str] = []
    hints: dict[str, str] = {}

    def queries(self) -> list[str]:
        names = [self.name]
        if self.canonical_name and self.canonical_name.casefold() != self.name.casefold():
            names.insert(0, self.canonical_name)
        return names


class Provider(Protocol):
    name: str

    @property
    def enabled(self) -> bool: ...

    async def search(self, query: str, ctx: MatchContext) -> list[Candidate]: ...

    async def fetch(self, external_id: str, ctx: MatchContext, hint: Candidate | None = None) -> MetadataPatch: ...
