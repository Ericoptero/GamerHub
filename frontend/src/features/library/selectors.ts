// Contagens e estatísticas da biblioteca (sidebar e "Meus consoles"). Filtro e ordenação ficam em filters.ts.
import type { Device, GameCard, Status } from "../../api/types";
import { STATUS_ORDER } from "../../lib/constants";

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
  /** Quantos jogos têm HLTB (os outros não entram na soma). */
  withHltb: number;
  played: string;
  high: number;
  avg: string;
  scored: number;
}

/** Números da sidebar sobre a lista que está na tela (aba, filtros e busca), de qualquer status. */
export function libraryStats(games: GameCard[]): LibraryStats {
  const withHltb = games.filter((g) => g.hltb_main_hours);
  const scored = games.filter((g) => g.user_score !== null);
  const sum = (xs: (number | null)[]) => xs.reduce<number>((a, x) => a + (x || 0), 0);
  return {
    hours: Math.round(sum(withHltb.map((g) => g.hltb_main_hours))).toLocaleString("pt-BR") + "h",
    withHltb: withHltb.length,
    played: Math.round(sum(games.map((g) => g.played_hours))).toLocaleString("pt-BR") + "h",
    high: games.filter((g) => g.priority === "Alta").length,
    avg: scored.length
      ? (sum(scored.map((g) => g.user_score)) / scored.length).toFixed(1).replace(".", ",")
      : "—",
    scored: scored.length,
  };
}
