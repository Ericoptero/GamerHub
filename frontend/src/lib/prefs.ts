import { useCallback, useEffect, useState } from "react";

import { ACCENTS } from "./constants";

/** O que aparece embaixo da capa nos cards da biblioteca. */
export interface CardPrefs {
  platform: boolean;
  devices: boolean;
  accounts: boolean;
  /** A nota que você deu ao jogo. */
  score: boolean;
  /** Esconde do card o que for igual em todos os jogos da lista (vai uma vez para o subtítulo). */
  auto: boolean;
}

export interface Prefs {
  accent: string;
  coverSize: number;
  card: CardPrefs;
}

const KEY = "gamerhub.prefs";
const DEFAULT_CARD: CardPrefs = { platform: true, devices: true, accounts: true, score: true, auto: true };
export const DEFAULT_PREFS: Prefs = { accent: ACCENTS[0], coverSize: 150, card: DEFAULT_CARD };
const EVENT = "gamerhub:prefs";

/** Valida o que veio do localStorage; campo ausente ou inválido volta ao padrão. */
export function parsePrefs(raw: unknown): Prefs {
  const p = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof Prefs, unknown>>;
  const card = (p.card && typeof p.card === "object" ? p.card : {}) as Partial<Record<keyof CardPrefs, unknown>>;
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  return {
    accent: typeof p.accent === "string" && /^#[0-9a-f]{6}$/i.test(p.accent) ? p.accent : DEFAULT_PREFS.accent,
    coverSize:
      typeof p.coverSize === "number" && p.coverSize >= 110 && p.coverSize <= 220
        ? p.coverSize
        : DEFAULT_PREFS.coverSize,
    card: {
      platform: bool(card.platform, DEFAULT_CARD.platform),
      devices: bool(card.devices, DEFAULT_CARD.devices),
      accounts: bool(card.accounts, DEFAULT_CARD.accounts),
      score: bool(card.score, DEFAULT_CARD.score),
      auto: bool(card.auto, DEFAULT_CARD.auto),
    },
  };
}

export function readPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return parsePrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_PREFS;
  }
}

function writePrefs(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // modo privado / armazenamento bloqueado: a preferência vale só nesta sessão
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: p }));
}

export function applyPrefs(p: Prefs) {
  const root = document.documentElement;
  root.style.setProperty("--accent", p.accent);
  root.style.setProperty("--cover-size", `${p.coverSize}px`);
}

export function usePrefs(): [Prefs, (patch: Partial<Prefs>) => void] {
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);
  useEffect(() => {
    const onChange = (e: Event) => setPrefs((e as CustomEvent<Prefs>).detail);
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);
  const update = useCallback((patch: Partial<Prefs>) => {
    const next = { ...readPrefs(), ...patch };
    applyPrefs(next);
    writePrefs(next);
  }, []);
  return [prefs, update];
}
