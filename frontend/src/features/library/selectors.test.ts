import { describe, expect, it } from "vitest";

import { deviceCounts, libraryStats, playableInQueue, statusCounts } from "./selectors";
import { devices, games } from "./testing";

describe("library selectors", () => {
  it("conta por status e por aparelho", () => {
    expect(statusCounts(games)).toEqual({ backlog: 5, playing: 0, done: 4, dropped: 0, hype: 1, owned: 0 });
    const backlog = games.filter((g) => g.status === "backlog");
    expect(deviceCounts(backlog, devices).get(11)).toBe(2);
    expect(playableInQueue(games, devices[0])).toBe(3);
  });

  it("calcula as estatísticas da sidebar sobre a lista que recebe", () => {
    expect(libraryStats(games)).toEqual({ hours: "83h", withHltb: 5, played: "44h", high: 1, avg: "8,0", scored: 3 });
    // Só os de GBA (o filtro de plataforma): o HLTB e a prioridade seguem a lista, sem horas nem notas.
    const gba = games.filter((g) => g.platform === "GBA");
    expect(libraryStats(gba)).toEqual({ hours: "45h", withHltb: 2, played: "0h", high: 1, avg: "—", scored: 0 });
    // Finalizados: horas jogadas e nota de qualquer status, HLTB só de quem tem o dado.
    const done = games.filter((g) => g.status === "done");
    expect(libraryStats(done)).toMatchObject({ hours: "0h", withHltb: 0, played: "44h", avg: "8,0", scored: 3 });
    expect(libraryStats([]).avg).toBe("—");
  });
});
