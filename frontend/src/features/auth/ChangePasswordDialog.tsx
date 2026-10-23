import { useState, type FormEvent } from "react";

import { errorMessage } from "../../api/client";
import { useChangePassword } from "../../api/queries";
import { Dialog } from "../../components/Dialog";
import { useToast } from "../../components/Toast";

export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const change = useChangePassword();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
    onClose();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      setError("As senhas novas não conferem.");
      return;
    }
    change.mutate(
      { current_password: current, new_password: next },
      {
        onSuccess: () => {
          toast.show("Senha trocada. Os outros navegadores precisam entrar de novo.", "ok");
          close();
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  return (
    <Dialog open={open} onClose={close} title="Trocar senha">
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label className="field">
          Senha atual
          <input
            className="input"
            type="password"
            required
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label className="field">
          Nova senha (mínimo 8 caracteres)
          <input
            className="input"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </label>
        <label className="field">
          Repita a nova senha
          <input
            className="input"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="row-end">
          <button type="button" className="btn btn-ghost" onClick={close}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={change.isPending}>
            Trocar senha
          </button>
        </div>
      </form>
    </Dialog>
  );
}
