import { useState } from "react";

import { errorMessage } from "../../api/client";
import { useUpdateGame } from "../../api/queries";
import type { GameDetail } from "../../api/types";
import { useToast } from "../../components/Toast";
import styles from "./GameDetail.module.css";

export function ReviewSection({ game }: { game: GameDetail }) {
  const update = useUpdateGame(game.id);
  const toast = useToast();
  const [score, setScore] = useState<number | null>(game.user_score);
  const [text, setText] = useState(game.review_text ?? "");
  const [saved, setSaved] = useState(false);

  const dirty = score !== game.user_score || text !== (game.review_text ?? "");
  const note = saved && !dirty
    ? "Review salva"
    : game.review_text || game.user_score !== null
      ? "Você pode editar a qualquer momento"
      : "Ainda sem review";

  const save = () =>
    update.mutate(
      { user_score: score, review_text: text.trim() || null },
      {
        onSuccess: () => setSaved(true),
        onError: (e) => toast.error(`Não salvei a review: ${errorMessage(e)}`),
      },
    );

  return (
    <section aria-labelledby="h-rv" className={`card ${styles.reviewCard}`}>
      <div className={styles.headRow}>
        <h2 id="h-rv" className="section-title">
          Sua review
        </h2>
        <span className="muted" style={{ fontSize: 12 }} aria-live="polite">
          {note}
        </span>
      </div>
      <div role="group" aria-label="Sua nota de 1 a 10" className={styles.scores}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            className={styles.score}
            aria-pressed={score === n}
            onClick={() => {
              setScore(score === n ? null : n);
              setSaved(false);
            }}
          >
            {n}
          </button>
        ))}
      </div>
      <label className="field">
        O que você achou
        <textarea
          className="textarea"
          rows={6}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setSaved(false);
          }}
          placeholder="Escreva sua review: o que funcionou, o que incomodou, para quem você recomendaria."
          style={{ background: "var(--bg)", borderRadius: 10 }}
        />
      </label>
      <div className="row-end">
        <button type="button" className="btn btn-primary" onClick={save} disabled={update.isPending || !dirty}>
          {update.isPending ? "Salvando…" : "Salvar review"}
        </button>
      </div>
    </section>
  );
}
