import { useMemo, useState } from "react";

import { errorMessage } from "../../api/client";
import { useGames, useMergeGame } from "../../api/queries";
import type { GameCard, GameDetail } from "../../api/types";
import { useConfirm } from "../../components/Confirm";
import { Dialog } from "../../components/Dialog";
import { useToast } from "../../components/Toast";
import { STATUS1 } from "../../lib/constants";
import { fold } from "../../lib/text";
import styles from "./MergeDialog.module.css";

const MAX_RESULTS = 30;

/** Escolhe outro jogo para juntar neste (o outro é apagado). Sugestões (duplicados) vêm primeiro. */
export function MergeDialog({ game, open, onClose }: { game: GameDetail; open: boolean; onClose: () => void }) {
  const games = useGames();
  const merge = useMergeGame(game.id);
  const toast = useToast();
  const [dialog, confirm] = useConfirm();
  const [q, setQ] = useState("");

  const suggested = useMemo(() => new Set(game.duplicates.map((d) => d.id)), [game.duplicates]);
  const options = useMemo(() => {
    const needle = fold(q);
    const others = (games.data ?? []).filter((g) => g.id !== game.id);
    const hits = needle
      ? others.filter((g) => fold(g.name).includes(needle))
      : others.filter((g) => suggested.has(g.id));
    return hits
      .sort(
        (a, b) => Number(suggested.has(b.id)) - Number(suggested.has(a.id)) || a.name.localeCompare(b.name, "pt-BR"),
      )
      .slice(0, MAX_RESULTS);
  }, [games.data, game.id, q, suggested]);

  const close = () => {
    setQ("");
    onClose();
  };

  const pick = async (source: GameCard) => {
    const ok = await confirm({
      title: `Juntar ${source.name} aqui?`,
      message: (
        <>
          <strong>{source.name}</strong> ({source.platform}, {STATUS1[source.status].toLowerCase()}) será apagado. As
          contas de loja, os comentários, a mídia adicionada à mão e os dados que faltam em <strong>{game.name}</strong>{" "}
          passam para cá.
        </>
      ),
      confirmLabel: "Mesclar",
    });
    if (!ok) return;
    merge.mutate(source.id, {
      onSuccess: () => {
        toast.show(`${source.name} foi mesclado em ${game.name}.`, "ok");
        close();
      },
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  return (
    <Dialog open={open} onClose={close} title={`Mesclar outro jogo em ${game.name}`}>
      <p className="lead">
        Use quando o mesmo jogo aparece duas vezes (ex.: veio de duas lojas com nomes diferentes). Este jogo fica; o
        escolhido some.
      </p>
      <input
        type="search"
        className="input"
        aria-label="Buscar jogo para mesclar"
        placeholder="Buscar na biblioteca"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
      />
      <ul className={styles.list} aria-label="Jogos">
        {options.map((g) => (
          <li key={g.id}>
            <button type="button" className={styles.option} onClick={() => pick(g)} disabled={merge.isPending}>
              <span className={styles.name}>{g.name}</span>
              <span className="muted">
                {g.platform} · {STATUS1[g.status]}
                {suggested.has(g.id) ? " · parece o mesmo jogo" : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {!options.length && (
        <p className="muted" style={{ margin: 0 }}>
          {q ? "Nenhum jogo com esse nome." : "Nenhuma sugestão. Busque pelo nome do outro jogo."}
        </p>
      )}
      {dialog}
    </Dialog>
  );
}
