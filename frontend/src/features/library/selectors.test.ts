import { describe, expect, it } from "vitest";

import type { Device, GameCard } from "../../api/types";
import {
  comparators,
  defaultSort,
  deviceCounts,
  filterGames,
  libraryStats,
  platformOptions,
  playableInQueue,
  statusCounts,
  type LibraryFilters,
} from "./selectors";

let nextId = 1;
function game(p: Partial<GameCard> & Pick<GameCard, "name">): GameCard {
  const platform = p.platform ?? "PC";
  return {
    id: nextId++,
    platform,
    platform_id: { PC: 1, GBA: 2, Switch: 3, Android: 4 }[platform] ?? 9,
    genre_id: null,
    genre: null,
    status: "backlog",
    priority: null,
    hltb_main_hours: null,
    played_hours: null,
    user_score: null,
    metacritic_score: null,
    times_completed: null,
    finished_at: null,
    finished_label: null,
    release_date: null,
    created_at: "2026-10-01T10:00:00",
    cover: null,
    ...p,
  };
}

const games: GameCard[] = [
  game({ name: "Pokémon Emerald", platform: "GBA", priority: "Alta", hltb_main_hours: 30 }),
  game({ name: "Advance Wars", platform: "GBA", priority: "Media", hltb_main_hours: 15 }),
  game({ name: "Alan Wake", priority: "Baixa", hltb_main_hours: 11 }),
  game({ name: "Alien: Isolation", priority: "Media", hltb_main_hours: 18.5 }),
  game({ name: "Celeste", hltb_main_hours: 8.2 }),
  game({ name: "Eastward", status: "done", played_hours: 17.6, user_score: 8, finished_at: "2026-01-17", metacritic_score: 81 }),
  game({ name: "Suikoden", platform: "Switch", status: "done", played_hours: 22.6, user_score: 9, finished_at: "2026-05-03" }),
  game({ name: "Doom", status: "done", user_score: 7, finished_label: "Antes de 2022" }),
  game({ name: "Scritchy Scratchy", platform: "Android", status: "done", played_hours: 4, finished_at: "2026-08-11" }),
  game({ name: "Zelda TotK", platform: "Switch", status: "hype", release_date: "2023-05-12" }),
];

const devices: Device[] = [
  { id: 10, name: "PC", kind: "PC", platform_ids: [1] },
  { id: 11, name: "Miyoo Mini Plus", kind: "Emulador / retro", platform_ids: [2] },
];

const base: LibraryFilters = { tab: "backlog", q: "", platform: "", deviceId: null, priority: "", sort: "prio" };
const names = (xs: GameCard[]) => xs.map((g) => g.name);

describe("library selectors", () => {
  it("ordena o backlog por prioridade e depois nome", () => {
    expect(names(filterGames(games, devices, base))).toEqual([
      "Pokémon Emerald",
      "Advance Wars",
      "Alien: Isolation",
      "Alan Wake",
      "Celeste",
    ]);
  });

  it("busca sem acento e filtra por aparelho e prioridade", () => {
    expect(names(filterGames(games, devices, { ...base, q: "pokemon" }))).toEqual(["Pokémon Emerald"]);
    expect(names(filterGames(games, devices, { ...base, deviceId: 11 }))).toEqual(["Pokémon Emerald", "Advance Wars"]);
    expect(names(filterGames(games, devices, { ...base, priority: "Media" }))).toEqual([
      "Advance Wars",
      "Alien: Isolation",
    ]);
    // prioridade não filtra fora do backlog
    expect(filterGames(games, devices, { ...base, tab: "done", priority: "Alta", sort: "date" })).toHaveLength(4);
  });

  it("ordena finalizados por data com 'Antes de 2022' no fim", () => {
    const done = filterGames(games, devices, { ...base, tab: "done", sort: defaultSort("done") });
    expect(names(done)).toEqual(["Scritchy Scratchy", "Suikoden", "Eastward", "Doom"]);
  });

  it("ordena por mais curtos, nota e metacritic", () => {
    const short = [...games].filter((g) => g.status === "backlog").sort(comparators.short);
    expect(short[0].name).toBe("Celeste");
    const byScore = games.filter((g) => g.status === "done").sort(comparators.score);
    expect(byScore[0].name).toBe("Suikoden");
    const byMc = games.filter((g) => g.status === "done").sort(comparators.mc);
    expect(byMc[0].name).toBe("Eastward");
  });

  it("conta por status e por aparelho", () => {
    expect(statusCounts(games)).toEqual({ backlog: 5, playing: 0, done: 4, dropped: 0, hype: 1 });
    const backlog = games.filter((g) => g.status === "backlog");
    expect(deviceCounts(backlog, devices).get(11)).toBe(2);
    expect(playableInQueue(games, devices[0])).toBe(3);
    expect(platformOptions(backlog)).toEqual(["GBA", "PC"]);
  });

  it("calcula as estatísticas da sidebar", () => {
    expect(libraryStats(games)).toEqual({ hours: "83h", played: "44h", high: 1, avg: "8,0" });
    expect(libraryStats([]).avg).toBe("—");
  });
});
