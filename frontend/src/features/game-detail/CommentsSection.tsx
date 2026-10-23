import { useState, type FormEvent } from "react";

import { errorMessage } from "../../api/client";
import { useAddComment, useDeleteComment, useEditComment } from "../../api/queries";
import type { Comment, GameDetail } from "../../api/types";
import { useConfirm } from "../../components/Confirm";
import { Icon } from "../../components/Icon";
import { useToast } from "../../components/Toast";
import { fmtLocalDate } from "../../lib/format";
import styles from "./GameDetail.module.css";

function CommentItem({ comment, gameId }: { comment: Comment; gameId: number }) {
  const edit = useEditComment(gameId);
  const del = useDeleteComment(gameId);
  const toast = useToast();
  const [dialog, confirm] = useConfirm();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const pending = comment.id < 0;

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    edit.mutate(
      { id: comment.id, body: draft.trim() },
      { onSuccess: () => setEditing(false), onError: (err) => toast.error(errorMessage(err)) },
    );
  };

  const remove = async () => {
    if (await confirm({ title: "Excluir comentário", message: "Essa anotação será apagada.", confirmLabel: "Excluir", danger: true })) {
      del.mutate(comment.id, { onError: (err) => toast.error(errorMessage(err)) });
    }
  };

  return (
    <div className={styles.comment}>
      <span className={styles.commentDot} aria-hidden="true" />
      <div className={styles.commentBody}>
        <div className={styles.commentMeta}>
          <span>
            {fmtLocalDate(comment.created_at)}
            {comment.updated_at ? " · editado" : ""}
          </span>
          {!pending && !editing && (
            <>
              <button type="button" className="btn btn-icon" onClick={() => setEditing(true)} aria-label="Editar comentário">
                <Icon name="edit" size={14} />
              </button>
              <button type="button" className="btn btn-icon" onClick={remove} aria-label="Excluir comentário">
                <Icon name="trash" size={14} />
              </button>
            </>
          )}
        </div>
        {editing ? (
          <form onSubmit={save} className="row" style={{ alignItems: "flex-end" }}>
            <label className="field" style={{ flex: "1 1 260px" }}>
              <span className="sr-only">Editar comentário</span>
              <textarea className="textarea" rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} />
            </label>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-sm" disabled={edit.isPending}>
              Salvar
            </button>
          </form>
        ) : (
          <p className={styles.commentText}>{comment.body}</p>
        )}
      </div>
      {dialog}
    </div>
  );
}

export function CommentsSection({ game }: { game: GameDetail }) {
  const add = useAddComment(game.id);
  const toast = useToast();
  const [body, setBody] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setBody("");
    add.mutate(text, {
      onError: (err) => {
        setBody(text);
        toast.error(`Não salvei o comentário: ${errorMessage(err)}`);
      },
    });
  };

  return (
    <section aria-labelledby="h-cm" className="card">
      <h2 id="h-cm" className="section-title">
        Comentários <span className="count">{game.comments.length || ""}</span>
      </h2>
      <form onSubmit={submit} className={styles.commentForm}>
        <label className="field">
          Nova anotação
          <input
            className="input"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Ex.: parei no capítulo 6, voltar pelo save do farol"
          />
        </label>
        <button type="submit" className="btn" style={{ alignSelf: "flex-end" }} disabled={!body.trim()}>
          Comentar
        </button>
      </form>
      {game.comments.length === 0 && (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Nenhum comentário ainda. Use para anotar progresso, dicas ou impressões ao longo da jogatina.
        </p>
      )}
      {game.comments.map((c) => (
        <CommentItem key={c.id} comment={c} gameId={game.id} />
      ))}
    </section>
  );
}
