import { describe, expect, it } from "vitest";

import type { Account } from "../../api/types";
import { DEFAULT_PREFS, parsePrefs } from "../../lib/prefs";
import { cardDisplay, devicesByPlatform, metaLine, sharedSummary } from "./cardInfo";
import { devices, game } from "./testing";

const on = DEFAULT_PREFS.card;
const devs = devicesByPlatform([...devices, { id: 12, name: "Steam Deck", kind: "Portátil", platform_ids: [1] }]);
const acc = (id: number, nickname: string): Account => ({ id, store: "steam", nickname }) as Account;

const pcA = game({ name: "Hades", platform: "PC", account_ids: [1, 2] });
const pcB = game({ name: "Portal 2", platform: "PC", account_ids: [2, 1] });
const gba = game({ name: "Advance Wars", platform: "GBA" });

describe("informações do card", () => {
  it("agrupa os aparelhos por plataforma", () => {
    expect(devs.get(1)).toEqual(["PC", "Steam Deck"]);
    expect(devs.get(2)).toEqual(["Miyoo Mini Plus"]);
    expect(devs.get(3)).toBeUndefined();
  });

  it("mostra plataforma, onde jogar e contas numa lista misturada", () => {
    const show = cardDisplay([pcA, gba], on, devs);
    expect(show).toEqual({ platform: true, devices: true, accounts: true, shared: {} });
    expect(metaLine(pcA, show, devs)).toBe("PC · PC, Steam Deck");
    expect(metaLine(game({ name: "Zelda", platform: "Switch" }), show, devs)).toBe("Switch · nenhum aparelho seu");
  });

  it("no automático, o que é igual em todos vai para o subtítulo", () => {
    const show = cardDisplay([pcA, pcB], on, devs);
    expect(show.platform || show.devices || show.accounts).toBe(false);
    expect(show.shared).toEqual({ platform: "PC", devices: ["PC", "Steam Deck"], accountIds: [1, 2] });
    const accounts = new Map([1, 2].map((id) => [id, acc(id, id === 1 ? "JogadorExemplo" : "Irmão")]));
    expect(sharedSummary(show.shared, accounts)).toEqual([
      "todos em PC",
      "jogáveis em PC, Steam Deck",
      "nas contas Steam · JogadorExemplo, Steam · Irmão",
    ]);
  });

  it("sem contas em nenhum jogo não vira texto no subtítulo", () => {
    const show = cardDisplay([gba, game({ name: "Golden Sun", platform: "GBA" })], on, devs);
    expect(show.accounts).toBe(false);
    expect(show.shared.accountIds).toBeUndefined();
  });

  it("respeita o liga/desliga e o automático desligado", () => {
    const off = { ...on, devices: false, accounts: false };
    expect(cardDisplay([pcA, gba], off, devs)).toEqual({ platform: true, devices: false, accounts: false, shared: {} });
    expect(metaLine(pcA, cardDisplay([pcA, gba], off, devs), devs)).toBe("PC");
    expect(cardDisplay([pcA, pcB], { ...off, auto: true }, devs).shared).toEqual({ platform: "PC" });
    expect(cardDisplay([pcA, pcB], { ...on, auto: false }, devs).platform).toBe(true);
    expect(cardDisplay([pcA], on, devs).platform).toBe(true); // um jogo só: nada a agrupar
  });

  it("preferências inválidas voltam ao padrão", () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("lixo")).toEqual(DEFAULT_PREFS);
    const p = parsePrefs({ accent: "#ffffff", coverSize: 999, card: { devices: false, auto: "sim" } });
    expect(p.accent).toBe("#ffffff");
    expect(p.coverSize).toBe(DEFAULT_PREFS.coverSize);
    expect(p.card).toEqual({ platform: true, devices: false, accounts: true, auto: true });
  });
});
