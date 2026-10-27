import { useEffect, useRef, useState } from "react";

import type { GameCard } from "../../api/types";
import { GameCover } from "../../components/GameCover";
import { Icon } from "../../components/Icon";
import { STATUS1, STATUS_DOT } from "../../lib/constants";
import { moveItem } from "./lists";
import styles from "./Lists.module.css";

interface Props {
  games: GameCard[];
  onReorder: (gameIds: number[]) => void;
  onRemove: (game: GameCard) => void;
}

/** Modo "Organizar": arrastar pela linha (desktop) ou ↑/↓ (celular e teclado), e tirar da lista. */
export function OrganizeList({ games, onReorder, onRemove }: Props) {
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [said, setSaid] = useState("");
  // A seta usada continua com o foco depois que a linha muda de lugar.
  const [refocus, setRefocus] = useState<{ id: number; dir: "up" | "down" } | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!refocus) return;
    const row = listRef.current?.querySelector(`[data-org="${refocus.id}"]`);
    const btn = row?.querySelector<HTMLButtonElement>(`[data-dir="${refocus.dir}"]`);
    (btn && !btn.disabled ? btn : row?.querySelector<HTMLButtonElement>("[data-dir]:not(:disabled)"))?.focus();
    setRefocus(null);
  }, [refocus, games]);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= games.length || from === to) return;
    onReorder(moveItem(games, from, to).map((g) => g.id));
    setSaid(`${games[from].name} agora é o ${to + 1}º da lista.`);
  };
  const reset = () => {
    setDrag(null);
    setOver(null);
  };

  return (
    <>
      <ol ref={listRef} className={styles.organize}>
        {games.map((g, i) => {
          const target = drag !== null && over === i && drag !== i;
          return (
            <li
              key={g.id}
              data-org={g.id}
              draggable
              className={[
                styles.orgRow,
                drag === i ? styles.dragging : "",
                target ? (drag < i ? styles.dropAfter : styles.dropBefore) : "",
              ].join(" ")}
              onDragStart={(e) => {
                setDrag(i);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", g.name);
              }}
              onDragOver={(e) => {
                if (drag === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (over !== i) setOver(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (drag !== null) move(drag, i);
                reset();
              }}
              onDragEnd={reset}
            >
              <span className={styles.grip} aria-hidden="true" title="Arraste para mudar de lugar">
                <Icon name="grip" size={18} strokeWidth={3.2} />
              </span>
              <span className={styles.orgPos}>{i + 1}</span>
              <span className={styles.orgCover}>
                <GameCover name={g.name} platform={g.platform} cover={g.cover} size="thumb" />
              </span>
              <span className={styles.orgName}>
                <span className={styles.orgTitle}>{g.name}</span>
                <span className={styles.orgMeta}>
                  <span className={styles.orgDot} style={{ background: STATUS_DOT[g.status] }} aria-hidden="true" />
                  {STATUS1[g.status]} · {g.platform}
                </span>
              </span>
              <span className={styles.orgActions}>
                <button
                  type="button"
                  className="btn btn-icon"
                  data-dir="up"
                  disabled={i === 0}
                  aria-label={`Subir ${g.name}`}
                  title="Subir"
                  onClick={() => {
                    move(i, i - 1);
                    setRefocus({ id: g.id, dir: "up" });
                  }}
                >
                  <Icon name="arrowUp" />
                </button>
                <button
                  type="button"
                  className="btn btn-icon"
                  data-dir="down"
                  disabled={i === games.length - 1}
                  aria-label={`Descer ${g.name}`}
                  title="Descer"
                  onClick={() => {
                    move(i, i + 1);
                    setRefocus({ id: g.id, dir: "down" });
                  }}
                >
                  <Icon name="arrowDown" />
                </button>
                <button
                  type="button"
                  className="btn btn-icon"
                  aria-label={`Tirar ${g.name} da lista`}
                  title="Tirar da lista"
                  onClick={() => onRemove(g)}
                >
                  <Icon name="close" />
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
    </>
  );
}
