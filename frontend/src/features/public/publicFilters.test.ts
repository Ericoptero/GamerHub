import { describe, expect, it } from "vitest";

import type { PublicGameCard } from "../../api/types";
import {
  filterPublic,
  firstTab,
  parsePublicFilters,
  serializePublicFilters,
  statusCounts,
  tagFacets,
  type PublicFilters,
} from "./publicFilters";

const card = (name: string, patch: Partial<PublicGameCard> = {}): PublicGameCard => ({
  id: name.length,
  name,
  platform: "PC",
  genre: null,
  status: "backlog",
  access: "owned",
  user_score: null,
  metacritic_score: null,
  hltb_main_hours: null,
  played_hours: null,
  times_completed: null,
  finished_at: null,
  finished_label: null,
  release_date: null,
  cover: null,
  tags: [],
  ...patch,
});

const games = [
  card("Hades", { status: "done", user_score: 9, finished_at: "2024-05-01", tags: ["Roguelike", "Action"] }),
  card("Dead Cells", { status: "done", user_score: 8, finished_at: "2025-01-10", tags: ["Roguelike", "Metroidvania"] }),
  card("Celeste", { status: "done", tags: ["Platform"] }),
  card("Pokémon Emerald", { status: "playing", tags: ["Role-playing (RPG)"] }),
  card("Outer Wilds", { tags: ["Exploration"] }),
];

const names = (list: PublicGameCard[]) => list.map((g) => g.name);
const base: PublicFilters = { tab: "done", q: "", tags: [], sort: "finished" };

describe("página pública", () => {
  it("abre na primeira aba com jogo, começando pelo que a pessoa está jogando", () => {
    const counts = statusCounts(games);
    expect(counts).toMatchObject({ playing: 1, done: 3, backlog: 1, owned: 0, all: 5 });
    expect(firstTab(counts)).toBe("playing");
    expect(firstTab(statusCounts([]))).toBe("all");
  });

  it("filtra por aba, busca sem acento e qualquer uma das tags", () => {
    expect(names(filterPublic(games, base))).toEqual(["Dead Cells", "Hades", "Celeste"]); // mais recente primeiro
    expect(names(filterPublic(games, { ...base, tab: "all", q: "pokemon", sort: "name" }))).toEqual(["Pokémon Emerald"]);
    expect(names(filterPublic(games, { ...base, tags: ["Metroidvania", "Platform"], sort: "name" }))).toEqual([
      "Celeste",
      "Dead Cells",
    ]);
    expect(names(filterPublic(games, { ...base, sort: "score" }))).toEqual(["Hades", "Dead Cells", "Celeste"]);
  });

  it("guarda o filtro na URL sem repetir o padrão", () => {
    const f: PublicFilters = { tab: "all", q: "dead", tags: ["Roguelike", "Story, Rich"], sort: "mc" };
    const sp = serializePublicFilters(f, "playing");
    expect(sp.toString()).toBe("lista=todos&q=dead&tag=Roguelike&tag=Story%2C+Rich&ordem=mc");
    expect(parsePublicFilters(sp, "playing")).toEqual(f);
    expect(serializePublicFilters(parsePublicFilters(new URLSearchParams(), "done"), "done").toString()).toBe("");
  });

  it("conta as tags das mais comuns para as raras", () => {
    expect(tagFacets(games).slice(0, 2)).toEqual([
      { key: "Roguelike", label: "Roguelike", count: 2 },
      { key: "Action", label: "Action", count: 1 },
    ]);
  });
});
