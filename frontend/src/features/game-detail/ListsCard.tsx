import { useState, type FormEvent } from "react";
import { Link } from "react-router";

import { errorMessage } from "../../api/client";
import { useListMutations, useLists } from "../../api/queries";
import type { GameDetail, GameList } from "../../api/types";
import { Dialog } from "../../components/Dialog";
import { Icon } from "../../components/Icon";
import { useToast } from "../../components/Toast";
import { plural } from "../../lib/format";
import { listsWithGame } from "../lists/lists";
import styles from "./GameDetail.module.css";

/** Em quais das suas listas o jogo está, e um diálogo para pôr e tirar. */
export function ListsCard({ game }: { game: GameDetail }) {
  const lists = useLists();
  const [open, setOpen] = useState(false);
  const all = lists.data ?? [];
  const mine = listsWithGame(all, game.id);
  return (
    <section aria-labelledby="h-listas" className="card" style={{ gap: 12 }}>
      <div className={styles.headRow}>
        <h2 id="h-listas" className={`section-title ${styles.asideTitle}`}>
          Listas
        </h2>
        <Link to="/listas" className="btn btn-link">
          Ver todas
        </Link>
      </div>
      {mine.map((l) => {
        const pos = l.game_ids.indexOf(game.id) + 1;
        return (
          <Link key={l.id} to={`/listas/${l.id}`} className={`${styles.device} ${styles.listLink}`}>
            <span className={styles.deviceIcon} aria-hidden="true">
              <Icon name="lists" strokeWidth={2} />
            </span>
            <span className={styles.deviceText}>
              <span className={styles.deviceName}>{l.name}</span>
              <span className={styles.deviceKind}>
                {l.ranked ? `#${pos} de ${l.game_ids.length}` : plural(l.game_ids.length, "jogo", "jogos")}
              </span>
            </span>
          </Link>
        );
      })}
      {!mine.length && lists.isSuccess && (
        <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
          {all.length ? "Este jogo não está em nenhuma lista sua." : "Você ainda não tem listas."}
        </p>
      )}
      <button type="button" className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setOpen(true)}>
        <Icon name="plus" size={14} strokeWidth={2.6} /> {mine.length ? "Mudar listas" : "Pôr numa lista"}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Listas de ${game.name}`}>
        <ListsPicker game={game} lists={all} onClose={() => setOpen(false)} />
      </Dialog>
    </section>
  );
}

function ListsPicker({ game, lists, onClose }: { game: GameDetail; lists: GameList[]; onClose: () => void }) {
  const { create, add, removeGame } = useListMutations();
  const toast = useToast();
  const [name, setName] = useState("");

  const toggle = (l: GameList, on: boolean) =>
    (on ? add : removeGame).mutate(
      { listId: l.id, gameId: game.id },
      { onError: (e) => toast.error(`Não consegui mudar a lista ${l.name}: ${errorMessage(e)}`) },
    );

  const createAndAdd = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate(
      { name: name.trim() },
      {
        onSuccess: (l) => {
          add.mutate({ listId: l.id, gameId: game.id });
          setName("");
        },
        onError: (err) => toast.error(`Não consegui criar a lista: ${errorMessage(err)}`),
      },
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {lists.length > 0 && (
        <div role="group" aria-label="Suas listas" style={{ display: "flex", flexDirection: "column" }}>
          {lists.map((l) => (
            <label key={l.id} className="check">
              <input
                type="checkbox"
                checked={l.game_ids.includes(game.id)}
                onChange={(e) => toggle(l, e.target.checked)}
              />
              {l.name}
              <span className="muted" style={{ fontSize: 12 }}>
                {plural(l.game_ids.length, "jogo", "jogos")}
              </span>
            </label>
          ))}
        </div>
      )}
      <form onSubmit={createAndAdd} className="row" style={{ alignItems: "flex-end" }}>
        <label className="field" style={{ flex: "1 1 220px" }}>
          Nova lista
          <input
            className="input"
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Metroidvanias"
          />
        </label>
        <button type="submit" className="btn" disabled={!name.trim() || create.isPending}>
          Criar e pôr o jogo
        </button>
      </form>
      <div className="row-end">
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Pronto
        </button>
      </div>
    </div>
  );
}
