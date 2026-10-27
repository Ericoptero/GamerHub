// Listas criadas pelo usuário: os jogos na ordem da lista, o progresso pelo status de cada um, as capas
// do card da lista e a reordenação. Tudo puro: as telas só juntam com os dados da API.
import type { GameCard, GameList } from "../../api/types";
import { comparator, SORTS, type SortDir, type SortKey } from "../library/filters";

/** Os jogos de `ids` na ordem da lista; um id que sumiu (jogo apagado, cache velho) é ignorado. */
export function resolveGames<T extends { id: number }>(ids: number[], byId: Map<number, T>): T[] {
  return ids.map((id) => byId.get(id)).filter((g): g is T => !!g);
}

export interface Progress {
  total: number;
  done: number;
  playing: number;
  dropped: number;
  /** Nem começados: lista de espera, hype e biblioteca. */
  left: number;
  /** Finalizados ÷ total, em %. */
  pct: number;
  /** HLTB principal do que falta terminar (jogando e nem começados). */
  hoursLeft: number;
}

export function listProgress(games: Pick<GameCard, "status" | "hltb_main_hours">[]): Progress {
  const p: Progress = { total: games.length, done: 0, playing: 0, dropped: 0, left: 0, pct: 0, hoursLeft: 0 };
  for (const g of games) {
    if (g.status === "done") p.done += 1;
    else if (g.status === "dropped") p.dropped += 1;
    else {
      if (g.status === "playing") p.playing += 1;
      else p.left += 1;
      p.hoursLeft += g.hltb_main_hours ?? 0;
    }
  }
  p.pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  return p;
}

/** As capas do card da lista: as primeiras da lista, com as que têm imagem na frente. */
export function mosaic<T extends { cover: string | null }>(games: T[], n = 5): T[] {
  return [...games.filter((g) => g.cover), ...games.filter((g) => !g.cover)].slice(0, n);
}

/** Tira o item de `from` e põe em `to` (posições depois de tirar). */
export function moveItem<T>(xs: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= xs.length) return xs;
  const out = [...xs];
  const [item] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(to, out.length)), 0, item);
  return out;
}

/** "manual" é a ordem da lista (crescente) ou ela de trás para frente. */
export type ListSort = "manual" | SortKey;

export const LIST_SORTS: Record<ListSort, { label: string; dir: SortDir }> = {
  manual: { label: "Ordem da lista", dir: "asc" },
  ...SORTS,
};

export function sortListGames(games: GameCard[], sort: ListSort, dir: SortDir): GameCard[] {
  if (sort === "manual") return dir === "asc" ? games : [...games].reverse();
  return [...games].sort(comparator(sort, dir));
}

/** Posição de cada jogo na lista (1, 2, 3…), para o #N das listas ranqueadas. */
export function ranks(ids: number[]): Map<number, number> {
  return new Map(ids.map((id, i) => [id, i + 1]));
}

/** As listas em que o jogo está, na ordem em que a API manda (recentes primeiro). */
export function listsWithGame(lists: GameList[], gameId: number): GameList[] {
  return lists.filter((l) => l.game_ids.includes(gameId));
}
