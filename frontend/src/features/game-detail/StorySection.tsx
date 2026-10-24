import { useState } from "react";

import { errorMessage } from "../../api/client";
import { useUpdateGame } from "../../api/queries";
import type { GameDetail } from "../../api/types";
import { Icon } from "../../components/Icon";
import { useToast } from "../../components/Toast";
import styles from "./GameDetail.module.css";

/** Resumo da história (spoilers, recolhido). O seu texto vale mais que o do IGDB; apagado, o do IGDB volta. */
export function StorySection({ game }: { game: GameDetail }) {
  const update = useUpdateGame(game.id);
  const toast = useToast();
  // null: lendo; texto: editando.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = game.story_summary || game.storyline;
  const fromIgdb = !game.story_summary && !!game.storyline;

  const save = () =>
    update.mutate(
      { story_summary: draft?.trim() || null },
      {
        onSuccess: () => {
          setDraft(null);
          toast.show("Resumo da história salvo.", "ok");
        },
        onError: (e) => toast.error(`Não salvei o resumo: ${errorMessage(e)}`),
      },
    );

  return (
    <details className={styles.fold}>
      <summary>Resumo da história (spoilers){fromIgdb ? " (IGDB)" : ""}</summary>
      {draft === null ? (
        <>
          {shown ? (
            <p className={styles.story}>{shown}</p>
          ) : (
            <p className={`muted ${styles.story}`}>Ainda sem resumo da história.</p>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ marginTop: 8 }}
            onClick={() => setDraft(shown ?? "")}
          >
            <Icon name="edit" size={14} /> {shown ? "Editar resumo" : "Escrever resumo"}
          </button>
        </>
      ) : (
        <div className={styles.storyEdit}>
          <textarea
            className="textarea"
            rows={8}
            aria-label="Resumo da história"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="O que acontece na história, para lembrar quando voltar a jogar."
          />
          {game.storyline && (
            <span className="muted" style={{ fontSize: 12 }}>
              Se apagar tudo, volta o texto do IGDB.
            </span>
          )}
          <div className="row-end">
            <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={update.isPending}>
              {update.isPending ? "Salvando…" : "Salvar resumo"}
            </button>
          </div>
        </div>
      )}
    </details>
  );
}
