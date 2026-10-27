import { describe, expect, it } from "vitest";

import type { GameList } from "../../api/types";
import { game, names } from "../library/testing";
import { listProgress, listsWithGame, mosaic, moveItem, ranks, resolveGames, sortListGames } from "./lists";

const hk = game({ name: "Hollow Knight", status: "done", hltb_main_hours: 27, metacritic_score: 87 });
const mf = game({ name: "Metroid Fusion", status: "playing", hltb_main_hours: 6, cover: "/media/mf.webp" });
const silk = game({ name: "Silksong", status: "hype", hltb_main_hours: null });
const ori = game({ name: "Ori", status: "backlog", hltb_main_hours: 9, metacritic_score: 88, cover: "/media/ori.webp" });
const dead = game({ name: "Axiom Verge", status: "dropped", hltb_main_hours: 12 });
const byId = new Map([hk, mf, silk, ori, dead].map((g) => [g.id, g]));

const list = (id: number, gameIds: number[]): GameList => ({
  id,
  name: `Lista ${id}`,
  description: null,
  ranked: false,
  public: true,
  game_ids: gameIds,
  created_at: "2026-10-27T10:00:00",
  updated_at: "2026-10-27T10:00:00",
});

describe("listas", () => {
  it("monta os jogos na ordem da lista e ignora os que sumiram", () => {
    expect(names(resolveGames([ori.id, 9999, hk.id], byId))).toEqual(["Ori", "Hollow Knight"]);
  });

  it("calcula o progresso pelo status", () => {
    expect(listProgress([hk, mf, silk, ori, dead])).toEqual({
      total: 5,
      done: 1,
      playing: 1,
      dropped: 1,
      left: 2,
      pct: 20,
      hoursLeft: 15, // Metroid Fusion (jogando) + Ori; o hype não tem HLTB e o dropado não conta
    });
    expect(listProgress([]).pct).toBe(0);
  });

  it("põe as capas com imagem na frente do mosaico", () => {
    expect(names(mosaic([hk, mf, silk, ori], 3))).toEqual(["Metroid Fusion", "Ori", "Hollow Knight"]);
  });

  it("move um item de lugar", () => {
    expect(moveItem([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]);
    expect(moveItem([1, 2, 3, 4], 3, 0)).toEqual([4, 1, 2, 3]);
    expect(moveItem([1, 2, 3], 1, 99)).toEqual([1, 3, 2]);
    const same = [1, 2];
    expect(moveItem(same, 1, 1)).toBe(same);
  });

  it("ordena pela lista ou pelas ordenações da biblioteca", () => {
    const inList = [silk, hk, ori];
    expect(names(sortListGames(inList, "manual", "asc"))).toEqual(["Silksong", "Hollow Knight", "Ori"]);
    expect(names(sortListGames(inList, "manual", "desc"))).toEqual(["Ori", "Hollow Knight", "Silksong"]);
    expect(names(sortListGames(inList, "mc", "desc"))).toEqual(["Ori", "Hollow Knight", "Silksong"]);
    expect(names(inList)).toEqual(["Silksong", "Hollow Knight", "Ori"]); // não mexe no original
  });

  it("numera as posições e acha as listas de um jogo", () => {
    expect(ranks([ori.id, hk.id]).get(hk.id)).toBe(2);
    const lists = [list(1, [hk.id]), list(2, [ori.id]), list(3, [ori.id, hk.id])];
    expect(listsWithGame(lists, hk.id).map((l) => l.id)).toEqual([1, 3]);
  });
});
