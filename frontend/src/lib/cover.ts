// Portado do protótipo (docs/prototype/Main.dc.html): mesma função de hash, para as cores baterem.

export const COVERS: [string, string][] = [
  ["#1E2A55", "#5AA8FF"],
  ["#4A1F25", "#FF8A8A"],
  ["#16382F", "#5CD6A4"],
  ["#43301A", "#FFB454"],
  ["#2E1F4A", "#C792FF"],
  ["#14334A", "#5BC9F5"],
  ["#2A2F38", "#AEB7C6"],
  ["#45203C", "#F28FC9"],
];

export function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function initials(name: string | null | undefined): string {
  const w = String(name || "?")
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  return ((w[0] || "?")[0] + (w[1] ? w[1][0] : (w[0] || "")[1] || "")).toUpperCase();
}

/** [fundo, faixa] da capa gerada; depende de plataforma + nome, como no protótipo. */
export function palette(name: string, platform: string | null | undefined): [string, string] {
  return COVERS[hash((platform || "") + name) % COVERS.length];
}
