import { useCallback, useEffect, useState } from "react";

import { ACCENTS } from "./constants";

export interface Prefs {
  accent: string;
  coverSize: number;
}

const KEY = "gamerhub.prefs";
const DEFAULTS: Prefs = { accent: ACCENTS[0], coverSize: 150 };
const EVENT = "gamerhub:prefs";

export function readPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      accent: typeof p.accent === "string" && /^#[0-9a-f]{6}$/i.test(p.accent) ? p.accent : DEFAULTS.accent,
      coverSize:
        typeof p.coverSize === "number" && p.coverSize >= 110 && p.coverSize <= 220 ? p.coverSize : DEFAULTS.coverSize,
    };
  } catch {
    return DEFAULTS;
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
