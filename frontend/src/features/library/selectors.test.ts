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

  it("calcula as estatísticas da sidebar", () => {
    expect(libraryStats(games)).toEqual({ hours: "83h", played: "44h", high: 1, avg: "8,0" });
    expect(libraryStats([]).avg).toBe("—");
  });
});
