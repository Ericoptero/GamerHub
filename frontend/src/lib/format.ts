/** 12.25 -> "12,3h" (como o protótipo). */
export function hrs(x: number | null | undefined): string | null {
  if (x === null || x === undefined) return null;
  return (Math.round(x * 10) / 10).toString().replace(".", ",") + "h";
}

/** "2026-10-04" ou "2026-10-04T12:00:00" -> "04/10/2026"; vazio -> "—". */
export function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}

/** Data de lançamento no card do Hype: "04/10/2026" ou "Sem data". */
export function fmtRelease(d: string | null | undefined): string {
  return d ? fmtDate(d) : "Sem data";
}

/** Datetime do backend (UTC, sem "Z") -> Date local. */
export function parseUtc(dt: string): Date {
  return new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(dt) ? dt : `${dt}Z`);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Datetime UTC do backend -> "dd/mm/aaaa" no fuso local. */
export function fmtLocalDate(dt: string | null | undefined): string {
  if (!dt) return "—";
  const d = parseUtc(dt);
  if (Number.isNaN(d.getTime())) return fmtDate(dt);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Datetime UTC do backend -> "dd/mm/aaaa hh:mm" no fuso local. */
export function fmtLocalDateTime(dt: string | null | undefined): string {
  if (!dt) return "—";
  const d = parseUtc(dt);
  if (Number.isNaN(d.getTime())) return fmtDate(dt);
  return `${fmtLocalDate(dt)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Data de hoje (local) em ISO "aaaa-mm-dd". */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "12,5" / "12.5" / "" -> número ou null. */
export function parseNum(v: string): number | null {
  const t = v.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function numToInput(n: number | null | undefined): string {
  return n === null || n === undefined ? "" : String(n).replace(".", ",");
}

export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? one : many}`;
}
