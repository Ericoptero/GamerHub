import { describe, expect, it } from "vitest";

import { mcColor, mcWord } from "./constants";
import { hash, initials, palette } from "./cover";
import { fmtDate, fmtLocalDate, hrs, parseNum } from "./format";
import { fold, splitList, youtubeId } from "./text";

describe("cover", () => {
  it("hash é o mesmo do protótipo (int32 com sinal, depois abs)", () => {
    expect(hash("")).toBe(0);
    expect(hash("a")).toBe(97);
    expect(hash("PCHollow Knight")).toBe(Math.abs(hash("PCHollow Knight")));
    // estoura 32 bits e continua determinístico
    expect(hash("PCThe Legend of Zelda: Tears of the Kingdom")).toBe(hash("PCThe Legend of Zelda: Tears of the Kingdom"));
  });

  it("iniciais como no protótipo", () => {
    expect(initials("Hollow Knight")).toBe("HK");
    expect(initials("Celeste")).toBe("CE");
    expect(initials("F.E.A.R.")).toBe("FE");
    expect(initials("")).toBe("?");
    expect(initials("Pokémon Emerald")).toBe("PE");
  });

  it("paleta depende de plataforma + nome", () => {
    expect(palette("Hollow Knight", "PC")).toEqual(palette("Hollow Knight", "PC"));
    expect(palette("x", null)).toEqual(palette("x", ""));
  });
});

describe("format", () => {
  it("hrs usa vírgula e arredonda a 1 casa", () => {
    expect(hrs(12.25)).toBe("12,3h");
    expect(hrs(16)).toBe("16h");
    expect(hrs(null)).toBeNull();
  });

  it("fmtDate", () => {
    expect(fmtDate("2026-10-04")).toBe("04/10/2026");
    expect(fmtDate("2026-10-04T23:00:00")).toBe("04/10/2026");
    expect(fmtDate(null)).toBe("—");
    expect(fmtDate("Antes de 2022")).toBe("Antes de 2022");
  });

  it("fmtLocalDate converte de UTC", () => {
    const d = new Date(Date.UTC(2026, 9, 4, 12, 0, 0));
    const expected = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/2026`;
    expect(fmtLocalDate("2026-10-04T12:00:00")).toBe(expected);
  });

  it("parseNum aceita vírgula", () => {
    expect(parseNum("12,5")).toBe(12.5);
    expect(parseNum("")).toBeNull();
    expect(parseNum("abc")).toBeNull();
  });
});

describe("constants e texto", () => {
  it("cores e palavras do Metacritic", () => {
    expect(mcColor(90)).toBe("#5CD68A");
    expect(mcColor(60)).toBe("#FFC857");
    expect(mcColor(40)).toBe("#FF8A8A");
    expect(mcColor(null)).toBe("#8B94A7");
    expect(mcWord(75)).toBe("Aclamado pela crítica");
  });

  it("fold, splitList e youtubeId", () => {
    expect(fold("  Pokémon ")).toBe("pokemon");
    expect(splitList("Steam, Epic; steam")).toEqual(["Steam", "Epic"]);
    expect(youtubeId("https://www.youtube.com/watch?v=UAO2urG23S4")).toBe("UAO2urG23S4");
    expect(youtubeId("https://example.com/video.mp4")).toBeNull();
  });
});
