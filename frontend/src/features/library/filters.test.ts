import { describe, expect, it } from "vitest";

import type { Account } from "../../api/types";
import {
  PRESETS,
  activeChips,
  clearFilters,
  comparator,
  emptyFilters,
  facets,
  filterGames,
  parseFilters,
  serializeFilters,
  valueScore,
  type Filters,
} from "./filters";
import { devices, game, games, names } from "./testing";

const base = emptyFilters("backlog");
const run = (patch: Partial<Filters>, list = games) => names(filterGames(list, devices, { ...base, ...patch }));

const account = (id: number, store: Account["store"], nickname: string): Account => ({
  id,
  store,
  nickname,
  external_user_id: String(id),
  display_name: null,
  avatar_url: null,
  profile_url: null,
  enabled: true,
  status: "ok",
  last_sync_at: null,
  last_attempt_at: null,
  last_error: null,
  created_at: "2026-10-01T10:00:00",
  game_count: 0,
  ignored_count: 0,
});

const owned = [
  game({
    name: "Hades",
    status: "owned",
    metacritic_score: 93,
    hltb_main_hours: 22,
    played_hours: 30,
    stores: ["Steam", "Epic"],
    account_ids: [1, 2],
    tags: ["Roguelike"],
    developer: "Supergiant Games",
    release_date: "2020-09-17",
    last_played_at: "2026-09-01T10:00:00",
  }),
  game({
    name: "Celeste",
    status: "owned",
    metacritic_score: 92,
    hltb_main_hours: 8,
    stores: ["Epic"],
    account_ids: [2],
    tags: ["Platform"],
    developer: "Maddy Makes Games",
    release_date: "2018-01-25",
    genre_id: 6,
    genre: "Plataforma",
  }),
  game({ name: "Gwent", status: "owned", stores: ["GOG"], account_ids: [3], enriched: false }),
  game({
    name: "Portal 2",
    status: "owned",
    metacritic_score: 95,
    hltb_main_hours: 8.5,
    metacritic_user_score: 8.9,
    stores: ["Steam"],
    account_ids: [1],
    played_hours: 12,
    publisher: "Valve",
    last_played_at: "2026-10-20T10:00:00",
  }),
];
const ownedTab = emptyFilters("owned");
const runOwned = (patch: Partial<Filters>) => names(filterGames(owned, devices, { ...ownedTab, ...patch }));

describe("filtros", () => {
  it("ordena o backlog por prioridade e depois nome", () => {
    expect(run({})).toEqual(["Pokémon Emerald", "Advance Wars", "Alien: Isolation", "Alan Wake", "Celeste"]);
  });

  it("busca sem acento e filtra por aparelho e prioridades", () => {
    expect(run({ q: "pokemon" })).toEqual(["Pokémon Emerald"]);
    expect(run({ devices: [11] })).toEqual(["Pokémon Emerald", "Advance Wars"]);
    expect(run({ devices: [10, 11] })).toHaveLength(5);
    expect(run({ priorities: ["Media"] })).toEqual(["Advance Wars", "Alien: Isolation"]);
    expect(run({ priorities: ["Alta", "Baixa"] })).toEqual(["Pokémon Emerald", "Alan Wake"]);
  });

  it("ordena finalizados por data com 'Antes de 2022' no fim, nas duas direções", () => {
    const done = emptyFilters("done");
    expect(names(filterGames(games, devices, done))).toEqual(["Scritchy Scratchy", "Suikoden", "Eastward", "Doom"]);
    expect(names(filterGames(games, devices, { ...done, dir: "asc" }))).toEqual([
      "Eastward",
      "Suikoden",
      "Scritchy Scratchy",
      "Doom",
    ]);
  });

  it("ordena por mais curtos, nota e metacritic", () => {
    expect([...games].filter((g) => g.status === "backlog").sort(comparator("short"))[0].name).toBe("Celeste");
    const done = games.filter((g) => g.status === "done");
    expect([...done].sort(comparator("score"))[0].name).toBe("Suikoden");
    expect([...done].sort(comparator("mc"))[0].name).toBe("Eastward");
    expect([...done].sort(comparator("name", "desc"))[0].name).toBe("Suikoden");
  });

  it("a aba Todos junta todos os status", () => {
    expect(names(filterGames(games, devices, { ...emptyFilters("all"), q: "a" }))).toContain("Zelda TotK");
  });

  it("filtra por loja, conta, tag, gênero, estúdio e várias contas", () => {
    expect(runOwned({ stores: ["Epic"] })).toEqual(["Hades", "Celeste"]);
    expect(runOwned({ accounts: [1] })).toEqual(["Portal 2", "Hades"]);
    expect(runOwned({ accounts: [3], stores: ["Steam"] })).toEqual([]);
    expect(runOwned({ tags: ["Roguelike", "Platform"] })).toEqual(["Hades", "Celeste"]);
    expect(runOwned({ genres: [6] })).toEqual(["Celeste"]);
    expect(runOwned({ company: "valve" })).toEqual(["Portal 2"]);
    expect(runOwned({ company: "supergiant" })).toEqual(["Hades"]);
    expect(runOwned({ multi: true })).toEqual(["Hades"]);
    expect(runOwned({ noMeta: true })).toEqual(["Gwent"]);
    expect(runOwned({ neverPlayed: true })).toEqual(["Celeste", "Gwent"]);
  });

  it("faixas excluem jogos sem o dado, a não ser que peça", () => {
    const ranges = { ...ownedTab.ranges, mc: { min: 93, max: null } };
    expect(runOwned({ ranges })).toEqual(["Portal 2", "Hades"]);
    expect(runOwned({ ranges, unknown: true })).toEqual(["Portal 2", "Hades", "Gwent"]);
    expect(runOwned({ ranges: { ...ownedTab.ranges, hltb: { min: null, max: 10 } } })).toEqual(["Portal 2", "Celeste"]);
    expect(runOwned({ ranges: { ...ownedTab.ranges, year: { min: 2019, max: 2021 } } })).toEqual(["Hades"]);
    expect(runOwned({ ranges: { ...ownedTab.ranges, mcu: { min: 8.5, max: null } } })).toEqual(["Portal 2"]);
  });

  it("ordena por nota por hora e por último jogado, sem dado no fim", () => {
    expect(valueScore(owned[1])).toBeCloseTo(11.5);
    expect(runOwned({ sort: "value", dir: "desc" })).toEqual(["Celeste", "Portal 2", "Hades", "Gwent"]);
    expect(runOwned({ sort: "value", dir: "asc" })).toEqual(["Hades", "Portal 2", "Celeste", "Gwent"]);
    expect(runOwned({ sort: "lastplayed" })).toEqual(["Portal 2", "Hades", "Celeste", "Gwent"]);
  });

  it("vai e volta pela URL só com o que muda", () => {
    const f: Filters = {
      ...emptyFilters("all"),
      q: "zelda",
      platforms: ["PC", "Mega Drive, Genesis"],
      devices: [10],
      genres: [6],
      accounts: [1, 2],
      tags: ["Roguelike"],
      priorities: ["Alta"],
      company: "Valve",
      ranges: {
        ...ownedTab.ranges,
        mc: { min: 80, max: null },
        mcu: { min: 7.5, max: 9 },
        hltb: { min: null, max: 10 },
      },
      unknown: true,
      neverPlayed: true,
      multi: true,
      sort: "value",
      dir: "asc",
    };
    const sp = serializeFilters(f);
    expect(sp.get("lista")).toBe("todos");
    expect(sp.get("mc")).toBe("80-");
    expect(sp.get("mcu")).toBe("7.5-9");
    expect(sp.getAll("plataforma")).toEqual(["PC", "Mega Drive, Genesis"]);
    expect(parseFilters(new URLSearchParams(sp.toString()))).toEqual(f);
    expect(serializeFilters(emptyFilters("backlog")).toString()).toBe("");
    expect(serializeFilters(emptyFilters("owned")).toString()).toBe("lista=owned");
  });

  it("aceita os parâmetros antigos e ignora lixo", () => {
    const f = parseFilters(new URLSearchParams("lista=done&ordem=short&plataforma=GBA&aparelho=11&prio=Media&mc=abc-"));
    expect(f.tab).toBe("done");
    expect(f.sort).toBe("short");
    expect(f.dir).toBe("asc");
    expect(f.platforms).toEqual(["GBA"]);
    expect(f.devices).toEqual([11]);
    expect(f.priorities).toEqual(["Media"]);
    expect(f.ranges.mc).toEqual({ min: null, max: null });
    expect(parseFilters(new URLSearchParams("lista=xyz&ordem=nada&dir=x")).tab).toBe("backlog");
  });

  it("facetas contam a aba atual e chips removem um filtro por vez", () => {
    const accounts = [account(1, "steam", "JogadorExemplo"), account(2, "epic", "Principal"), account(3, "gog", "Bruno")];
    const fc = facets(owned, accounts);
    expect(fc.stores.map((x) => [x.label, x.count])).toEqual([
      ["Epic", 2],
      ["GOG", 1],
      ["Steam", 2],
    ]);
    expect(fc.accounts.map((x) => x.label)).toEqual(["Epic · Principal", "GOG · Bruno", "Steam · JogadorExemplo"]);

    const f: Filters = {
      ...ownedTab,
      accounts: [1],
      ranges: { ...ownedTab.ranges, hltb: { min: null, max: 10 } },
      multi: true,
    };
    const chips = activeChips(f, { devices, genres: fc.genres, accounts });
    expect(chips.map((c) => c.label)).toEqual(["Steam · JogadorExemplo", "HLTB principal ≤ 10h", "Em 2+ contas"]);
    expect(chips[0].remove(f).accounts).toEqual([]);
    expect(activeChips(clearFilters({ ...f, q: "x" }), { devices, genres: [], accounts })).toEqual([]);
    expect(clearFilters({ ...f, q: "x" }).q).toBe("x");
  });

  it("atalho 'Curtos e bem avaliados' escolhe o melhor jogo curto", () => {
    const short = PRESETS.find((p) => p.id === "curtos")!.apply(ownedTab);
    expect(names(filterGames(owned, devices, short))).toEqual(["Celeste", "Portal 2"]);
  });
});
