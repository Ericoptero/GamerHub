import { useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { useGames, useLists } from "../../api/queries";
import { Icon } from "../../components/Icon";
import { ErrorState, LoadingState } from "../../components/NotFound";
import { ListCard } from "./ListCard";
import { ListFormDialog } from "./ListFormDialog";
import { resolveGames } from "./lists";
import styles from "./Lists.module.css";

/** /listas: as listas que você criou, com as capas e o progresso de cada uma. */
export function ListsPage() {
  const lists = useLists();
  const games = useGames();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const byId = useMemo(() => new Map((games.data ?? []).map((g) => [g.id, g])), [games.data]);

  if (lists.isError) return <ErrorState error={lists.error} onRetry={() => lists.refetch()} />;
  if (games.isError) return <ErrorState error={games.error} onRetry={() => games.refetch()} />;
  if (lists.isPending || games.isPending) return <LoadingState text="Carregando suas listas…" />;

  return (
    <main className="page page-wide">
      <div className={styles.pageHead}>
        <div className="page-head">
          <h1 className="page-title">Listas</h1>
          <p className="lead">
            Junte jogos do seu jeito (“Metroidvanias”, “Para jogar em 2027”) e acompanhe quantos já terminou. O
            progresso vem do status de cada jogo.
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
          <Icon name="plus" strokeWidth={2.6} /> Nova lista
        </button>
      </div>

      {lists.data.length === 0 ? (
        <div className="notice">
          <p style={{ margin: "0 0 8px", fontWeight: 700, color: "var(--text)" }}>Nenhuma lista ainda</p>
          Crie uma lista e ponha jogos da biblioteca ou novos, buscados no IGDB ou na RAWG. Dá para ordenar à mão e
          mostrar a posição de cada um, como num ranking.
          <div style={{ marginTop: 16 }}>
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              <Icon name="plus" strokeWidth={2.6} /> Criar a primeira lista
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.grid}>
          {lists.data.map((l) => (
            <ListCard
              key={l.id}
              to={`/listas/${l.id}`}
              name={l.name}
              description={l.description}
              ranked={l.ranked}
              isPrivate={!l.public}
              games={resolveGames(l.game_ids, byId)}
            />
          ))}
        </div>
      )}

      <ListFormDialog open={creating} onClose={() => setCreating(false)} onSaved={(l) => navigate(`/listas/${l.id}`)} />
    </main>
  );
}
