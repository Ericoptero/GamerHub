import { errorMessage } from "../../api/client";
import { useConfirmLink, useIgnoreLink, useRefreshGame } from "../../api/queries";
import type { ExternalLink, GameDetail, Job } from "../../api/types";
import { Icon } from "../../components/Icon";
import { useToast } from "../../components/Toast";
import { LINK_STATUS_LABEL, PROVIDER_LABEL } from "../../lib/constants";
import { fmtDate } from "../../lib/format";
import { summarizePlatforms } from "../../lib/platforms";
import styles from "./GameDetail.module.css";

interface JobProps {
  job: Job | undefined;
  active: boolean;
  start: (job: Job) => void;
}

function jobLabel(job: Job | undefined, active: boolean): string {
  if (!active || !job) return "Atualizar pela integração";
  if (job.status === "queued") return "Na fila…";
  return job.total > 1 ? `Atualizando ${job.processed}/${job.total}…` : "Atualizando…";
}

/** Reviews de lojas/crítica recolhidas, status das integrações e o botão de atualizar. */
export function StoreReviewsSection({ game, watcher }: { game: GameDetail; watcher: JobProps }) {
  const refresh = useRefreshGame(game.id);
  const toast = useToast();
  const reviews = game.store_reviews;
  const run = (rematch = false) =>
    refresh.mutate(
      { force: true, rematch },
      { onSuccess: watcher.start, onError: (e) => toast.error(`Não consegui atualizar: ${errorMessage(e)}`) },
    );

  return (
    <details className={styles.foldQuiet}>
      <summary>
        Reviews das lojas e da crítica <span style={{ fontWeight: 500, marginLeft: 4 }}>· {reviews.length ? `${reviews.length} importadas` : "nenhuma importada"}</span>
      </summary>
      <div className={styles.reviews}>
        {reviews.map((r) => (
          <div key={r.id} className={styles.storeReview}>
            <div className={styles.storeReviewHead}>
              <span>
                {r.source}
                {r.outlet ? ` · ${r.outlet}` : ""}
                {r.review_date ? ` · ${fmtDate(r.review_date)}` : ""}
              </span>
              <span>{r.score_display}</span>
            </div>
            {r.text && <p className={styles.storeReviewText}>{r.text}</p>}
            {r.url && (
              <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12 }}>
                Ler review completa
              </a>
            )}
          </div>
        ))}
        {!reviews.length && (
          <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
            Nenhuma review de loja importada. Elas ficam aqui, recolhidas, para não competir com a sua.
          </p>
        )}
        {game.links.length > 0 && (
          <div className={styles.links}>
            {game.links.map((l) => (
              <div key={l.provider} className={styles.linkRow}>
                <strong style={{ color: "var(--text-3)" }}>{PROVIDER_LABEL[l.provider] ?? l.provider}</strong>
                <span>· {LINK_STATUS_LABEL[l.status] ?? l.status}</span>
                {l.matched_name && <span>· {l.matched_name}</span>}
                {l.external_url && (
                  <a href={l.external_url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir no ${PROVIDER_LABEL[l.provider] ?? l.provider}`}>
                    <Icon name="external" size={12} />
                  </a>
                )}
                {l.last_error && <span style={{ color: "var(--danger)" }}>· {l.last_error}</span>}
              </div>
            ))}
          </div>
        )}
        <div className="row">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => run(false)} disabled={watcher.active || refresh.isPending} aria-live="polite">
            <Icon name="refresh" size={14} />
            {jobLabel(watcher.job, watcher.active)}
          </button>
          {game.links.length > 0 && !watcher.active && (
            <button type="button" className="btn btn-link" onClick={() => run(true)} disabled={refresh.isPending}>
              Buscar de novo a correspondência
            </button>
          )}
        </div>
      </div>
    </details>
  );
}

/** Card de "Confirmar correspondência" para links ambíguos. */
export function MatchReview({ game, links, watcher }: { game: GameDetail; links: ExternalLink[]; watcher: JobProps }) {
  const confirmLink = useConfirmLink(game.id);
  const ignore = useIgnoreLink(game.id);
  const toast = useToast();
  if (!links.length) return null;

  return (
    <section aria-labelledby="h-match" className={`card ${styles.matchCard}`}>
      <h2 id="h-match" className="section-title">
        Confirmar correspondência
      </h2>
      <p className="lead">
        Achei mais de um candidato para <strong>{game.name}</strong> ({game.platform}). Escolha o certo para trazer os dados.
      </p>
      {links.map((link) => (
        <div key={link.provider} className="field" style={{ gap: 8 }}>
          <span className="eyebrow">{PROVIDER_LABEL[link.provider] ?? link.provider}</span>
          <div className={styles.candidates}>
            {link.candidates.map((c) => (
              <div key={c.external_id} className={styles.candidate}>
                {c.cover_thumb ? (
                  <img className={styles.candidateThumb} src={c.cover_thumb} alt="" loading="lazy" />
                ) : (
                  <span className={styles.candidateThumb} aria-hidden="true" />
                )}
                <span className={styles.candidateInfo}>
                  <span className={styles.candidateName}>
                    {c.name}
                    {c.year ? ` (${c.year})` : ""}
                  </span>
                  <span className={styles.candidateMeta}>
                    {summarizePlatforms(c.platforms)} ·{" "}
                    {Math.round(c.score)}% de semelhança
                  </span>
                </span>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={confirmLink.isPending || watcher.active}
                  onClick={() =>
                    confirmLink.mutate(
                      { provider: link.provider, externalId: c.external_id },
                      { onSuccess: watcher.start, onError: (e) => toast.error(errorMessage(e)) },
                    )
                  }
                >
                  É este
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-link"
            style={{ alignSelf: "flex-start", color: "var(--muted)" }}
            disabled={ignore.isPending}
            onClick={() => ignore.mutate(link.provider, { onError: (e) => toast.error(errorMessage(e)) })}
          >
            Nenhum destes: ignorar {PROVIDER_LABEL[link.provider] ?? link.provider} para este jogo
          </button>
        </div>
      ))}
    </section>
  );
}
