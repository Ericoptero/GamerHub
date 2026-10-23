import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

import styles from "./Toast.module.css";

type Kind = "info" | "error" | "ok";
interface ToastItem {
  id: number;
  text: string;
  kind: Kind;
}

interface ToastApi {
  show: (text: string, kind?: Kind) => void;
  error: (text: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((t) => t.id !== id)), []);

  const show = useCallback(
    (text: string, kind: Kind = "info") => {
      const id = ++seq.current;
      setItems((xs) => [...xs.slice(-3), { id, text, kind }]);
      window.setTimeout(() => dismiss(id), kind === "error" ? 9000 : 6000);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(() => ({ show, error: (t) => show(t, "error") }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.stack} role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`${styles.toast} ${styles[t.kind]}`}>
            <span className={styles.text}>{t.text}</span>
            <button type="button" className={styles.close} onClick={() => dismiss(t.id)} aria-label="Fechar aviso">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast fora do ToastProvider");
  return ctx;
}
