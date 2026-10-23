// Espelho manual de backend/app/schemas.py. Datas chegam como string ISO
// (date: "2026-10-23"; datetime: "2026-10-23T12:00:00", em UTC e sem "Z").

export type Status = "backlog" | "playing" | "done" | "dropped" | "hype";
export type Priority = "Alta" | "Media" | "Baixa";
export type ProviderName = "igdb" | "rawg" | "hltb" | "metacritic";
export type SearchProvider = "igdb" | "rawg";
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

export interface GameDetail extends GameCard {
  hltb_extra_hours: number | null;
  hltb_complete_hours: number | null;
  review_text: string | null;
  story_summary: string | null;
  description: string | null;
  storyline: string | null;
  background: string | null;
  cover_url: string | null;
  background_url: string | null;
  metacritic_user_score: number | null;
  metacritic_url: string | null;
  metacritic_source: string | null;
  tags: string[];
  developer: string | null;
  publisher: string | null;
  origin: string;
  locked_fields: string[];
  stores: string[];
  comments: Comment[];
  media: MediaItem[];
  store_reviews: StoreReview[];
  links: ExternalLink[];
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

export interface PendingLink {
  game_id: number;
  game_name: string;
  platform: string;
  provider: string;
  status: LinkStatus;
  matched_name: string | null;
  match_score: number | null;
  candidates: LinkCandidate[];
  last_error: string | null;
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
