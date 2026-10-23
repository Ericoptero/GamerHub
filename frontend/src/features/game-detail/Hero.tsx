import { Link } from "react-router";

import type { GameDetail, Status } from "../../api/types";
import { GameCover } from "../../components/GameCover";
import { Icon } from "../../components/Icon";
import { PRIORITY_LABEL, STATUS1, STATUS_DOT } from "../../lib/constants";
import { initials } from "../../lib/cover";
import styles from "./GameDetail.module.css";

const MOVES: Status[] = ["backlog", "playing", "done", "dropped"];

export function Hero({ game, onMove, busy }: { game: GameDetail; onMove: (s: Status) => void; busy: boolean }) {
  const genreShort = (game.genre ?? "").replace(/\s*\(.*\)\s*/, "");
  const tags = Array.from(
    new Set(
      [
        game.platform,
        genreShort,
        game.priority ? `Prioridade ${PRIORITY_LABEL[game.priority].toLowerCase()}` : "",
      ].filter(Boolean),
    ),
  );
  const moves = MOVES.filter((k) => k !== game.status);
  const backdrop = game.background ?? game.cover;

  return (
    <section aria-label="Cabeçalho do jogo" className={styles.hero}>
      <span className={styles.heroInitials} aria-hidden="true">
        {initials(game.name)}
      </span>
      {backdrop && <img className={styles.heroImg} src={backdrop} alt="" />}
      <span className={styles.heroFade} aria-hidden="true" />
      <div className={styles.heroInner}>
        <Link to="/biblioteca" className={styles.back}>
          <Icon name="back" strokeWidth={2.4} />
          Biblioteca
        </Link>
        <div className={styles.heroRow}>
          <GameCover name={game.name} platform={game.platform} cover={game.cover} size="hero" alt={`Capa de ${game.name}`} />
          <div className={styles.heroInfo}>
            <span className={styles.statusChip} style={{ color: STATUS_DOT[game.status] }}>
              {STATUS1[game.status]}
            </span>
            <h1 className={styles.heroTitle}>{game.name}</h1>
            <div className={styles.tags}>
              {tags.map((t) => (
                <span key={t} className={styles.tag}>
                  {t}
                </span>
              ))}
            </div>
            <div className={styles.moves}>
              {moves.map((k, i) => (
                <button
                  key={k}
                  type="button"
                  disabled={busy}
                  className={i === 0 && k === "playing" ? styles.movePrimary : styles.move}
                  onClick={() => onMove(k)}
                >
                  {k === "playing" ? "Começar a jogar" : `Mover para ${STATUS1[k]}`}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
