// Espelho manual de backend/app/schemas.py. Datas chegam como string ISO
// (date: "2026-10-23"; datetime: "2026-10-23T12:00:00", em UTC e sem "Z").

export type Status = "backlog" | "playing" | "done" | "dropped" | "hype" | "owned";
export type Priority = "Alta" | "Media" | "Baixa";
export type ProviderName = "igdb" | "rawg" | "hltb" | "metacritic";
export type SearchProvider = "igdb" | "rawg";
export type StoreName = "steam" | "epic" | "gog";
export type LinkStatus = "matched" | "confirmed" | "ambiguous" | "not_found" | "error" | "ignored";
export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export type ImportMode = "novos" | "atualizar" | "substituir";

// ---------- catálogos ----------

export interface Platform {
  id: number;
  name: string;
  sort_order: number;
  igdb_platform_id: number | null;
  rawg_platform_id: number | null;
  metacritic_name: string | null;
  hltb_name: string | null;
  game_count: number;
}

export interface PlatformIn {
  name: string;
  igdb_platform_id?: number | null;
  rawg_platform_id?: number | null;
  metacritic_name?: string | null;
  hltb_name?: string | null;
}

export type PlatformPatch = Partial<PlatformIn>;

export interface Genre {
  id: number;
  name: string;
}

export interface Store {
  id: number;
  name: string;
}

export interface Device {
  id: number;
  name: string;
  kind: string;
  platform_ids: number[];
}

export interface DeviceIn {
  name: string;
  kind: string;
  platform_ids: number[];
}

export type DevicePatch = Partial<DeviceIn>;

export interface ProvidersStatus {
  igdb: boolean;
  rawg: boolean;
  hltb: boolean;
  metacritic: boolean;
}

export interface Meta {
  statuses: Record<Status, string>;
  statuses_singular: Record<Status, string>;
  priorities: Record<Priority, string>;
  device_kinds: string[];
  providers: ProvidersStatus;
  /** Loja -> dá para conectar contas (a Steam precisa da chave cadastrada em Configurações). */
  stores: Record<StoreName, boolean>;
  library_sync_hour: number;
}

// ---------- jogos ----------

export interface GameCard {
  id: number;
  name: string;
  platform_id: number;
  platform: string;
  genre_id: number | null;
  genre: string | null;
  status: Status;
  priority: Priority | null;
  hltb_main_hours: number | null;
  played_hours: number | null;
  user_score: number | null;
  metacritic_score: number | null;
  times_completed: number | null;
  finished_at: string | null;
  finished_label: string | null;
  release_date: string | null;
  created_at: string;
  cover: string | null;
  hltb_extra_hours: number | null;
  hltb_complete_hours: number | null;
  metacritic_user_score: number | null;
  tags: string[];
  developer: string | null;
  publisher: string | null;
  stores: string[];
  /** Contas de loja que têm o jogo. */
  account_ids: number[];
  /** O mais recente entre as contas. */
  last_played_at: string | null;
  enriched: boolean;
  /** Fora dos status; só aparece em "Ocultos". */
  hidden: boolean;
}

export interface Comment {
  id: number;
  body: string;
  created_at: string;
  updated_at: string | null;
}

export interface MediaItem {
  id: number;
  kind: "screenshot" | "video" | "artwork" | string;
  url: string;
  src: string;
  thumb: string;
  provider: string;
  provider_ref: string | null;
  title: string | null;
  position: number;
}

export interface StoreReview {
  id: number;
  source: string;
  outlet: string | null;
  author: string | null;
  score_display: string | null;
  score_norm: number | null;
  text: string | null;
  url: string | null;
  review_date: string | null;
  provider: string;
}

export interface LinkCandidate {
  external_id: string;
  name: string;
  year: number | null;
  platforms: string[];
  cover_thumb: string | null;
  url: string | null;
  score: number;
}

export interface ExternalLink {
  provider: ProviderName | string;
  external_id: string | null;
  external_url: string | null;
  matched_name: string | null;
  match_score: number | null;
  status: LinkStatus;
  candidates: LinkCandidate[];
  last_synced_at: string | null;
  last_error: string | null;
}

export interface Ownership {
  account_id: number;
  store: StoreName;
  nickname: string;
  external_id: string;
  name: string;
  playtime_hours: number | null;
  last_played_at: string | null;
  url: string | null;
}

export interface Duplicate {
  id: number;
  name: string;
  status: Status;
  platform: string;
}

export interface GameDetail extends GameCard {
  review_text: string | null;
  story_summary: string | null;
  description: string | null;
  storyline: string | null;
  background: string | null;
  cover_url: string | null;
  background_url: string | null;
  metacritic_url: string | null;
  metacritic_source: string | null;
  origin: string;
  /** null: legado · "store": soma das contas · "user": digitado. */
  played_hours_source: "store" | "user" | null;
  locked_fields: string[];
  comments: Comment[];
  media: MediaItem[];
  store_reviews: StoreReview[];
  links: ExternalLink[];
  ownerships: Ownership[];
  /** Parecem o mesmo jogo: sugestão de mesclar. */
  duplicates: Duplicate[];
  updated_at: string;
  last_enriched_at: string | null;
}

export interface LinkRef {
  provider: SearchProvider;
  external_id: string;
}

export interface GameCreate {
  name: string;
  platform_id: number;
  genre_id?: number | null;
  status?: Status;
  priority?: Priority | null;
  hltb_main_hours?: number | null;
  metacritic_score?: number | null;
  release_date?: string | null;
  description?: string | null;
  cover_url?: string | null;
  video_url?: string | null;
  screenshots?: string[];
  stores?: string[];
  link?: LinkRef | null;
}

export interface GamePatch {
  name?: string;
  platform_id?: number;
  genre_id?: number | null;
  status?: Status;
  priority?: Priority | null;
  hidden?: boolean;
  hltb_main_hours?: number | null;
  hltb_extra_hours?: number | null;
  hltb_complete_hours?: number | null;
  played_hours?: number | null;
  user_score?: number | null;
  review_text?: string | null;
  story_summary?: string | null;
  times_completed?: number | null;
  finished_at?: string | null;
  finished_label?: string | null;
  release_date?: string | null;
  description?: string | null;
  storyline?: string | null;
  cover_url?: string | null;
  background_url?: string | null;
  metacritic_score?: number | null;
  metacritic_user_score?: number | null;
  metacritic_url?: string | null;
  developer?: string | null;
  publisher?: string | null;
  tags?: string[] | null;
  stores?: string[] | null;
  unlock?: string[];
}

export interface MediaIn {
  kind: "screenshot" | "video" | "artwork";
  url: string;
  title?: string | null;
}

// ---------- integrações e jobs ----------

export interface Candidate {
  provider: string;
  external_id: string;
  name: string;
  year: number | null;
  platforms: string[];
  cover_thumb: string | null;
  kind: string | null;
  score: number;
  url: string | null;
  genres: string[];
  suggested_genre: string | null;
  in_library: number[];
  /** Plataformas cadastradas em que o candidato roda (calculado no backend). */
  local_platform_ids: number[];
}

export interface RefreshIn {
  providers?: ProviderName[] | null;
  force?: boolean;
  rematch?: boolean;
}

export interface EnrichIn {
  scope?: "missing" | "stale" | "all";
  game_ids?: number[] | null;
  providers?: ProviderName[] | null;
  force?: boolean;
}

export interface Job {
  id: number;
  kind: string;
  status: JobStatus;
  priority: number;
  params: Record<string, unknown>;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  log: string[];
}

/** Jogo com alguma integração pendente, com todas as integrações dele. */
export interface PendingGame {
  game_id: number;
  name: string;
  platform_id: number;
  platform: string;
  release_date: string | null;
  cover: string | null;
  links: ExternalLink[];
}

// ---------- import / export ----------

export interface ImportPreviewRow {
  action: "criar" | "atualizar" | "ignorar";
  name: string;
  platform: string;
  status: Status;
  priority: Priority | null;
  genre: string | null;
  hltb_hours: number | null;
  played_hours: number | null;
  user_score: number | null;
  date: string | null;
  stores: string[];
}

export interface ImportReport {
  created: number;
  updated: number;
  skipped: number;
  warnings: string[];
  new_genres: string[];
  rows: ImportPreviewRow[];
}

export interface SheetInfo {
  name: string;
  headers: string[];
  sample: string[][];
  row_count: number;
  mapping: Record<string, number>;
  status_hint: Status | null;
}

export interface SheetPreview {
  token: string;
  filename: string;
  fields: Record<string, string>;
  sheets: SheetInfo[];
}

export interface SheetChoice {
  name: string;
  include: boolean;
  mapping: Record<string, number>;
  status_override: Status | null;
}

export interface SheetCommit {
  token: string;
  sheets: SheetChoice[];
  mode: ImportMode;
  dry_run: boolean;
}

// ---------- usuários e login ----------

export interface User {
  id: number;
  username: string;
  display_name: string;
  is_admin: boolean;
  /** A lista de jogos aparece em /<username> para qualquer um. */
  public_page: boolean;
}

export interface ProfilePatch {
  username?: string;
  display_name?: string;
  public_page?: boolean;
}

export interface UserAdmin extends User {
  created_at: string;
  last_login_at: string | null;
  game_count: number;
}

export interface AuthMe {
  auth_enabled: boolean;
  signup_allowed: boolean;
  needs_setup: boolean;
  user: User | null;
}

export interface LoginIn {
  username: string;
  password: string;
}

export interface SignupIn extends LoginIn {
  display_name?: string | null;
}

export interface UserCreate extends SignupIn {
  is_admin?: boolean;
}

export interface UserPatch {
  display_name?: string;
  is_admin?: boolean;
}

// ---------- contas de loja ----------

export type AccountStatus = "never" | "ok" | "error" | "reauth";

export interface Account {
  id: number;
  store: StoreName;
  nickname: string;
  external_user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_url: string | null;
  enabled: boolean;
  status: AccountStatus;
  last_sync_at: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
  created_at: string;
  game_count: number;
  ignored_count: number;
}

export interface AccountCreate {
  store: StoreName;
  nickname: string;
  /** Steam: URL do perfil ou ID. Epic/GOG: código, URL ou JSON colado depois do login. */
  ref: string;
}

export interface AccountPatch {
  nickname?: string;
  enabled?: boolean;
}

// ---------- configurações do servidor ----------

export type ApiKeyName = "igdb_client_id" | "igdb_client_secret" | "rawg_api_key" | "metacritic_api_key" | "steam_api_key";

export interface ApiKeyState {
  configured: boolean;
  /** Só o fim da chave ("••••1a2b"); a chave inteira nunca volta do servidor. */
  preview: string | null;
}

export type ApiKeys = Record<ApiKeyName, ApiKeyState>;
/** Campo ausente fica como está; "" apaga. */
export type ApiKeysPatch = Partial<Record<ApiKeyName, string>>;
export type KeyTestProvider = "igdb" | "rawg" | "steam";

export interface KeyTestResult {
  ok: boolean;
  message: string;
}

// ---------- listas ----------

export interface GameList {
  id: number;
  name: string;
  description: string | null;
  /** Ranqueada: a posição é um ranking (#1, #2…). */
  ranked: boolean;
  /** Aparece na página pública. */
  public: boolean;
  /** Na ordem da lista; os cards vêm de GET /api/games. */
  game_ids: number[];
  created_at: string;
  updated_at: string;
}

export interface GameListCreate {
  name: string;
  description?: string | null;
  ranked?: boolean;
  public?: boolean;
}

export type GameListPatch = Partial<GameListCreate>;

// ---------- página pública ----------

export interface PublicGameCard {
  id: number;
  name: string;
  platform: string;
  genre: string | null;
  status: Status;
  user_score: number | null;
  metacritic_score: number | null;
  hltb_main_hours: number | null;
  played_hours: number | null;
  times_completed: number | null;
  finished_at: string | null;
  finished_label: string | null;
  release_date: string | null;
  cover: string | null;
  tags: string[];
}

export interface PublicList {
  id: number;
  name: string;
  description: string | null;
  ranked: boolean;
  /** Só os que estão em `games` (sem os ocultos). */
  game_ids: number[];
}

export interface PublicProfile {
  username: string;
  display_name: string;
  games: PublicGameCard[];
  lists: PublicList[];
}
