import { useCallback, useRef, useState, type ReactNode } from "react";

import { Dialog } from "./Dialog";

interface Ask {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

/** Diálogo de confirmação acessível: `const [dialog, confirm] = useConfirm(); if (await confirm({...}))`. */
export function useConfirm(): [ReactNode, (ask: Ask) => Promise<boolean>] {
  const [ask, setAsk] = useState<Ask | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback(
    (a: Ask) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setAsk(a);
      }),
    [],
  );

  const close = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setAsk(null);
  };

  const element = (
    <Dialog open={ask !== null} onClose={() => close(false)} title={ask?.title ?? ""}>
      <div style={{ color: "var(--text-3)", lineHeight: 1.55 }}>{ask?.message}</div>
      <div className="row-end">
        <button type="button" className="btn btn-ghost" onClick={() => close(false)}>
          Cancelar
        </button>
        <button type="button" className={ask?.danger ? "btn btn-danger" : "btn btn-primary"} onClick={() => close(true)}>
          {ask?.confirmLabel ?? "Confirmar"}
        </button>
      </div>
    </Dialog>
  );
  return [element, confirm];
}
