// O que cada integração achou para um jogo e a busca manual: outro nome ou o link da página do jogo.
// Usado no "Precisa da sua ajuda" e na seção "Integrações" do detalhe.
import { useState, type FormEvent } from "react";

import { errorMessage } from "../../api/client";
import { useConfirmLink, useExternalSearch, useIgnoreLink } from "../../api/queries";
import type { ExternalLink, Job, ProviderName } from "../../api/types";
import { CandidateList, type CandidateLike } from "../../components/CandidateList";
import { Icon } from "../../components/Icon";
import { useToast } from "../../components/Toast";
import { PROVIDER_LABEL } from "../../lib/constants";
import styles from "./ProviderSearch.module.css";

export const PROVIDERS: ProviderName[] = ["igdb", "rawg", "hltb", "metacritic"];
const MAX_RESULTS = 8;

/** Exemplo do link que a busca de cada integração aceita. */
const LINK_EXAMPLE: Record<ProviderName, string> = {
  igdb: "igdb.com/games/hollow-knight",
  rawg: "rawg.io/games/hollow-knight",
  hltb: "howlongtobeat.com/game/26286",
  metacritic: "metacritic.com/game/hollow-knight",
};

const isLink = (q: string) => /^\s*(https?:\/\/|www\.)|\.(com|io)\//i.test(q);

type LinkState = "ok" | "ambiguous" | "not_found" | "error" | "ignored" | "missing";

const STATE: Record<LinkState, { mark: string; label: string }> = {
  ok: { mark: "✓", label: "encontrado" },
  ambiguous: { mark: "?", label: "escolha o certo" },
  not_found: { mark: "✗", label: "não achou" },
  error: { mark: "!", label: "erro" },
  ignored: { mark: "–", label: "ignorado" },
  missing: { mark: "·", label: "ainda não buscado" },
};

function linkState(link: ExternalLink | undefined): LinkState {
  if (!link) return "missing";
  if (link.status === "matched" || link.status === "confirmed") return "ok";
  return link.status;
}

/** Integração que precisa de alguém: em dúvida, sem resultado ou com erro. */
export const needsHelp = (link: ExternalLink | undefined) => {
  const s = linkState(link);
  return s === "ambiguous" || s === "not_found" || s === "error";
};

export interface Watcher {
  start: (job: Job) => void;
  active: boolean;
}

/** "✓ IGDB ✗ HLTB…": uma etiqueta por integração. */
export function ProviderBadges({ providers, links }: { providers: ProviderName[]; links: ExternalLink[] }) {
  const byProvider = new Map(links.map((l) => [l.provider, l]));
  return (
    <span className={styles.badges}>
      {providers.map((p) => {
        const s = linkState(byProvider.get(p));
        return (
          <span key={p} className={styles.badge} data-state={s} title={`${PROVIDER_LABEL[p]}: ${STATE[s].label}`}>
            <span aria-hidden="true">{STATE[s].mark}</span> {PROVIDER_LABEL[p]}
            <span className="sr-only">: {STATE[s].label}</span>
          </span>
        );
      })}
    </span>
  );
}

/** Uma linha por integração, com trocar/procurar/ignorar. `onRetry` busca de novo pelo nome do jogo. */
export function ProviderRows({
  gameId,
  gameName,
  providers,
  links,
  watcher,
  onRetry,
  retrying,
}: {
  gameId: number;
  gameName: string;
  providers: ProviderName[];
  links: ExternalLink[];
  watcher: Watcher;
  onRetry: (provider: ProviderName) => void;
  retrying: boolean;
}) {
  const byProvider = new Map(links.map((l) => [l.provider, l]));
  return (
    <div className={styles.providers}>
      {providers.map((p) => (
        <ProviderRow
          key={p}
          gameId={gameId}
          gameName={gameName}
          provider={p}
          link={byProvider.get(p)}
          watcher={watcher}
          onRetry={() => onRetry(p)}
          retrying={retrying}
        />
      ))}
    </div>
  );
}

function ProviderRow({
  gameId,
  gameName,
  provider,
  link,
  watcher,
  onRetry,
  retrying,
}: {
  gameId: number;
  gameName: string;
  provider: ProviderName;
  link: ExternalLink | undefined;
  watcher: Watcher;
  onRetry: () => void;
  retrying: boolean;
}) {
  const state = linkState(link);
  const [expanded, setExpanded] = useState(needsHelp(link));
  const [query, setQuery] = useState(gameName);
  const [submitted, setSubmitted] = useState("");
  const confirm = useConfirmLink(gameId);
  const ignore = useIgnoreLink(gameId);
  const results = useExternalSearch(provider, submitted, null, gameId);
  const toast = useToast();
  const label = PROVIDER_LABEL[provider];
  const busy = confirm.isPending || watcher.active;
  const byLink = isLink(submitted);

  const pick = (c: CandidateLike) =>
    confirm.mutate(
      { provider, externalId: c.external_id, name: c.name, url: c.url ?? null, score: c.score },
      {
        onSuccess: (job) => {
          watcher.start(job);
          toast.show(`${label}: ${c.name} confirmado. Buscando os dados…`, "ok");
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  const search = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(query.trim());
  };

  const summary =
    state === "ok"
      ? null
      : state === "error"
        ? link?.last_error || "A busca deu erro."
        : state === "not_found"
          ? "Nenhum resultado com o nome do jogo."
          : state === "ambiguous"
            ? "Mais de um resultado parecido."
            : state === "ignored"
              ? "Você ignorou esta integração para o jogo."
              : "Ainda não buscado.";

  return (
    <div className={styles.provider} data-state={state}>
      <div className={styles.providerHead}>
        <span className={styles.providerName}>
          <span className={styles.mark} data-state={state} aria-hidden="true">
            {STATE[state].mark}
          </span>
          {label}
        </span>
        <span className={styles.providerSummary}>
          {state === "ok" && link ? (
            link.external_url ? (
              <a href={link.external_url} target="_blank" rel="noopener noreferrer">
                {link.matched_name || link.external_id} <Icon name="external" size={12} />
              </a>
            ) : (
              (link.matched_name ?? link.external_id)
            )
          ) : (
            summary
          )}
        </span>
        <span className={styles.providerActions}>
          {(state === "ignored" || state === "missing") && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={onRetry} disabled={retrying || busy}>
              {state === "missing" ? "Buscar" : "Buscar de novo"}
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            aria-expanded={expanded}
            onClick={() => setExpanded((x) => !x)}
          >
            {expanded ? "Fechar" : state === "ok" ? "Trocar" : "Procurar"}
          </button>
          {state !== "ignored" && state !== "ok" && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              disabled={ignore.isPending}
              onClick={() => ignore.mutate(provider, { onError: (e) => toast.error(errorMessage(e)) })}
              title={`Não buscar mais no ${label} para este jogo`}
            >
              Ignorar
            </button>
          )}
        </span>
      </div>

      {expanded && (
        <div className={styles.providerBody}>
          {state !== "ok" && link && link.candidates.length > 0 && (
            <CandidateList candidates={link.candidates} onPick={pick} disabled={busy} />
          )}
          <form className={styles.search} onSubmit={search} role="search" aria-label={`Procurar no ${label}`}>
            <input
              className="input"
              aria-label={`Procurar no ${label} por outro nome ou pelo link do jogo`}
              aria-describedby={`dica-${gameId}-${provider}`}
              placeholder="Outro nome ou link da página do jogo"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              minLength={2}
            />
            <button type="submit" className="btn btn-sm" disabled={query.trim().length < 2}>
              <Icon name="search" size={14} /> Procurar
            </button>
          </form>
          <p id={`dica-${gameId}-${provider}`} className={styles.hint}>
            Ex.: o título em inglês, ou o link <span className={styles.example}>{LINK_EXAMPLE[provider]}</span>
          </p>
          {submitted && results.isFetching && (
            <p className="muted" role="status" style={{ margin: 0 }}>
              {byLink ? `Abrindo o link no ${label}…` : `Procurando “${submitted}” no ${label}…`}
            </p>
          )}
          {submitted && results.isError && <p className="error-text">{errorMessage(results.error)}</p>}
          {submitted && results.data && !results.isFetching && results.data.length === 0 && (
            <p className="muted" style={{ margin: 0 }}>
              {byLink ? `Esse link não abriu nenhum jogo no ${label}.` : `Nada encontrado com “${submitted}”.`}
            </p>
          )}
          {submitted && results.data && results.data.length > 0 && (
            <CandidateList candidates={results.data.slice(0, MAX_RESULTS)} onPick={pick} disabled={busy} />
          )}
        </div>
      )}
    </div>
  );
}
