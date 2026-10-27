import type { CSSProperties } from "react";
import { Link } from "react-router";

import type { GameCard } from "../../api/types";
import { GameCover } from "../../components/GameCover";
import { hrs, plural } from "../../lib/format";
import { listProgress, mosaic, type Progress } from "./lists";
import styles from "./Lists.module.css";

/** O que o card e a barra precisam de cada jogo (serve também para a página pública). */
export type ListGame = Pick<GameCard, "id" | "name" | "platform" | "cover" | "status" | "hltb_main_hours">;

const SEGMENTS: { key: "done" | "playing" | "dropped"; label: string }[] = [
  { key: "done", label: "Finalizados" },
  { key: "playing", label: "Jogando" },
  { key: "dropped", label: "Dropados" },
];

/** Barra segmentada pelo status: finalizados, jogando e dropados; o resto é o que falta. */
export function ProgressBar({ progress: p, legend }: { progress: Progress; legend?: boolean }) {
  const width = (n: number) => `${p.total ? (n / p.total) * 100 : 0}%`;
  return (
    <div className={styles.progress}>
      <div
        className={styles.bar}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={p.pct}
        aria-valuetext={`${p.done} de ${p.total} finalizados`}
        aria-label="Progresso da lista"
      >
        {SEGMENTS.map((s) =>
          p[s.key] ? (
            <span key={s.key} style={{ width: width(p[s.key]), background: `var(--st-${s.key})` }} />
          ) : null,
        )}
      </div>
      {legend && (
        <ul className={styles.legend}>
          {SEGMENTS.map((s) => (
            <li key={s.key}>
              <span className={styles.legendDot} style={{ background: `var(--st-${s.key})` }} aria-hidden="true" />
              {s.label} <strong>{p[s.key]}</strong>
            </li>
          ))}
          <li>
            <span className={`${styles.legendDot} ${styles.legendLeft}`} aria-hidden="true" />
            Faltam <strong>{p.left}</strong>
          </li>
          {p.hoursLeft > 0 && <li className={styles.legendHours}>~{hrs(p.hoursLeft)} pela frente (HLTB)</li>}
        </ul>
      )}
    </div>
  );
}

interface Props {
  to: string;
  name: string;
  description: string | null;
  ranked: boolean;
  /** Só na sua tela de listas: a pública não mostra o selo. */
  isPrivate?: boolean;
  games: ListGame[];
}

/** Card da tela de listas: as capas sobrepostas, o nome, quantos jogos e quanto já terminou. */
export function ListCard({ to, name, description, ranked, isPrivate, games }: Props) {
  const p = listProgress(games);
  const covers = mosaic(games);
  return (
    <Link to={to} className={styles.listCard}>
      <span className={styles.mosaic} aria-hidden="true">
        {covers.length ? (
          covers.map((g, i) => (
            <span key={g.id} className={styles.mosaicCover} style={{ zIndex: covers.length - i } as CSSProperties}>
              <GameCover name={g.name} platform={g.platform} cover={g.cover} size="thumb" hideInitials={i > 0} />
            </span>
          ))
        ) : (
          <span className={styles.mosaicEmpty}>Lista vazia</span>
        )}
      </span>
      <span className={styles.listName}>{name}</span>
      <span className={styles.listMeta}>
        {plural(p.total, "jogo", "jogos")}
        {p.total > 0 && ` · ${p.pct}% finalizados`}
        {ranked && <span className={styles.badge}>Ranqueada</span>}
        {isPrivate && <span className={styles.badge}>Privada</span>}
      </span>
      {p.total > 0 && <ProgressBar progress={p} />}
      {description && <span className={styles.listDesc}>{description}</span>}
    </Link>
  );
}
