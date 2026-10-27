// Ao escolher um resultado da busca na integração: a plataforma e o gênero sugeridos para o jogo novo.
import type { Candidate, Genre, Platform } from "../../api/types";
import { fold } from "../../lib/text";

/** PC (ou a primeira plataforma) quando nada indica outra. */
export function defaultPlatform(platforms: Platform[]): string {
  return String((platforms.find((p) => p.name === "PC") ?? platforms[0])?.id ?? "");
}

/**
 * Plataforma: a do filtro da busca; senão uma das que o resultado roda (PC primeiro); senão a padrão.
 * Gênero: o sugerido pela integração, se for um dos cadastrados. Os dois saem como id em texto (valor do <select>).
 */
export function suggestFromCandidate(
  c: Candidate,
  platforms: Platform[],
  genres: Genre[],
  platformFilter = "",
): { platform: string; genre: string } {
  const runs = platforms.filter((p) => c.local_platform_ids.includes(p.id));
  const platform =
    platformFilter || String((runs.find((p) => p.name === "PC") ?? runs[0])?.id ?? defaultPlatform(platforms));
  const suggested = c.suggested_genre ? fold(c.suggested_genre) : null;
  const genre = suggested ? String(genres.find((g) => fold(g.name) === suggested)?.id ?? "") : "";
  return { platform, genre };
}
