import { useMemo } from "react";
import { Link, useParams } from "react-router";

import type { PublicList, PublicProfile } from "../../api/types";
import { Icon } from "../../components/Icon";
import { plural } from "../../lib/format";
import { ProgressBar } from "../lists/ListCard";
import { listProgress, resolveGames } from "../lists/lists";
import lists from "../lists/Lists.module.css";
import { PublicCard, PublicShell } from "./PublicPage";
import styles from "./PublicPage.module.css";

/** /<username>/listas/<id>: uma lista pública, na ordem dela, com o progresso. */
export function PublicListPage() {
  const { username = "", listId } = useParams();
  const title = (p: PublicProfile) => {
    const list = p.lists.find((l) => l.id === Number(listId));
    return list ? `${list.name} · ${p.display_name}` : `${p.display_name} · Backlog`;
  };
  return (
    <PublicShell username={username} title={title}>
      {(profile) => {
        const list = profile.lists.find((l) => l.id === Number(listId));
        return list ? (
          <PublicListView profile={profile} list={list} />
        ) : (
          <main className="page page-narrow">
            <div className="notice">
              <p style={{ margin: "0 0 8px", fontWeight: 700, color: "var(--text)" }}>Lista não encontrada</p>
              Ela pode ter sido excluída ou deixado de ser pública.{" "}
              <Link to={`/${profile.username}?ver=listas`}>Ver as listas de {profile.display_name}</Link>
            </div>
          </main>
        );
      }}
    </PublicShell>
  );
}

function PublicListView({ profile, list }: { profile: PublicProfile; list: PublicList }) {
  const byId = useMemo(() => new Map(profile.games.map((g) => [g.id, g])), [profile.games]);
  const games = useMemo(() => resolveGames(list.game_ids, byId), [list.game_ids, byId]);
  const progress = listProgress(games);
  return (
    <main className="page page-wide">
      <Link to={`/${profile.username}?ver=listas`} className={`btn btn-ghost btn-sm ${styles.back}`}>
        <Icon name="back" strokeWidth={2.4} /> Listas de {profile.display_name}
      </Link>
      <div className={styles.listHead}>
        <span className="eyebrow">Lista de @{profile.username}</span>
        <h1 className={`page-title ${lists.detailTitle}`}>{list.name}</h1>
        <div className={lists.listMeta}>
          {plural(progress.total, "jogo", "jogos")} · {progress.pct}% finalizados
          {list.ranked && <span className={lists.badge}>Ranqueada</span>}
        </div>
        {list.description && <p className={`lead ${lists.description}`}>{list.description}</p>}
      </div>
      <section aria-label="Progresso" className={`card ${lists.progressCard}`}>
        <ProgressBar progress={progress} legend />
      </section>
      <ul className={styles.grid}>
        {games.map((g, i) => (
          <PublicCard key={g.id} game={g} showStatus rank={list.ranked ? i + 1 : undefined} />
        ))}
      </ul>
    </main>
  );
}
