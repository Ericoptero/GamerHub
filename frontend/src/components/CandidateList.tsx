import { summarizePlatforms } from "../lib/platforms";
import styles from "./CandidateList.module.css";

/** O mínimo que um candidato de integração tem (salvo no link ou vindo de uma busca). */
export interface CandidateLike {
  external_id: string;
  name: string;
  year: number | null;
  platforms: string[];
  cover_thumb: string | null;
  score: number;
  url?: string | null;
}

interface Props<C extends CandidateLike> {
  candidates: C[];
  onPick: (c: C) => void;
  disabled?: boolean;
  pickLabel?: string;
}

/** Lista de candidatos com "É este" (confirmar correspondência no jogo e no Precisa da sua ajuda). */
export function CandidateList<C extends CandidateLike>({
  candidates,
  onPick,
  disabled,
  pickLabel = "É este",
}: Props<C>) {
  return (
    <div className={styles.list}>
      {candidates.map((c) => (
        <div key={c.external_id} className={styles.item}>
          {c.cover_thumb ? (
            <img className={styles.thumb} src={c.cover_thumb} alt="" loading="lazy" />
          ) : (
            <span className={styles.thumb} aria-hidden="true" />
          )}
          <span className={styles.info}>
            <span className={styles.name}>
              {c.url ? (
                <a href={c.url} target="_blank" rel="noopener noreferrer">
                  {c.name}
                </a>
              ) : (
                c.name
              )}
              {c.year ? ` (${c.year})` : ""}
            </span>
            <span className={styles.meta}>
              {[c.platforms.length ? summarizePlatforms(c.platforms) : "", `${Math.round(c.score)}% de semelhança`]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
          <button
            type="button"
            className="btn btn-sm"
            disabled={disabled}
            onClick={() => onPick(c)}
            aria-label={`${pickLabel}: ${c.name}${c.year ? ` (${c.year})` : ""}`}
          >
            {pickLabel}
          </button>
        </div>
      ))}
    </div>
  );
}
