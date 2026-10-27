import { useState, type FormEvent } from "react";

import { errorMessage } from "../../api/client";
import { useListMutations } from "../../api/queries";
import type { GameList } from "../../api/types";
import { Dialog } from "../../components/Dialog";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Sem ela, cria uma lista nova. */
  list?: GameList;
  onSaved?: (list: GameList) => void;
}

export function ListFormDialog({ open, onClose, list, onSaved }: Props) {
  return (
    <Dialog open={open} onClose={onClose} title={list ? "Editar lista" : "Nova lista"}>
      <ListForm list={list} onClose={onClose} onSaved={onSaved} />
    </Dialog>
  );
}

/** Montado a cada abertura (o Dialog só renderiza aberto): começa com os valores da lista. */
function ListForm({ list, onClose, onSaved }: Omit<Props, "open">) {
  const { create, update } = useListMutations();
  const [name, setName] = useState(list?.name ?? "");
  const [description, setDescription] = useState(list?.description ?? "");
  const [ranked, setRanked] = useState(list?.ranked ?? false);
  const [isPublic, setPublic] = useState(list?.public ?? true);
  const [error, setError] = useState<string | null>(null);
  const saving = create.isPending || update.isPending;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const data = { name: name.trim(), description: description.trim() || null, ranked, public: isPublic };
    const done = {
      onSuccess: (saved: GameList) => {
        onSaved?.(saved);
        onClose();
      },
      onError: (err: unknown) => setError(errorMessage(err)),
    };
    if (list) update.mutate({ id: list.id, patch: data }, done);
    else create.mutate(data, done);
  };

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <label className="field">
        Nome
        <input
          className="input"
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex.: Metroidvanias, Para jogar em 2027"
          autoFocus
        />
      </label>
      <label className="field">
        Descrição (opcional)
        <textarea className="textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={ranked} onChange={(e) => setRanked(e.target.checked)} />
        Ranqueada: mostra a posição de cada jogo (#1, #2…) na ordem da lista
      </label>
      <label className="check">
        <input type="checkbox" checked={isPublic} onChange={(e) => setPublic(e.target.checked)} />
        Pública: aparece na sua página pública, sem os jogos ocultos
      </label>
      {error && <p className="error-text">{error}</p>}
      <div className="row-end">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving || !name.trim()}>
          {saving ? "Salvando…" : list ? "Salvar" : "Criar lista"}
        </button>
      </div>
    </form>
  );
}
