// Abas, busca, tags e ordenação da página pública. Tudo na URL (dá para mandar o link já filtrado) e puro.
import type { PublicGameCard, Status } from "../../api/types";
import { fold } from "../../lib/text";
import type { Facet } from "../library/filters";

export type PublicTab = Status | "all";
/** Quem visita quer ver primeiro o que a pessoa está jogando e já terminou. */
export const PUBLIC_TABS: PublicTab[] = ["playing", "done", "backlog", "hype", "dropped", "owned", "all"];

export type PublicSort = "name" | "score" | "mc" | "finished" | "release";
export const PUBLIC_SORTS: Record<PublicSort, string> = {
  name: "Nome",
  score: "Nota",
  mc: "Metacritic",
  finished: "Finalizado em",
  release: "Lançamento",
};

export interface PublicFilters {
  tab: PublicTab;
  q: string;
  tags: string[];
  sort: PublicSort;
}

const TAB_PARAM: Partial<Record<PublicTab, string>> = { all: "todos" };

export function defaultPublicSort(tab: PublicTab): PublicSort {
  return tab === "done" ? "finished" : "name";
}

export function statusCounts(games: PublicGameCard[]): Record<PublicTab, number> {
  const out = Object.fromEntries(PUBLIC_TABS.map((t) => [t, 0])) as Record<PublicTab, number>;
  for (const g of games) out[g.status] += 1;
  out.all = games.length;
  return out;
}

/** Primeira aba com jogo (uma lista vazia não é um bom cartão de visita). */
export function firstTab(counts: Record<PublicTab, number>): PublicTab {
  return PUBLIC_TABS.find((t) => counts[t] > 0) ?? "all";
}

export function parsePublicFilters(sp: URLSearchParams, fallbackTab: PublicTab): PublicFilters {
  const raw = sp.get("lista");
  const tab = PUBLIC_TABS.find((t) => (TAB_PARAM[t] ?? t) === raw) ?? fallbackTab;
  const ordem = sp.get("ordem") as PublicSort | null;
  return {
    tab,
    q: sp.get("q") ?? "",
    tags: sp.getAll("tag").filter(Boolean),
    sort: ordem && ordem in PUBLIC_SORTS ? ordem : defaultPublicSort(tab),
  };
}

export function serializePublicFilters(f: PublicFilters, fallbackTab: PublicTab): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.tab !== fallbackTab) sp.set("lista", TAB_PARAM[f.tab] ?? f.tab);
  if (f.q) sp.set("q", f.q);
  for (const t of f.tags) sp.append("tag", t);
  if (f.sort !== defaultPublicSort(f.tab)) sp.set("ordem", f.sort);
  return sp;
}

/** Jogos da aba e da busca; as tags são "qualquer uma" (como na biblioteca). */
export function inPublicTab(games: PublicGameCard[], f: Pick<PublicFilters, "tab" | "q">): PublicGameCard[] {
  const needle = fold(f.q);
  return games.filter((g) => (f.tab === "all" || g.status === f.tab) && (!needle || fold(g.name).includes(needle)));
}

export function filterPublic(games: PublicGameCard[], f: PublicFilters): PublicGameCard[] {
  const list = inPublicTab(games, f).filter((g) => !f.tags.length || f.tags.some((t) => g.tags.includes(t)));
  return list.sort(comparePublic(f.sort));
}

const byName = (a: PublicGameCard, b: PublicGameCard) => a.name.localeCompare(b.name, "pt-BR");

/** Maior primeiro; quem não tem o dado vai para o fim. */
function desc(get: (g: PublicGameCard) => number | string | null) {
  return (a: PublicGameCard, b: PublicGameCard) => {
    const x = get(a);
    const y = get(b);
    if (x === y) return byName(a, b);
    if (x === null) return 1;
    if (y === null) return -1;
    return x < y ? 1 : -1;
  };
}

export function comparePublic(sort: PublicSort): (a: PublicGameCard, b: PublicGameCard) => number {
  if (sort === "score") return desc((g) => g.user_score);
  if (sort === "mc") return desc((g) => g.metacritic_score);
  if (sort === "finished") return desc((g) => g.finished_at);
  if (sort === "release") return desc((g) => g.release_date);
  return byName;
}

/** Tags dos jogos à vista, das mais comuns para as raras. */
export function tagFacets(games: PublicGameCard[]): Facet<string>[] {
  const counts = new Map<string, number>();
  for (const g of games) for (const t of g.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts]
    .map(([key, count]) => ({ key, label: key, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"));
}
