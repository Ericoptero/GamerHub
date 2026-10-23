// Filtros e ordenação da biblioteca. Tudo vive na URL (dá para salvar nos favoritos e compartilhar)
// e é puro: a página só lê os parâmetros, filtra e ordena aqui.
import type { Account, Device, GameCard, Priority, Status } from "../../api/types";
import { PRIO, PRIORITIES, STATUS_ORDER, STORE_LABEL } from "../../lib/constants";
import { fold } from "../../lib/text";

export type Tab = Status | "all";
export const TAB_ORDER: Tab[] = [...STATUS_ORDER, "all"];

export type SortKey =
  | "prio"
  | "name"
  | "score"
  | "mc"
  | "mcu"
  | "short"
  | "hltbx"
  | "hltbc"
  | "played"
  | "value"
  | "date"
  | "release"
  | "added"
  | "finished"
  | "lastplayed";
export type SortDir = "asc" | "desc";

/** Rótulo e direção natural de cada ordenação (o usuário pode inverter). */
export const SORTS: Record<SortKey, { label: string; dir: SortDir }> = {
  prio: { label: "Prioridade", dir: "asc" },
  name: { label: "Nome", dir: "asc" },
  score: { label: "Sua nota", dir: "desc" },
  mc: { label: "Metacritic (crítica)", dir: "desc" },
  mcu: { label: "Metacritic (usuários)", dir: "desc" },
  short: { label: "HLTB principal", dir: "asc" },
  hltbx: { label: "HLTB + extras", dir: "asc" },
  hltbc: { label: "HLTB 100%", dir: "asc" },
  played: { label: "Horas jogadas", dir: "desc" },
  value: { label: "Nota por hora (MC ÷ HLTB)", dir: "desc" },
  date: { label: "Mais recentes", dir: "desc" },
  release: { label: "Lançamento", dir: "desc" },
  added: { label: "Adicionado em", dir: "desc" },
  finished: { label: "Finalizado em", dir: "desc" },
  lastplayed: { label: "Jogado por último", dir: "desc" },
};

export interface Range {
  min: number | null;
  max: number | null;
}

export type RangeKey = "mc" | "mcu" | "score" | "hltb" | "played" | "year";

export const RANGES: Record<
  RangeKey,
  { label: string; param: string; unit?: string; step: number; get: (g: GameCard) => number | null }
> = {
  mc: { label: "Metacritic (crítica)", param: "mc", step: 1, get: (g) => g.metacritic_score },
  mcu: { label: "Metacritic (usuários)", param: "mcu", step: 0.1, get: (g) => g.metacritic_user_score },
  score: { label: "Sua nota", param: "nota", step: 1, get: (g) => g.user_score },
  hltb: { label: "HLTB principal", param: "hltb", unit: "h", step: 1, get: (g) => g.hltb_main_hours },
  played: { label: "Horas jogadas", param: "jogadas", unit: "h", step: 1, get: (g) => g.played_hours },
  year: {
    label: "Ano de lançamento",
    param: "ano",
    step: 1,
    get: (g) => (g.release_date ? Number(g.release_date.slice(0, 4)) : null),
  },
};
export const RANGE_KEYS = Object.keys(RANGES) as RangeKey[];

export interface Filters {
  tab: Tab;
  q: string;
  platforms: string[];
  devices: number[];
  genres: number[];
  stores: string[];
  accounts: number[];
  tags: string[];
  priorities: Priority[];
  company: string;
  ranges: Record<RangeKey, Range>;
  /** Nas faixas, manter os jogos que não têm o dado (sem Metacritic, sem HLTB…). */
  unknown: boolean;
  neverPlayed: boolean;
  noMeta: boolean;
  multi: boolean;
  sort: SortKey;
  dir: SortDir;
}

const EMPTY_RANGE: Range = { min: null, max: null };

export function defaultSort(tab: Tab): SortKey {
  if (tab === "backlog") return "prio";
  if (tab === "owned") return "mc";
  if (tab === "all") return "name";
  return "date";
}

export function emptyFilters(tab: Tab = "backlog"): Filters {
  return {
    tab,
    q: "",
    platforms: [],
    devices: [],
    genres: [],
    stores: [],
    accounts: [],
    tags: [],
    priorities: [],
    company: "",
    ranges: Object.fromEntries(RANGE_KEYS.map((k) => [k, EMPTY_RANGE])) as Record<RangeKey, Range>,
    unknown: false,
    neverPlayed: false,
    noMeta: false,
    multi: false,
    sort: defaultSort(tab),
    dir: SORTS[defaultSort(tab)].dir,
  };
}

// ---------- URL ----------

const TAB_PARAM: Partial<Record<Tab, string>> = { all: "todos" };
const ids = (xs: string[]) => xs.map(Number).filter((n) => Number.isInteger(n) && n > 0);
const num = (s: string) =>
  s.trim() === "" ? null : Number.isFinite(Number(s.replace(",", "."))) ? Number(s.replace(",", ".")) : null;

function parseRange(raw: string | null): Range {
  if (!raw) return EMPTY_RANGE;
  const [a = "", b = ""] = raw.split("-");
  return { min: num(a), max: num(b) };
}

function formatRange(r: Range): string | null {
  if (r.min === null && r.max === null) return null;
  return `${r.min ?? ""}-${r.max ?? ""}`;
}

/** Listas são parâmetros repetidos (?plataforma=PC&plataforma=GBA): nomes podem ter vírgula. */
export function parseFilters(sp: URLSearchParams): Filters {
  const rawTab = sp.get("lista");
  const tab = (TAB_ORDER.find((t) => (TAB_PARAM[t] ?? t) === rawTab) ?? "backlog") as Tab;
  const f = emptyFilters(tab);
  const ordem = sp.get("ordem") as SortKey | null;
  const sort = ordem && ordem in SORTS ? ordem : defaultSort(tab);
  const dir = sp.get("dir");
  return {
    ...f,
    q: sp.get("q") ?? "",
    platforms: sp.getAll("plataforma").filter(Boolean),
    devices: ids(sp.getAll("aparelho")),
    genres: ids(sp.getAll("genero")),
    stores: sp.getAll("loja").filter(Boolean),
    accounts: ids(sp.getAll("conta")),
    tags: sp.getAll("tag").filter(Boolean),
    priorities: sp.getAll("prio").filter((p): p is Priority => (PRIORITIES as string[]).includes(p)),
    company: sp.get("empresa") ?? "",
    ranges: Object.fromEntries(RANGE_KEYS.map((k) => [k, parseRange(sp.get(RANGES[k].param))])) as Record<
      RangeKey,
      Range
    >,
    unknown: sp.get("semdado") === "1",
    neverPlayed: sp.get("nunca") === "1",
    noMeta: sp.get("semmeta") === "1",
    multi: sp.get("multi") === "1",
    sort,
    dir: dir === "asc" || dir === "desc" ? dir : SORTS[sort].dir,
  };
}

export function serializeFilters(f: Filters): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.tab !== "backlog") sp.set("lista", TAB_PARAM[f.tab] ?? f.tab);
  if (f.q) sp.set("q", f.q);
  for (const p of f.platforms) sp.append("plataforma", p);
  for (const d of f.devices) sp.append("aparelho", String(d));
  for (const g of f.genres) sp.append("genero", String(g));
  for (const s of f.stores) sp.append("loja", s);
  for (const a of f.accounts) sp.append("conta", String(a));
  for (const t of f.tags) sp.append("tag", t);
  for (const p of f.priorities) sp.append("prio", p);
  if (f.company) sp.set("empresa", f.company);
  for (const k of RANGE_KEYS) {
    const v = formatRange(f.ranges[k]);
    if (v) sp.set(RANGES[k].param, v);
  }
  if (f.unknown) sp.set("semdado", "1");
  if (f.neverPlayed) sp.set("nunca", "1");
  if (f.noMeta) sp.set("semmeta", "1");
  if (f.multi) sp.set("multi", "1");
  if (f.sort !== defaultSort(f.tab)) sp.set("ordem", f.sort);
  if (f.dir !== SORTS[f.sort].dir) sp.set("dir", f.dir);
  return sp;
}

// ---------- filtro ----------

export function inTab(games: GameCard[], tab: Tab): GameCard[] {
  return tab === "all" ? games : games.filter((g) => g.status === tab);
}

const any = <T>(selected: T[], test: (x: T) => boolean) => selected.length === 0 || selected.some(test);

function inRange(value: number | null, r: Range, unknown: boolean): boolean {
  if (r.min === null && r.max === null) return true;
  if (value === null || value === undefined) return unknown;
  return (r.min === null || value >= r.min) && (r.max === null || value <= r.max);
}

/** Dentro de um grupo vale qualquer um (OU); entre grupos, todos (E). */
export function matches(g: GameCard, f: Filters, devices: Device[]): boolean {
  if (f.tab !== "all" && g.status !== f.tab) return false;
  if (f.q && !fold(g.name).includes(fold(f.q))) return false;
  if (!any(f.platforms, (p) => p === g.platform)) return false;
  if (f.devices.length && !devices.some((d) => f.devices.includes(d.id) && d.platform_ids.includes(g.platform_id))) {
    return false;
  }
  if (!any(f.genres, (id) => id === g.genre_id)) return false;
  if (!any(f.stores, (s) => g.stores.includes(s))) return false;
  if (!any(f.accounts, (a) => g.account_ids.includes(a))) return false;
  if (!any(f.tags, (t) => g.tags.includes(t))) return false;
  if (!any(f.priorities, (p) => p === g.priority)) return false;
  if (f.company) {
    const c = fold(f.company);
    if (!fold(g.developer ?? "").includes(c) && !fold(g.publisher ?? "").includes(c)) return false;
  }
  for (const k of RANGE_KEYS) {
    if (!inRange(RANGES[k].get(g), f.ranges[k], f.unknown)) return false;
  }
  if (f.neverPlayed && g.played_hours) return false;
  if (f.noMeta && g.enriched) return false;
  if (f.multi && g.account_ids.length < 2) return false;
  return true;
}

// ---------- ordenação ----------

/** Data usada em "Mais recentes": finalização, lançamento (hype), último jogo (biblioteca) ou entrada. */
export function dateKey(g: GameCard): string {
  if (g.status === "hype") return g.release_date ?? "";
  if (g.status === "done" || g.status === "dropped") return g.finished_at ?? "";
  if (g.status === "owned") return g.last_played_at ?? g.created_at ?? "";
  return g.created_at ?? "";
}

/** Quanto de nota cada hora de jogo entrega: alto = curto e bem avaliado. */
export function valueScore(g: GameCard): number | null {
  return g.metacritic_score !== null && g.hltb_main_hours ? g.metacritic_score / g.hltb_main_hours : null;
}

const SORT_VALUE: Record<Exclude<SortKey, "name">, (g: GameCard) => number | string | null> = {
  prio: (g) => (g.priority ? PRIO[g.priority] : null),
  score: (g) => g.user_score,
  mc: (g) => g.metacritic_score,
  mcu: (g) => g.metacritic_user_score,
  short: (g) => g.hltb_main_hours || g.played_hours || null,
  hltbx: (g) => g.hltb_extra_hours,
  hltbc: (g) => g.hltb_complete_hours,
  played: (g) => g.played_hours,
  value: valueScore,
  date: (g) => dateKey(g) || null,
  release: (g) => g.release_date,
  added: (g) => g.created_at,
  finished: (g) => g.finished_at,
  lastplayed: (g) => g.last_played_at,
};

const byName = (a: GameCard, b: GameCard) => a.name.localeCompare(b.name, "pt-BR");

/** Sem o dado vai sempre para o fim, nas duas direções; empate desempata pelo nome. */
export function comparator(sort: SortKey, dir: SortDir = SORTS[sort].dir) {
  const sign = dir === "asc" ? 1 : -1;
  if (sort === "name") return (a: GameCard, b: GameCard) => sign * byName(a, b);
  const get = SORT_VALUE[sort];
  return (a: GameCard, b: GameCard) => {
    const va = get(a);
    const vb = get(b);
    if (va === null || vb === null) return va === vb ? byName(a, b) : va === null ? 1 : -1;
    const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
    return sign * cmp || byName(a, b);
  };
}

export function filterGames(games: GameCard[], devices: Device[], f: Filters): GameCard[] {
  return games.filter((g) => matches(g, f, devices)).sort(comparator(f.sort, f.dir));
}

// ---------- facetas, chips e atalhos ----------

export interface Facet<K> {
  key: K;
  label: string;
  count: number;
}

const sorted = <K>(m: Map<K, Facet<K>>, byCount = false) =>
  [...m.values()].sort((a, b) => (byCount ? b.count - a.count : 0) || a.label.localeCompare(b.label, "pt-BR"));

function bump<K>(m: Map<K, Facet<K>>, key: K, label: string) {
  const cur = m.get(key);
  if (cur) cur.count += 1;
  else m.set(key, { key, label, count: 1 });
}

export interface Facets {
  platforms: Facet<string>[];
  genres: Facet<number>[];
  stores: Facet<string>[];
  accounts: Facet<number>[];
  tags: Facet<string>[];
}

/** Opções de cada grupo com quantos jogos da aba atual têm cada uma. */
export function facets(tabGames: GameCard[], accounts: Account[]): Facets {
  const platforms = new Map<string, Facet<string>>();
  const genres = new Map<number, Facet<number>>();
  const stores = new Map<string, Facet<string>>();
  const accs = new Map<number, Facet<number>>();
  const tags = new Map<string, Facet<string>>();
  const accLabel = new Map(accounts.map((a) => [a.id, accountLabel(a)]));
  for (const g of tabGames) {
    bump(platforms, g.platform, g.platform);
    if (g.genre_id !== null) bump(genres, g.genre_id, g.genre ?? "?");
    for (const s of g.stores) bump(stores, s, s);
    for (const a of g.account_ids) bump(accs, a, accLabel.get(a) ?? `Conta ${a}`);
    for (const t of g.tags) bump(tags, t, t);
  }
  return {
    platforms: sorted(platforms),
    genres: sorted(genres),
    stores: sorted(stores),
    accounts: sorted(accs),
    tags: sorted(tags, true),
  };
}

export function accountLabel(a: Pick<Account, "store" | "nickname">): string {
  return `${STORE_LABEL[a.store] ?? a.store} · ${a.nickname}`;
}

export interface Chip {
  id: string;
  label: string;
  remove: (f: Filters) => Filters;
}

function fmtRange(r: Range, unit = ""): string {
  if (r.min !== null && r.max !== null) return `${r.min}–${r.max}${unit}`;
  if (r.min !== null) return `≥ ${r.min}${unit}`;
  return `≤ ${r.max}${unit}`;
}

/** Um chip removível por filtro ativo (fora aba, busca e ordenação). */
export function activeChips(
  f: Filters,
  names: { devices: Device[]; genres: Facet<number>[]; accounts: Account[] },
): Chip[] {
  const chips: Chip[] = [];
  const without = <T>(xs: T[], x: T) => xs.filter((y) => y !== x);
  for (const p of f.platforms)
    chips.push({ id: `p:${p}`, label: p, remove: (g) => ({ ...g, platforms: without(g.platforms, p) }) });
  for (const d of f.devices) {
    const name = names.devices.find((x) => x.id === d)?.name ?? `Aparelho ${d}`;
    chips.push({
      id: `d:${d}`,
      label: `Jogável em ${name}`,
      remove: (g) => ({ ...g, devices: without(g.devices, d) }),
    });
  }
  for (const id of f.genres) {
    const name = names.genres.find((x) => x.key === id)?.label ?? `Gênero ${id}`;
    chips.push({ id: `g:${id}`, label: name, remove: (g) => ({ ...g, genres: without(g.genres, id) }) });
  }
  for (const s of f.stores)
    chips.push({ id: `s:${s}`, label: `Loja: ${s}`, remove: (g) => ({ ...g, stores: without(g.stores, s) }) });
  for (const a of f.accounts) {
    const acc = names.accounts.find((x) => x.id === a);
    chips.push({
      id: `a:${a}`,
      label: acc ? accountLabel(acc) : `Conta ${a}`,
      remove: (g) => ({ ...g, accounts: without(g.accounts, a) }),
    });
  }
  for (const t of f.tags)
    chips.push({ id: `t:${t}`, label: `#${t}`, remove: (g) => ({ ...g, tags: without(g.tags, t) }) });
  for (const p of f.priorities) {
    chips.push({
      id: `pr:${p}`,
      label: `Prioridade ${p === "Media" ? "Média" : p}`,
      remove: (g) => ({ ...g, priorities: without(g.priorities, p) }),
    });
  }
  if (f.company) chips.push({ id: "co", label: `Estúdio: ${f.company}`, remove: (g) => ({ ...g, company: "" }) });
  for (const k of RANGE_KEYS) {
    const r = f.ranges[k];
    if (r.min === null && r.max === null) continue;
    chips.push({
      id: `r:${k}`,
      label: `${RANGES[k].label} ${fmtRange(r, RANGES[k].unit)}`,
      remove: (g) => ({ ...g, ranges: { ...g.ranges, [k]: EMPTY_RANGE } }),
    });
  }
  if (f.unknown) chips.push({ id: "unk", label: "Inclui sem dado", remove: (g) => ({ ...g, unknown: false }) });
  if (f.neverPlayed) chips.push({ id: "np", label: "Nunca jogado", remove: (g) => ({ ...g, neverPlayed: false }) });
  if (f.noMeta) chips.push({ id: "nm", label: "Sem metadados", remove: (g) => ({ ...g, noMeta: false }) });
  if (f.multi) chips.push({ id: "mu", label: "Em 2+ contas", remove: (g) => ({ ...g, multi: false }) });
  return chips;
}

/** Limpa os filtros mantendo aba, busca e ordenação. */
export function clearFilters(f: Filters): Filters {
  return { ...emptyFilters(f.tab), q: f.q, sort: f.sort, dir: f.dir };
}

export interface Preset {
  id: string;
  label: string;
  hint: string;
  apply: (f: Filters) => Filters;
}

export const PRESETS: Preset[] = [
  {
    id: "curtos",
    label: "Curtos e bem avaliados",
    hint: "HLTB até 10h, Metacritic 80+, pela nota por hora",
    apply: (f) => ({
      ...clearFilters(f),
      ranges: { ...emptyFilters().ranges, hltb: { min: null, max: 10 }, mc: { min: 80, max: null } },
      sort: "value",
      dir: "desc",
    }),
  },
  {
    id: "nunca",
    label: "Nunca jogados",
    hint: "Sem horas jogadas, melhores primeiro",
    apply: (f) => ({ ...clearFilters(f), neverPlayed: true, sort: "mc", dir: "desc" }),
  },
  {
    id: "semmeta",
    label: "Sem metadados",
    hint: "Ainda não passaram pelas integrações",
    apply: (f) => ({ ...clearFilters(f), noMeta: true }),
  },
];
