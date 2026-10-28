import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { ApiError } from "../../api/client";
import { useMe, usePublicProfile } from "../../api/queries";
import type { PublicGameCard, PublicProfile } from "../../api/types";
import { AccessBadge } from "../../components/AccessBadge";
import { GameCover } from "../../components/GameCover";
import { Icon } from "../../components/Icon";
import layout from "../../components/Layout.module.css";
import { ErrorState, LoadingState } from "../../components/NotFound";
import { STATUS, STATUS1, STATUS_DOT, mcColor } from "../../lib/constants";
import { fmtDate, plural } from "../../lib/format";
import { TagPicker } from "../library/FilterPanel";
import { timeLabel } from "../library/cardInfo";
import { ListCard } from "../lists/ListCard";
import { resolveGames } from "../lists/lists";
import styles from "./PublicPage.module.css";
import {
  PUBLIC_SORTS,
  PUBLIC_TABS,
  defaultPublicSort,
  filterPublic,
  firstTab,
  inPublicTab,
  parsePublicFilters,
  serializePublicFilters,
  statusCounts,
  tagFacets,
  type PublicFilters,
  type PublicSort,
  type PublicTab,
} from "./publicFilters";

/** /<username>: a lista de jogos de alguém, só leitura e sem login. */
export function PublicPage() {
  const { username = "" } = useParams();
  return <PublicShell username={username}>{(profile) => <PublicLibrary profile={profile} />}</PublicShell>;
}

/** Cabeçalho, carregamento e "página não encontrada" das páginas públicas (a pessoa e as listas dela). */
export function PublicShell({
  username,
  title,
  children,
}: {
  username: string;
  title?: (profile: PublicProfile) => string;
  children: (profile: PublicProfile) => ReactNode;
}) {
  const profile = usePublicProfile(username);
  const me = useMe();
  const isOwner = !!me.data?.user && me.data.user.username.toLowerCase() === username.toLowerCase();

  const docTitle = profile.data ? (title ? title(profile.data) : `${profile.data.display_name} · Backlog`) : null;
  useEffect(() => {
    if (!docTitle) return;
    const previous = document.title;
    document.title = docTitle;
    return () => {
      document.title = previous;
    };
  }, [docTitle]);

  return (
    <div className={layout.shell}>
      <header className={layout.header}>
        <Link to="/" className={layout.brand} aria-label="GamerHub">
          <span className={layout.logo}>
            <Icon name="logo" size={18} />
          </span>
          <span className={layout.brandText}>Backlog</span>
        </Link>
        {isOwner && (
          <Link to="/configuracoes" className={`btn btn-sm btn-ghost ${styles.ownerLink}`}>
            <Icon name="edit" size={14} /> Configurar página
          </Link>
        )}
      </header>
      {profile.isPending ? (
        <LoadingState />
      ) : profile.isError ? (
        profile.error instanceof ApiError && profile.error.status === 404 ? (
          <main className="page page-narrow">
            <div className="notice">
              <p style={{ margin: "0 0 8px", fontWeight: 700, color: "var(--text)" }}>Página não encontrada</p>
              Não existe uma lista pública em <code>/{username}</code>. O endereço pode estar errado ou a pessoa
              desligou a página.
            </div>
          </main>
        ) : (
          <ErrorState error={profile.error} onRetry={() => profile.refetch()} />
        )
      ) : (
        children(profile.data)
      )}
    </div>
  );
}

const SHOW_LISTS = "listas";

function PublicLibrary({ profile }: { profile: PublicProfile }) {
  const [sp, setSp] = useSearchParams();
  // ?ver=listas troca os cards dos jogos pelos das listas públicas; escolher um status volta aos jogos.
  const showLists = sp.get("ver") === SHOW_LISTS && profile.lists.length > 0;
  const counts = useMemo(() => statusCounts(profile.games), [profile.games]);
  const fallback = firstTab(counts);
  const f = parsePublicFilters(sp, fallback);
  const set = (next: PublicFilters) => setSp(serializePublicFilters(next, fallback), { replace: true });
  const patch = (p: Partial<PublicFilters>) => set({ ...f, ...p });

  const summary = [
    plural(counts.all, "jogo", "jogos"),
    counts.playing && `${counts.playing} jogando`,
    counts.done && `${plural(counts.done, "finalizado", "finalizados")}`,
    counts.backlog && `${counts.backlog} na fila`,
  ].filter(Boolean);

  return (
    <main className="page page-wide">
      <div className="page-head">
        <span className="eyebrow">Lista de jogos</span>
        <h1 className="page-title">{profile.display_name}</h1>
        <p className="lead">
          @{profile.username} · {summary.join(" · ")}
        </p>
      </div>

      <div role="group" aria-label="Status e listas" className={styles.tabs}>
        {PUBLIC_TABS.filter((t) => t === "all" || counts[t] > 0).map((t) => (
          <button
            key={t}
            type="button"
            className="pill"
            aria-pressed={!showLists && f.tab === t}
            onClick={() => patch({ tab: t, sort: defaultPublicSort(t) })}
          >
            {t !== "all" && <span className={styles.dot} style={{ background: STATUS_DOT[t] }} aria-hidden="true" />}
            {tabLabel(t)}
            <span className={styles.count}>{counts[t]}</span>
          </button>
        ))}
        {profile.lists.length > 0 && (
          <button
            type="button"
            className="pill"
            aria-pressed={showLists}
            onClick={() => setSp({ ver: SHOW_LISTS }, { replace: true })}
          >
            <Icon name="lists" size={14} />
            Listas
            <span className={styles.count}>{profile.lists.length}</span>
          </button>
        )}
      </div>

      {showLists ? <PublicLists profile={profile} /> : <PublicGames profile={profile} />}
    </main>
  );
}

function PublicLists({ profile }: { profile: PublicProfile }) {
  const byId = useMemo(() => new Map(profile.games.map((g) => [g.id, g])), [profile.games]);
  return (
    <div className={styles.lists}>
      {profile.lists.map((l) => (
        <ListCard
          key={l.id}
          to={`/${profile.username}/listas/${l.id}`}
          name={l.name}
          description={l.description}
          ranked={l.ranked}
          games={resolveGames(l.game_ids, byId)}
        />
      ))}
    </div>
  );
}

function PublicGames({ profile }: { profile: PublicProfile }) {
  const [sp, setSp] = useSearchParams();
  const counts = useMemo(() => statusCounts(profile.games), [profile.games]);
  const fallback = firstTab(counts);
  const f = parsePublicFilters(sp, fallback);
  const set = (next: PublicFilters) => setSp(serializePublicFilters(next, fallback), { replace: true });
  const patch = (p: Partial<PublicFilters>) => set({ ...f, ...p });

  const { tab, q, sort } = f;
  const tagKey = f.tags.join("\n");
  const inTab = useMemo(() => inPublicTab(profile.games, { tab, q }), [profile.games, tab, q]);
  const list = useMemo(
    () => filterPublic(profile.games, { tab, q, sort, tags: tagKey ? tagKey.split("\n") : [] }),
    [profile.games, tab, q, sort, tagKey],
  );
  const tags = useMemo(() => tagFacets(inTab), [inTab]);
  const [tagsOpen, setTagsOpen] = useState(f.tags.length > 0);
  const toggleTag = (t: string) => patch({ tags: f.tags.includes(t) ? f.tags.filter((x) => x !== t) : [...f.tags, t] });

  return (
    <>

      <div className={styles.toolbar}>
        <div className={styles.search}>
          <Icon name="search" size={16} className={styles.searchIcon} />
          <input
            type="search"
            aria-label="Buscar jogo"
            placeholder="Buscar jogo"
            className="input input-raised"
            value={f.q}
            onChange={(e) => patch({ q: e.target.value })}
          />
        </div>
        <label className={styles.inline}>
          Ordenar
          <select
            className="select input-raised"
            value={f.sort}
            onChange={(e) => patch({ sort: e.target.value as PublicSort })}
          >
            {(Object.keys(PUBLIC_SORTS) as PublicSort[]).map((k) => (
              <option key={k} value={k}>
                {PUBLIC_SORTS[k]}
              </option>
            ))}
          </select>
        </label>
        {tags.length > 0 && (
          <button
            type="button"
            className={`btn ${tagsOpen ? "btn-primary" : ""} ${styles.tagsBtn}`}
            aria-expanded={tagsOpen}
            aria-controls="tags-publicas"
            onClick={() => setTagsOpen((o) => !o)}
          >
            <Icon name="filter" size={14} /> Tags
            {f.tags.length > 0 && <span className={styles.badge}>{f.tags.length}</span>}
          </button>
        )}
      </div>

      {tagsOpen && tags.length > 0 && (
        <div id="tags-publicas" className={styles.tagPanel}>
          <TagPicker tags={tags} selected={f.tags} onToggle={toggleTag} />
        </div>
      )}

      {f.tags.length > 0 && (
        <div className={styles.chips}>
          {f.tags.map((t) => (
            <button
              key={t}
              type="button"
              className={styles.chip}
              onClick={() => toggleTag(t)}
              aria-label={`Tirar a tag ${t}`}
            >
              #{t} <Icon name="close" size={12} />
            </button>
          ))}
          <button type="button" className="btn btn-link" onClick={() => patch({ tags: [] })}>
            Limpar tags
          </button>
        </div>
      )}

      <p className="muted" style={{ margin: 0, fontSize: 12 }} aria-live="polite">
        {plural(list.length, "jogo", "jogos")}
        {f.tab !== "all" ? ` em ${tabLabel(f.tab)}` : ""}
      </p>
      {list.length ? (
        <ul className={styles.grid}>
          {list.map((g) => (
            <PublicCard key={g.id} game={g} showStatus={f.tab === "all"} />
          ))}
        </ul>
      ) : (
        <div className="notice">Nenhum jogo com esse filtro.</div>
      )}
    </>
  );
}

function tabLabel(t: PublicTab): string {
  return t === "all" ? "Todos" : STATUS[t];
}

export function PublicCard({ game: g, showStatus, rank }: { game: PublicGameCard; showStatus: boolean; rank?: number }) {
  const finished = g.status === "done" ? (g.finished_at ? fmtDate(g.finished_at) : g.finished_label) : null;
  const meta = [showStatus ? STATUS1[g.status] : null, g.platform, finished].filter(Boolean).join(" · ");
  return (
    <li className={styles.card}>
      <GameCover
        name={g.name}
        platform={g.platform}
        cover={g.cover}
        badge={g.access !== "owned" && <AccessBadge access={g.access} releaseDate={g.release_date} />}
        footer={{
          left: timeLabel(g),
          right: g.metacritic_score !== null ? `MC ${g.metacritic_score}` : "MC —",
          rightColor: mcColor(g.metacritic_score),
        }}
      />
      {rank !== undefined && (
        <span className={styles.rank} aria-label={`Posição ${rank}`}>
          #{rank}
        </span>
      )}
      <span className={styles.cardName}>
        {showStatus && <span className={styles.dot} style={{ background: STATUS_DOT[g.status] }} aria-hidden="true" />}
        <span className={styles.cardText} title={g.name}>
          {g.name}
        </span>
        {g.user_score !== null && (
          <span className={styles.userScore} title={`Nota: ${g.user_score}/10`}>
            <Icon name="star" size={11} strokeWidth={0} fill="currentColor" />
            {g.user_score}
          </span>
        )}
      </span>
      <span className={styles.meta} title={g.tags.length ? g.tags.join(", ") : undefined}>
        {meta}
      </span>
    </li>
  );
}
