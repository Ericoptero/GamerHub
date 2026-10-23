"""DTOs da API. Os tipos do frontend (frontend/src/api/types.ts) espelham este arquivo."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Status = Literal["backlog", "playing", "done", "dropped", "hype"]
Priority = Literal["Alta", "Media", "Baixa"]
ProviderName = Literal["igdb", "rawg", "hltb", "metacritic"]
SearchProvider = Literal["igdb", "rawg"]


class Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- catálogos ----------


class PlatformOut(Out):
    id: int
    name: str
    sort_order: int
    igdb_platform_id: int | None
    rawg_platform_id: int | None
    metacritic_name: str | None
    hltb_name: str | None
    game_count: int = 0


class PlatformIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    igdb_platform_id: int | None = None
    rawg_platform_id: int | None = None
    metacritic_name: str | None = None
    hltb_name: str | None = None


class PlatformPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    igdb_platform_id: int | None = None
    rawg_platform_id: int | None = None
    metacritic_name: str | None = None
    hltb_name: str | None = None


class GenreOut(Out):
    id: int
    name: str


class StoreOut(Out):
    id: int
    name: str


class StoreIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class DeviceOut(Out):
    id: int
    name: str
    kind: str
    platform_ids: list[int]


class DeviceIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: str
    platform_ids: list[int] = []


class DevicePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    kind: str | None = None
    platform_ids: list[int] | None = None


class ProvidersStatus(BaseModel):
    igdb: bool
    rawg: bool
    hltb: bool
    metacritic: bool


class Meta(BaseModel):
    statuses: dict[str, str]
    statuses_singular: dict[str, str]
    priorities: dict[str, str]
    device_kinds: list[str]
    providers: ProvidersStatus


# ---------- jogos ----------


class GameCard(Out):
    id: int
    name: str
    platform_id: int
    platform: str
    genre_id: int | None
    genre: str | None
    status: Status
    priority: Priority | None
    hltb_main_hours: float | None
    played_hours: float | None
    user_score: int | None
    metacritic_score: int | None
    times_completed: int | None
    finished_at: date | None
    finished_label: str | None
    release_date: date | None
    created_at: datetime
    cover: str | None


class CommentOut(Out):
    id: int
    body: str
    created_at: datetime
    updated_at: datetime | None


class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=10000)


class MediaOut(Out):
    id: int
    kind: str
    url: str
    src: str
    thumb: str
    provider: str
    provider_ref: str | None
    title: str | None
    position: int


class MediaIn(BaseModel):
    kind: Literal["screenshot", "video", "artwork"]
    url: str = Field(min_length=8, max_length=1000)
    title: str | None = None


class StoreReviewOut(Out):
    id: int
    source: str
    outlet: str | None
    author: str | None
    score_display: str | None
    score_norm: int | None
    text: str | None
    url: str | None
    review_date: date | None
    provider: str


class LinkOut(Out):
    provider: str
    external_id: str | None
    external_url: str | None
    matched_name: str | None
    match_score: float | None
    status: str
    candidates: list[dict]
    last_synced_at: datetime | None
    last_error: str | None


class GameDetail(GameCard):
    hltb_extra_hours: float | None
    hltb_complete_hours: float | None
    review_text: str | None
    story_summary: str | None
    description: str | None
    storyline: str | None
    background: str | None
    cover_url: str | None
    background_url: str | None
    metacritic_user_score: float | None
    metacritic_url: str | None
    metacritic_source: str | None
    tags: list[str]
    developer: str | None
    publisher: str | None
    origin: str
    locked_fields: list[str]
    stores: list[str]
    comments: list[CommentOut]
    media: list[MediaOut]
    store_reviews: list[StoreReviewOut]
    links: list[LinkOut]
    updated_at: datetime
    last_enriched_at: datetime | None


class LinkRef(BaseModel):
    provider: SearchProvider
    external_id: str


class GameCreate(BaseModel):
    name: str = Field(min_length=1, max_length=300)
    platform_id: int
    genre_id: int | None = None
    status: Status = "backlog"
    priority: Priority | None = None
    hltb_main_hours: float | None = Field(default=None, ge=0)
    metacritic_score: int | None = Field(default=None, ge=0, le=100)
    release_date: date | None = None
    description: str | None = None
    cover_url: str | None = None
    video_url: str | None = None
    screenshots: list[str] = []
    stores: list[str] = []
    link: LinkRef | None = None


class GamePatch(BaseModel):
    """Só os campos enviados são alterados. Editar um campo de metadado o trava contra a integração."""

    name: str | None = Field(default=None, min_length=1, max_length=300)
    platform_id: int | None = None
    genre_id: int | None = None
    status: Status | None = None
    priority: Priority | None = None
    hltb_main_hours: float | None = Field(default=None, ge=0)
    hltb_extra_hours: float | None = Field(default=None, ge=0)
    hltb_complete_hours: float | None = Field(default=None, ge=0)
    played_hours: float | None = Field(default=None, ge=0)
    user_score: int | None = Field(default=None, ge=1, le=10)
    review_text: str | None = None
    story_summary: str | None = None
    times_completed: int | None = Field(default=None, ge=0)
    finished_at: date | None = None
    finished_label: str | None = None
    release_date: date | None = None
    description: str | None = None
    storyline: str | None = None
    cover_url: str | None = None
    background_url: str | None = None
    metacritic_score: int | None = Field(default=None, ge=0, le=100)
    metacritic_user_score: float | None = Field(default=None, ge=0, le=10)
    metacritic_url: str | None = None
    developer: str | None = None
    publisher: str | None = None
    tags: list[str] | None = None
    stores: list[str] | None = None
    unlock: list[str] = []


# ---------- integrações e jobs ----------


class CandidateOut(BaseModel):
    provider: str
    external_id: str
    name: str
    year: int | None
    platforms: list[str]
    cover_thumb: str | None
    kind: str | None
    score: float
    genres: list[str] = []
    suggested_genre: str | None = None
    in_library: list[int] = []
    local_platform_ids: list[int] = []  # plataformas cadastradas em que o candidato roda


class RefreshIn(BaseModel):
    providers: list[ProviderName] | None = None
    force: bool = True
    rematch: bool = False


class EnrichIn(BaseModel):
    scope: Literal["missing", "stale", "all"] = "missing"
    game_ids: list[int] | None = None
    providers: list[ProviderName] | None = None
    force: bool = False


class LinkConfirmIn(BaseModel):
    external_id: str


class JobOut(Out):
    id: int
    kind: str
    status: str
    priority: int
    params: dict
    total: int
    processed: int
    succeeded: int
    failed: int
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    error: str | None
    log: list[str]


class PendingLinkOut(BaseModel):
    game_id: int
    game_name: str
    platform: str
    provider: str
    status: str
    matched_name: str | None
    match_score: float | None
    candidates: list[dict]
    last_error: str | None
