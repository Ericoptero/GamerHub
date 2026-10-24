"""DTOs da API. Os tipos do frontend (frontend/src/api/types.ts) espelham este arquivo."""

from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

Status = Literal["backlog", "playing", "done", "dropped", "hype", "owned"]
Priority = Literal["Alta", "Media", "Baixa"]
ProviderName = Literal["igdb", "rawg", "hltb", "metacritic"]
SearchProvider = Literal["igdb", "rawg"]
StoreName = Literal["steam", "epic", "gog"]


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
    stores: dict[str, bool] = {}  # loja -> dá para conectar contas (Steam precisa de STEAM_API_KEY)
    library_sync_hour: int = 5


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
    # Para os filtros da lista.
    hltb_extra_hours: float | None = None
    hltb_complete_hours: float | None = None
    metacritic_user_score: float | None = None
    tags: list[str] = []
    developer: str | None = None
    publisher: str | None = None
    stores: list[str] = []
    account_ids: list[int] = []  # contas de loja que têm o jogo
    last_played_at: datetime | None = None  # o mais recente entre as contas
    enriched: bool = False
    hidden: bool = False


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


class OwnershipOut(BaseModel):
    account_id: int
    store: str
    nickname: str
    external_id: str
    name: str
    playtime_hours: float | None
    last_played_at: datetime | None
    url: str | None


class DuplicateOut(BaseModel):
    id: int
    name: str
    status: str
    platform: str


class GameDetail(GameCard):
    review_text: str | None
    story_summary: str | None
    description: str | None
    storyline: str | None
    background: str | None
    cover_url: str | None
    background_url: str | None
    metacritic_url: str | None
    metacritic_source: str | None
    origin: str
    played_hours_source: str | None = None
    locked_fields: list[str]
    comments: list[CommentOut]
    media: list[MediaOut]
    store_reviews: list[StoreReviewOut]
    links: list[LinkOut]
    ownerships: list[OwnershipOut] = []
    duplicates: list[DuplicateOut] = []  # parecem o mesmo jogo: sugestão de mesclar
    updated_at: datetime
    last_enriched_at: datetime | None


class MergeIn(BaseModel):
    source_id: int


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
    hidden: bool | None = None
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
    url: str | None = None
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
    # Preenchidos quando o escolhido veio de uma busca avulsa (não está entre os candidatos salvos).
    name: str | None = Field(default=None, max_length=300)
    url: str | None = Field(default=None, max_length=500)
    score: float | None = None


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


class PendingGameOut(BaseModel):
    """Jogo com alguma integração pendente e todas as integrações dele."""

    game_id: int
    name: str
    platform_id: int
    platform: str
    release_date: date | None
    cover: str | None
    links: list[LinkOut]


# ---------- usuários e login ----------

Username = Annotated[str, Field(min_length=3, max_length=40, pattern=r"^[\w.\-]+$")]
Password = Annotated[str, Field(min_length=8, max_length=200)]


class UserOut(Out):
    id: int
    username: str
    display_name: str
    is_admin: bool


class UserAdminOut(UserOut):
    created_at: datetime
    last_login_at: datetime | None
    game_count: int = 0


class AuthMe(BaseModel):
    auth_enabled: bool
    signup_allowed: bool
    needs_setup: bool  # login ligado e ninguém reivindicou o usuário principal ainda
    user: UserOut | None


class SignupIn(BaseModel):
    username: Username
    password: Password
    display_name: str | None = Field(default=None, max_length=80)


class UserCreate(SignupIn):
    is_admin: bool = False


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=40)
    password: str = Field(min_length=1, max_length=200)


class PasswordChangeIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: Password


class PasswordResetIn(BaseModel):
    password: Password


class UserPatch(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=80)
    is_admin: bool | None = None


# ---------- contas de loja ----------


class AccountOut(Out):
    id: int
    store: StoreName
    nickname: str
    external_user_id: str
    display_name: str | None
    avatar_url: str | None
    profile_url: str | None
    enabled: bool
    status: Literal["never", "ok", "error", "reauth"]
    last_sync_at: datetime | None
    last_attempt_at: datetime | None
    last_error: str | None
    created_at: datetime
    game_count: int = 0
    ignored_count: int = 0


class AccountCreate(BaseModel):
    store: StoreName
    nickname: str = Field(min_length=1, max_length=40)
    # Steam: URL do perfil ou ID. Epic/GOG: código, URL ou JSON colado depois do login.
    ref: str = Field(min_length=1, max_length=4000)


class AccountPatch(BaseModel):
    nickname: str | None = Field(default=None, min_length=1, max_length=40)
    enabled: bool | None = None


class AccountReconnect(BaseModel):
    ref: str = Field(min_length=1, max_length=4000)


class AccountSyncIn(BaseModel):
    account_ids: list[int] | None = None  # None: todas as contas ativas


class LoginUrlOut(BaseModel):
    url: str
