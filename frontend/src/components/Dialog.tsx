import { useEffect, useRef, type ReactNode } from "react";

import { Icon } from "./Icon";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}

/** `<dialog>` nativo controlado por `open` (foco preso e Esc de graça). */
export function Dialog({ open, onClose, title, children, wide }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      style={wide ? { width: "min(1100px, calc(100vw - 24px))" } : undefined}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-label={title}
    >
      {open && (
        <div className="dialog-body">
          <div className="dialog-head">
            <h2 className="section-title">{title}</h2>
            <button type="button" className="btn btn-icon" onClick={onClose} aria-label="Fechar">
              <Icon name="close" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
