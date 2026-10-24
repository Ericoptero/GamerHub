import { errorMessage } from "../../api/client";
import { useConfirmLink, useIgnoreLink, useMeta, useRefreshGame } from "../../api/queries";
import type { ExternalLink, GameDetail, Job, RefreshIn } from "../../api/types";
import { CandidateList } from "../../components/CandidateList";
import { Icon } from "../../components/Icon";
import { useToast } from "../../components/Toast";
import { PROVIDER_LABEL } from "../../lib/constants";
import { fmtDate } from "../../lib/format";
import { PROVIDERS, ProviderBadges, ProviderRows } from "../integrations/ProviderSearch";
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

/**
 * O que cada integração achou para o jogo. "Trocar"/"Procurar" refazem a busca com o título que você
 * escolher (ou o link da página do jogo); embaixo, atualizar tudo ou buscar de novo pelo nome.
 */
export function IntegrationsSection({ game, watcher }: { game: GameDetail; watcher: JobProps }) {
  const meta = useMeta();
  const refresh = useRefreshGame(game.id);
  const toast = useToast();
  const linked = new Set(game.links.map((l) => l.provider));
  // Integração sem chave só aparece se já tiver algo registrado para o jogo.
  const providers = PROVIDERS.filter((p) => (meta.data?.providers[p] ?? true) || linked.has(p));
  const run = (data: RefreshIn) =>
    refresh.mutate(data, {
      onSuccess: watcher.start,
      onError: (e) => toast.error(`Não consegui atualizar: ${errorMessage(e)}`),
    });

  return (
    <details className={styles.foldQuiet}>
      <summary className={styles.integrationsSummary}>
        Integrações
        <ProviderBadges providers={providers} links={game.links} />
      </summary>
      <div className={styles.integrations}>
        <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
          Jogo errado ou não achou? Em “Trocar” ou “Procurar”, busque por outro título ou cole o link da página do jogo
          no site da integração.
        </p>
        <ProviderRows
          gameId={game.id}
          gameName={game.name}
          providers={providers}
          links={game.links}
          watcher={watcher}
          onRetry={(p) => run({ providers: [p], rematch: true, force: false })}
          retrying={refresh.isPending}
        />
        <div className="row">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => run({ force: true, rematch: false })}
            disabled={watcher.active || refresh.isPending}
            aria-live="polite"
          >
            <Icon name="refresh" size={14} />
            {jobLabel(watcher.job, watcher.active)}
          </button>
          {game.links.length > 0 && !watcher.active && (
            <button
              type="button"
              className="btn btn-link"
              onClick={() => run({ force: true, rematch: true })}
              disabled={refresh.isPending}
            >
              Buscar de novo a correspondência pelo nome
            </button>
          )}
        </div>
      </div>
    </details>
  );
}

/** Reviews de lojas e da crítica, recolhidas para não competir com a sua. */
export function StoreReviewsSection({ game }: { game: GameDetail }) {
  const reviews = game.store_reviews;

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
          <CandidateList
            candidates={link.candidates}
            disabled={confirmLink.isPending || watcher.active}
            onPick={(c) =>
              confirmLink.mutate(
                { provider: link.provider, externalId: c.external_id },
                { onSuccess: watcher.start, onError: (e) => toast.error(errorMessage(e)) },
              )
            }
          />
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
