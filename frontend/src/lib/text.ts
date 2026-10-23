/** Minúsculo e sem acento, para buscas tolerantes ("pokemon" acha "Pokémon"). */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

export function splitList(s: string): string[] {
  const out: string[] = [];
  for (const part of s.split(/[,;]/)) {
    const t = part.trim();
    if (t && !out.some((o) => fold(o) === fold(t))) out.push(t);
  }
  return out;
}

export function youtubeId(url: string): string | null {
  const m = /(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/.exec(url);
  return m ? m[1] : null;
}
