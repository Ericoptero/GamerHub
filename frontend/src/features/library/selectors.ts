// Porte da parte "biblioteca" do renderVals() do protótipo: filtros, ordenação, contagens e stats.
import type { Device, GameCard, Priority, Status } from "../../api/types";
import { PRIO, STATUS_ORDER } from "../../lib/constants";
import { fold } from "../../lib/text";

export type SortKey = "prio" | "short" | "name" | "score" | "mc" | "date";

export const SORT_LABEL: Record<SortKey, string> = {
  prio: "Prioridade",
  short: "Mais curtos (HLTB)",
  name: "Nome",
  score: "Sua nota",
  mc: "Metacritic",
  date: "Mais recentes",
};

export interface LibraryFilters {
  tab: Status;
  q: string;
  platform: string;
  deviceId: number | null;
  priority: Priority | "";
  sort: SortKey;
}

export const defaultSort = (tab: Status): SortKey => (tab === "backlog" ? "prio" : "date");

const num = (v: number | null | undefined, d: number) => (v === null || v === undefined ? d : v);
const byName = (a: GameCard, b: GameCard) => a.name.localeCompare(b.name, "pt-BR");

/** Data usada em "Mais recentes": finalização, lançamento (hype) ou quando entrou na biblioteca. */
export function dateKey(g: GameCard): string {
  if (g.status === "hype") return g.release_date ?? "";
  if (g.status === "done" || g.status === "dropped") return g.finished_at ?? "";
  return g.created_at ?? "";
}

export const comparators: Record<SortKey, (a: GameCard, b: GameCard) => number> = {
  prio: (a, b) => num(a.priority ? PRIO[a.priority] : null, 3) - num(b.priority ? PRIO[b.priority] : null, 3) || byName(a, b),
  short: (a, b) => num(a.hltb_main_hours || a.played_hours, 1e9) - num(b.hltb_main_hours || b.played_hours, 1e9) || byName(a, b),
  name: byName,
  score: (a, b) => num(b.user_score, -1) - num(a.user_score, -1) || byName(a, b),
  mc: (a, b) => num(b.metacritic_score, -1) - num(a.metacritic_score, -1) || byName(a, b),
  date: (a, b) => dateKey(b).localeCompare(dateKey(a)) || byName(a, b),
};

export function inTab(games: GameCard[], tab: Status): GameCard[] {
  return games.filter((g) => g.status === tab);
}

export function filterGames(games: GameCard[], devices: Device[], f: LibraryFilters): GameCard[] {
  const q = fold(f.q);
  const device = f.deviceId !== null ? devices.find((d) => d.id === f.deviceId) : undefined;
  const list = inTab(games, f.tab).filter(
    (g) =>
      (!q || fold(g.name).includes(q)) &&
      (!f.platform || g.platform === f.platform) &&
      (!device || device.platform_ids.includes(g.platform_id)) &&
      (f.tab !== "backlog" || !f.priority || g.priority === f.priority),
  );
  return list.sort(comparators[f.sort]);
}

export function statusCounts(games: GameCard[]): Record<Status, number> {
  const out = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<Status, number>;
  for (const g of games) out[g.status] += 1;
  return out;
}

/** Quantos jogos da lista atual cada aparelho roda (para a sidebar "Jogável em"). */
export function deviceCounts(tabGames: GameCard[], devices: Device[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const d of devices) {
    const plats = new Set(d.platform_ids);
    out.set(d.id, tabGames.filter((g) => plats.has(g.platform_id)).length);
  }
  return out;
}

/** Jogos da fila jogáveis num aparelho (cards de "Meus consoles"). */
export function playableInQueue(games: GameCard[], device: Device): number {
  const plats = new Set(device.platform_ids);
  return games.filter((g) => g.status === "backlog" && plats.has(g.platform_id)).length;
}

export interface LibraryStats {
  hours: string;
  played: string;
  high: number;
  avg: string;
}

export function libraryStats(games: GameCard[]): LibraryStats {
  const queue = games.filter((g) => g.status === "backlog");
  const done = games.filter((g) => g.status === "done");
  const scored = done.filter((g) => g.user_score !== null);
  const sum = (xs: (number | null)[]) => xs.reduce<number>((a, x) => a + (x || 0), 0);
  return {
    hours: Math.round(sum(queue.map((g) => g.hltb_main_hours))).toLocaleString("pt-BR") + "h",
    played: Math.round(sum(done.map((g) => g.played_hours))).toLocaleString("pt-BR") + "h",
    high: queue.filter((g) => g.priority === "Alta").length,
    avg: scored.length
      ? (sum(scored.map((g) => g.user_score)) / scored.length).toFixed(1).replace(".", ",")
      : "—",
  };
}

export function platformOptions(tabGames: GameCard[]): string[] {
  return Array.from(new Set(tabGames.map((g) => g.platform))).sort((a, b) => a.localeCompare(b, "pt-BR"));
}
