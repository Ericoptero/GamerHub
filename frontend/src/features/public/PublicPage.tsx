import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { ApiError } from "../../api/client";
import { useMe, usePublicProfile } from "../../api/queries";
import type { PublicGameCard, PublicProfile } from "../../api/types";
import { GameCover } from "../../components/GameCover";
import { Icon } from "../../components/Icon";
import layout from "../../components/Layout.module.css";
import { ErrorState, LoadingState } from "../../components/NotFound";
import { STATUS, STATUS1, STATUS_DOT, mcColor } from "../../lib/constants";
import { fmtDate, hrs, plural } from "../../lib/format";
import { TagPicker } from "../library/FilterPanel";
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
  const profile = usePublicProfile(username);
  const me = useMe();
  const isOwner = !!me.data?.user && me.data.user.username.toLowerCase() === username.toLowerCase();

  useEffect(() => {
    if (!profile.data) return;
    const previous = document.title;
    document.title = `${profile.data.display_name} · Backlog`;
    return () => {
      document.title = previous;
    };
  }, [profile.data]);

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
        <PublicLibrary profile={profile.data} />
      )}
    </div>
  );
}

function PublicLibrary({ profile }: { profile: PublicProfile }) {
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

      <div role="group" aria-label="Listas" className={styles.tabs}>
        {PUBLIC_TABS.filter((t) => t === "all" || counts[t] > 0).map((t) => (
          <button
            key={t}
            type="button"
            className="pill"
            aria-pressed={f.tab === t}
            onClick={() => patch({ tab: t, sort: defaultPublicSort(t) })}
          >
            {t !== "all" && <span className={styles.dot} style={{ background: STATUS_DOT[t] }} aria-hidden="true" />}
            {tabLabel(t)}
            <span className={styles.count}>{counts[t]}</span>
          </button>
        ))}
      </div>

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
    </main>
  );
}

function tabLabel(t: PublicTab): string {
  return t === "all" ? "Todos" : STATUS[t];
}

function PublicCard({ game: g, showStatus }: { game: PublicGameCard; showStatus: boolean }) {
  const played = g.status === "done" || g.status === "dropped";
  const timeLabel = played
    ? g.played_hours
      ? `${hrs(g.played_hours)} jogadas`
      : "—"
    : g.hltb_main_hours
      ? (hrs(g.hltb_main_hours) ?? "")
      : "HLTB —";
  const finished = g.status === "done" ? (g.finished_at ? fmtDate(g.finished_at) : g.finished_label) : null;
  const meta = [showStatus ? STATUS1[g.status] : null, g.platform, finished].filter(Boolean).join(" · ");
  return (
    <li className={styles.card}>
      <GameCover
        name={g.name}
        platform={g.platform}
        cover={g.cover}
        footer={{
          left: timeLabel,
          right: g.metacritic_score !== null ? `MC ${g.metacritic_score}` : "MC —",
          rightColor: mcColor(g.metacritic_score),
        }}
      />
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
