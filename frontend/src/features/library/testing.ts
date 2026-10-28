// Fábrica de GameCard para os testes da biblioteca.
import type { Device, GameCard } from "../../api/types";

let nextId = 1;

export function game(p: Partial<GameCard> & Pick<GameCard, "name">): GameCard {
  const platform = p.platform ?? "PC";
  return {
    id: nextId++,
    platform,
    platform_id: { PC: 1, GBA: 2, Switch: 3, Android: 4 }[platform] ?? 9,
    genre_id: null,
    genre: null,
    status: "backlog",
    priority: null,
    access: "owned",
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
    hltb_extra_hours: null,
    hltb_complete_hours: null,
    metacritic_user_score: null,
    tags: [],
    developer: null,
    publisher: null,
    stores: [],
    account_ids: [],
    last_played_at: null,
    enriched: true,
    hidden: false,
    ...p,
  };
}

export const games: GameCard[] = [
  game({ name: "Pokémon Emerald", platform: "GBA", priority: "Alta", hltb_main_hours: 30 }),
  game({ name: "Advance Wars", platform: "GBA", priority: "Media", hltb_main_hours: 15 }),
  game({ name: "Alan Wake", priority: "Baixa", hltb_main_hours: 11 }),
  game({ name: "Alien: Isolation", priority: "Media", hltb_main_hours: 18.5 }),
  game({ name: "Celeste", hltb_main_hours: 8.2 }),
  game({
    name: "Eastward",
    status: "done",
    played_hours: 17.6,
    user_score: 8,
    finished_at: "2026-01-17",
    metacritic_score: 81,
  }),
  game({
    name: "Suikoden",
    platform: "Switch",
    status: "done",
    played_hours: 22.6,
    user_score: 9,
    finished_at: "2026-05-03",
  }),
  game({ name: "Doom", status: "done", user_score: 7, finished_label: "Antes de 2022" }),
  game({ name: "Scritchy Scratchy", platform: "Android", status: "done", played_hours: 4, finished_at: "2026-08-11" }),
  game({ name: "Zelda TotK", platform: "Switch", status: "hype", release_date: "2023-05-12" }),
];

export const devices: Device[] = [
  { id: 10, name: "PC", kind: "PC", platform_ids: [1] },
  { id: 11, name: "Miyoo Mini Plus", kind: "Emulador / retro", platform_ids: [2] },
];

export const names = (xs: GameCard[]) => xs.map((g) => g.name);
