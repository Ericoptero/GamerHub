import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";

import { errorMessage } from "../../api/client";
import {
  keys,
  useConfirmLink,
  useExternalSearch,
  useGame,
  useIgnoreLink,
  useMeta,
  usePending,
  usePlatforms,
  useRefreshGame,
  useUpdateGame,
} from "../../api/queries";
import type { ExternalLink, GamePatch, Job, PendingGame, ProviderName } from "../../api/types";
import { CandidateList, type CandidateLike } from "../../components/CandidateList";
import { Icon } from "../../components/Icon";
import { useToast } from "../../components/Toast";
import { useJobWatcher } from "../../components/useJobWatcher";
import { PROVIDER_LABEL } from "../../lib/constants";
import { initials, palette } from "../../lib/cover";
import { fold } from "../../lib/text";
import { EditGameDialog } from "../game-detail/EditGameDialog";
import styles from "./PendingCard.module.css";

const PROVIDERS: ProviderName[] = ["igdb", "rawg", "hltb", "metacritic"];
const PAGE = 20;
const MAX_RESULTS = 8;

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

const isOpen = (s: LinkState) => s === "ambiguous" || s === "not_found" || s === "error";

interface Watcher {
  start: (job: Job) => void;
  active: boolean;
}

export function PendingCard() {
  const [provider, setProvider] = useState<"" | ProviderName>("");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const pending = usePending(provider || undefined);
  const meta = useMeta();
  const watcher = useJobWatcher();
  const needle = fold(q);
  const items = (pending.data ?? []).filter((g) => !needle || fold(g.name).includes(needle));
  const enabled = (p: ProviderName) => meta.data?.providers[p] ?? true;

  return (
    <section aria-labelledby="h-pend" className="card">
      <h2 id="h-pend" className="section-title">
        Precisa da sua ajuda <span className="count">{pending.data ? items.length : ""}</span>
      </h2>
      <p className="lead">
        Jogos em que alguma integração ficou em dúvida, não achou nada ou deu erro, cada um num card só. Escolha o
        resultado certo, procure por outro nome (ex.: o título em inglês) ou corrija as informações do jogo e busque de
        novo.
      </p>
      <div className={styles.filters}>
        <div role="group" aria-label="Filtrar por integração" className="row" style={{ gap: 6 }}>
          {(["", ...PROVIDERS] as const).map((p) => (
            <button
              key={p || "all"}
              type="button"
              className="pill"
              aria-pressed={provider === p}
              onClick={() => {
                setProvider(p);
                setShown(PAGE);
              }}
            >
              {p ? PROVIDER_LABEL[p] : "Todas"}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="input"
          aria-label="Filtrar jogos pelo nome"
          placeholder="Filtrar pelo nome"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {pending.isError && <p className="error-text">{errorMessage(pending.error)}</p>}
      {pending.data && items.length === 0 && <div className="notice">Nada pendente.</div>}
      <div className={styles.list}>
        {items.slice(0, shown).map((g) => (
          <PendingGameCard key={g.game_id} game={g} watcher={watcher} enabled={enabled} />
        ))}
      </div>
      {items.length > shown && (
        <button type="button" className="btn" style={{ alignSelf: "center" }} onClick={() => setShown((n) => n + PAGE)}>
          Mostrar mais ({items.length - shown} restantes)
        </button>
      )}
    </section>
  );
}

function PendingGameCard({
  game,
  watcher,
  enabled,
}: {
  game: PendingGame;
  watcher: Watcher;
  enabled: (p: ProviderName) => boolean;
}) {
  const [editing, setEditing] = useState(false);
  const refresh = useRefreshGame(game.game_id);
  const toast = useToast();
  const byProvider = new Map(game.links.map((l) => [l.provider, l]));
  // Integração sem chave só aparece se já tiver algo registrado para o jogo.
  const providers = PROVIDERS.filter((p) => enabled(p) || byProvider.has(p));
  const open = providers.filter((p) => isOpen(linkState(byProvider.get(p))));
  const year = game.release_date?.slice(0, 4);
  const [bg, band] = palette(game.name, game.platform);

  const searchAgain = (which: ProviderName[]) =>
    refresh.mutate(
      { providers: which, rematch: true, force: false },
      {
        onSuccess: (job) => {
          watcher.start(job);
          toast.show(`Buscando ${game.name} de novo…`);
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  return (
    <article className={styles.game} aria-labelledby={`pg-${game.game_id}`}>
      <div className={styles.head}>
        {game.cover ? (
          <img className={styles.thumb} src={game.cover} alt="" loading="lazy" />
        ) : (
          <span className={styles.thumb} style={{ background: bg, borderTop: `3px solid ${band}` }} aria-hidden="true">
            {initials(game.name)}
          </span>
        )}
        <div className={styles.title}>
          <Link id={`pg-${game.game_id}`} to={`/jogos/${game.game_id}`} className={styles.name}>
            {game.name}
          </Link>
          <span className="muted">{[game.platform, year].filter(Boolean).join(" · ")}</span>
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
        </div>
        <div className={styles.actions}>
          <button type="button" className="btn btn-sm" aria-expanded={editing} onClick={() => setEditing((e) => !e)}>
            <Icon name="edit" size={14} /> Editar informações
          </button>
          {open.length > 0 && (
            <button
              type="button"
              className="btn btn-sm"
              disabled={refresh.isPending || watcher.active}
              onClick={() => searchAgain(open)}
            >
              <Icon name="refresh" size={14} /> Buscar de novo
            </button>
          )}
        </div>
      </div>

      {editing && (
        <QuickEdit
          game={game}
          onClose={() => setEditing(false)}
          onSearchAgain={() => searchAgain(open.length ? open : providers)}
        />
      )}

      <div className={styles.providers}>
        {providers.map((p) => (
          <ProviderRow
            key={p}
            game={game}
            provider={p}
            link={byProvider.get(p)}
            watcher={watcher}
            onRetry={() => searchAgain([p])}
            retrying={refresh.isPending}
          />
        ))}
      </div>
    </article>
  );
}

function ProviderRow({
  game,
  provider,
  link,
  watcher,
  onRetry,
  retrying,
}: {
  game: PendingGame;
  provider: ProviderName;
  link: ExternalLink | undefined;
  watcher: Watcher;
  onRetry: () => void;
  retrying: boolean;
}) {
  const state = linkState(link);
  const [expanded, setExpanded] = useState(isOpen(state));
  const [query, setQuery] = useState(game.name);
  const [submitted, setSubmitted] = useState("");
  const confirm = useConfirmLink(game.game_id);
  const ignore = useIgnoreLink(game.game_id);
  const results = useExternalSearch(provider, submitted, null, game.game_id);
  const toast = useToast();
  const label = PROVIDER_LABEL[provider];
  const busy = confirm.isPending || watcher.active;

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
              aria-label={`Procurar no ${label} por outro nome`}
              placeholder="Outro nome (ex.: título em inglês)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              minLength={2}
            />
            <button type="submit" className="btn btn-sm" disabled={query.trim().length < 2}>
              <Icon name="search" size={14} /> Procurar
            </button>
          </form>
          {submitted && results.isFetching && (
            <p className="muted" role="status" style={{ margin: 0 }}>
              Procurando “{submitted}” no {label}…
            </p>
          )}
          {submitted && results.isError && <p className="error-text">{errorMessage(results.error)}</p>}
          {submitted && results.data && !results.isFetching && results.data.length === 0 && (
            <p className="muted" style={{ margin: 0 }}>
              Nada encontrado com “{submitted}”.
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

/** Nome, plataforma e lançamento: o que a busca usa. "Mais campos…" abre o editor completo. */
function QuickEdit({
  game,
  onClose,
  onSearchAgain,
}: {
  game: PendingGame;
  onClose: () => void;
  onSearchAgain: () => void;
}) {
  const qc = useQueryClient();
  const platforms = usePlatforms();
  const update = useUpdateGame(game.game_id);
  const toast = useToast();
  const [name, setName] = useState(game.name);
  const [platformId, setPlatformId] = useState(game.platform_id);
  const [release, setRelease] = useState(game.release_date ?? "");
  const [full, setFull] = useState(false);
  const detail = useGame(full ? game.game_id : Number.NaN);

  const save = (thenSearch: boolean) => {
    const patch: GamePatch = {};
    if (name.trim() && name.trim() !== game.name) patch.name = name.trim();
    if (platformId !== game.platform_id) patch.platform_id = platformId;
    if ((release || null) !== game.release_date) patch.release_date = release || null;
    const done = () => {
      qc.invalidateQueries({ queryKey: keys.pending });
      if (thenSearch) onSearchAgain();
      onClose();
    };
    if (!Object.keys(patch).length) return done();
    update.mutate(patch, {
      onSuccess: () => {
        toast.show(`${patch.name ?? game.name}: informações salvas.`, "ok");
        done();
      },
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  return (
    <form
      className={styles.edit}
      onSubmit={(e) => {
        e.preventDefault();
        save(true);
      }}
      aria-label={`Editar ${game.name}`}
    >
      <div className="field-grid">
        <label className="field">
          Nome
          <input className="input" required maxLength={300} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          Plataforma
          <select className="select" value={platformId} onChange={(e) => setPlatformId(Number(e.target.value))}>
            {(platforms.data ?? [{ id: game.platform_id, name: game.platform }]).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Lançamento
          <input className="input" type="date" value={release} onChange={(e) => setRelease(e.target.value)} />
        </label>
      </div>
      <div className="row">
        <button
          type="button"
          className="btn btn-link"
          onClick={() => setFull(true)}
          disabled={full && detail.isPending}
        >
          Mais campos…
        </button>
        <span style={{ marginLeft: "auto" }} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Cancelar
        </button>
        <button type="button" className="btn btn-sm" onClick={() => save(false)} disabled={update.isPending}>
          Salvar
        </button>
        <button type="submit" className="btn btn-sm btn-primary" disabled={update.isPending}>
          Salvar e buscar de novo
        </button>
      </div>
      {full && detail.data && (
        <EditGameDialog
          game={detail.data}
          open
          onClose={() => {
            setFull(false);
            qc.invalidateQueries({ queryKey: keys.pending });
            onClose();
          }}
        />
      )}
    </form>
  );
}
