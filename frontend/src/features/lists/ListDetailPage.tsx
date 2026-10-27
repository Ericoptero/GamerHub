import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useNavigationType, useParams, useSearchParams } from "react-router";

import { errorMessage } from "../../api/client";
import { useAccounts, useDevices, useGames, useListMutations, useLists } from "../../api/queries";
import type { GameCard, GameList } from "../../api/types";
import { useConfirm } from "../../components/Confirm";
import { Icon } from "../../components/Icon";
import { ErrorState, LoadingState } from "../../components/NotFound";
import { useToast } from "../../components/Toast";
import { plural } from "../../lib/format";
import { usePrefs } from "../../lib/prefs";
import { fold } from "../../lib/text";
import { CardDisplayMenu } from "../library/CardDisplayMenu";
import { cardDisplay, devicesByPlatform, sharedSummary } from "../library/cardInfo";
import type { SortDir, SortKey } from "../library/filters";
import { GameRows } from "../library/GameRows";
import { LibraryCard } from "../library/LibraryCard";
import lib from "../library/LibraryPage.module.css";
import { fromList, rememberAnchor, savedAnchor, useScrollToAnchor } from "../library/returnTo";
import { ViewToggle } from "../library/ViewToggle";
import { AddGamesDialog } from "./AddGamesDialog";
import { ProgressBar } from "./ListCard";
import { ListFormDialog } from "./ListFormDialog";
import { LIST_SORTS, listProgress, ranks, resolveGames, sortListGames, type ListSort } from "./lists";
import styles from "./Lists.module.css";
import { OrganizeList } from "./OrganizeList";

/** /listas/:id */
export function ListDetailPage() {
  const { id } = useParams();
  const lists = useLists();
  const games = useGames();

  if (lists.isError) return <ErrorState error={lists.error} onRetry={() => lists.refetch()} />;
  if (games.isError) return <ErrorState error={games.error} onRetry={() => games.refetch()} />;
  if (lists.isPending || games.isPending) return <LoadingState text="Carregando a lista…" />;

  const list = lists.data.find((l) => l.id === Number(id));
  if (!list) {
    return (
      <main className="page page-narrow">
        <div className="notice">
          <p style={{ margin: "0 0 8px", fontWeight: 700, color: "var(--text)" }}>Lista não encontrada</p>
          Ela pode ter sido excluída. <Link to="/listas">Ver suas listas</Link>
        </div>
      </main>
    );
  }
  return <ListDetail list={list} games={games.data} />;
}

/** Ordem e busca ficam na URL: voltar do detalhe de um jogo cai na lista como estava. */
function parseView(sp: URLSearchParams): { q: string; sort: ListSort; dir: SortDir } {
  const ordem = sp.get("ordem");
  const sort = ordem && ordem in LIST_SORTS ? (ordem as ListSort) : "manual";
  const dir = sp.get("dir");
  return { q: sp.get("q") ?? "", sort, dir: dir === "asc" || dir === "desc" ? dir : LIST_SORTS[sort].dir };
}

function serializeView(v: { q: string; sort: ListSort; dir: SortDir }): URLSearchParams {
  const sp = new URLSearchParams();
  if (v.q) sp.set("q", v.q);
  if (v.sort !== "manual") sp.set("ordem", v.sort);
  if (v.dir !== LIST_SORTS[v.sort].dir) sp.set("dir", v.dir);
  return sp;
}

function ListDetail({ list, games }: { list: GameList; games: GameCard[] }) {
  const [sp, setSp] = useSearchParams();
  const location = useLocation();
  const navType = useNavigationType();
  const navigate = useNavigate();
  const devices = useDevices();
  const accounts = useAccounts();
  const { remove, add, removeGame, reorder } = useListMutations();
  const toast = useToast();
  const [dialog, confirm] = useConfirm();
  const [prefs] = usePrefs();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [restore] = useState(() => (navType === "POP" ? savedAnchor(location.key) : null));

  const view = parseView(sp);
  const setView = (p: Partial<typeof view>) =>
    setSp(serializeView({ ...view, ...p }), { replace: true, preventScrollReset: true });

  const byId = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);
  const inList = useMemo(() => resolveGames(list.game_ids, byId), [list.game_ids, byId]);
  const progress = listProgress(inList);
  const needle = fold(view.q.trim());
  const shown = useMemo(
    () => sortListGames(needle ? inList.filter((g) => fold(g.name).includes(needle)) : inList, view.sort, view.dir),
    [inList, needle, view.sort, view.dir],
  );
  const devs = devices.data ?? [];
  const devicesOf = useMemo(() => devicesByPlatform(devs), [devs]);
  const accountsById = useMemo(() => new Map((accounts.data ?? []).map((a) => [a.id, a])), [accounts.data]);
  const show = useMemo(() => cardDisplay(shown, prefs.card, devicesOf), [shown, prefs.card, devicesOf]);
  const sharedParts = sharedSummary(show.shared, accountsById);
  const positions = list.ranked ? ranks(list.game_ids) : undefined;
  const linkState = fromList(list.id, list.name);

  useScrollToAnchor(true, restore);

  const openGame = (id: number, top: number) => rememberAnchor(location.key, { id, top, panel: false });
  const changeSort = (sort: ListSort) => setView({ sort, dir: LIST_SORTS[sort].dir });
  const sortByColumn = (sort: SortKey) =>
    sort === view.sort ? setView({ dir: view.dir === "asc" ? "desc" : "asc" }) : changeSort(sort);
  const startOrganizing = () => {
    // Organizar mexe na ordem da lista: mostra ela inteira, na ordem dela.
    setView({ q: "", sort: "manual", dir: "asc" });
    setOrganizing(true);
  };

  const removeFromList = (g: GameCard) => {
    const before = list.game_ids;
    removeGame.mutateAsync({ listId: list.id, gameId: g.id }).then(
      () =>
        toast.show(`${g.name} saiu da lista.`, "info", {
          label: "Desfazer",
          onClick: () =>
            add
              .mutateAsync({ listId: list.id, gameId: g.id })
              .then(() => reorder.mutate({ listId: list.id, gameIds: before })),
        }),
      (e) => toast.error(`Não consegui tirar ${g.name} da lista: ${errorMessage(e)}`),
    );
  };

  const deleteList = async () => {
    const ok = await confirm({
      title: "Excluir lista",
      message: (
        <>
          A lista <strong>{list.name}</strong> será excluída. Os jogos continuam na biblioteca.
        </>
      ),
      confirmLabel: "Excluir lista",
      danger: true,
    });
    if (!ok) return;
    remove.mutate(list.id, {
      onSuccess: () => {
        toast.show(`A lista ${list.name} foi excluída.`);
        navigate("/listas");
      },
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  return (
    <main className="page page-wide">
      <Link to="/listas" className={`btn btn-ghost btn-sm ${styles.back}`}>
        <Icon name="back" strokeWidth={2.4} /> Listas
      </Link>

      <div className={styles.pageHead}>
        <div className="page-head" style={{ minWidth: 0 }}>
          <h1 className={`page-title ${styles.detailTitle}`}>{list.name}</h1>
          <div className={styles.listMeta}>
            {plural(progress.total, "jogo", "jogos")}
            {list.ranked && <span className={styles.badge}>Ranqueada</span>}
            <span className={styles.badge}>{list.public ? "Pública" : "Privada"}</span>
          </div>
          {list.description && <p className={`lead ${styles.description}`}>{list.description}</p>}
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={() => setEditing(true)}>
            <Icon name="edit" size={14} /> Editar
          </button>
          <button type="button" className="btn btn-ghost" onClick={deleteList} disabled={remove.isPending}>
            <Icon name="trash" size={14} /> Excluir
          </button>
        </div>
      </div>

      {progress.total > 0 && (
        <section aria-label="Progresso" className={`card ${styles.progressCard}`}>
          <div className={styles.progressHead}>
            <span className={styles.pct}>{progress.pct}%</span>
            <span className="muted">
              {progress.done} de {plural(progress.total, "jogo finalizado", "jogos finalizados")}
            </span>
          </div>
          <ProgressBar progress={progress} legend />
        </section>
      )}

      <div className={styles.toolbar}>
        <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
          <Icon name="plus" strokeWidth={2.6} /> Adicionar jogos
        </button>
        {!organizing && inList.length > 0 && (
          <>
            <div className={lib.search}>
              <Icon name="search" size={16} strokeWidth={2} className={lib.searchIcon} />
              <input
                type="search"
                aria-label="Buscar na lista"
                placeholder="Buscar na lista"
                className="input input-raised"
                value={view.q}
                onChange={(e) => setView({ q: e.target.value })}
              />
            </div>
            <label className={lib.inline}>
              Ordenar
              <select
                className="select input-raised"
                value={view.sort}
                onChange={(e) => changeSort(e.target.value as ListSort)}
              >
                {(Object.keys(LIST_SORTS) as ListSort[]).map((k) => (
                  <option key={k} value={k}>
                    {LIST_SORTS[k].label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={`btn btn-icon ${lib.dirBtn}`}
              onClick={() => setView({ dir: view.dir === "asc" ? "desc" : "asc" })}
              aria-label={view.dir === "asc" ? "Ordem crescente (inverter)" : "Ordem decrescente (inverter)"}
              title={view.dir === "asc" ? "Crescente" : "Decrescente"}
            >
              <Icon name="sort" style={view.dir === "desc" ? { transform: "scaleY(-1)" } : undefined} />
            </button>
          </>
        )}
        <div className={lib.toolbarActions}>
          {inList.length > 1 && (
            <button
              type="button"
              className={`btn ${organizing ? "btn-primary" : ""}`}
              aria-pressed={organizing}
              onClick={() => (organizing ? setOrganizing(false) : startOrganizing())}
            >
              {organizing ? (
                <>
                  <Icon name="check" size={14} strokeWidth={3} /> Pronto
                </>
              ) : (
                <>
                  <Icon name="grip" size={16} strokeWidth={3.2} /> Organizar
                </>
              )}
            </button>
          )}
          {!organizing && (
            <>
              <ViewToggle />
              <CardDisplayMenu />
            </>
          )}
        </div>
      </div>
      {!organizing && sharedParts.length > 0 && <span className={lib.shared}>{sharedParts.join(" · ")}</span>}

      {inList.length === 0 ? (
        <div className="notice">
          <p style={{ margin: "0 0 8px", fontWeight: 700, color: "var(--text)" }}>Lista vazia</p>
          Busque jogos da sua biblioteca ou novos, no IGDB ou na RAWG. Também dá para pôr um jogo na lista pela
          página dele.
          <div style={{ marginTop: 16 }}>
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              <Icon name="plus" strokeWidth={2.6} /> Adicionar jogos
            </button>
          </div>
        </div>
      ) : organizing ? (
        <>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Arraste as linhas ou use as setas. Cada mudança é salva na hora.
          </p>
          <OrganizeList
            games={inList}
            onReorder={(gameIds) =>
              reorder.mutate(
                { listId: list.id, gameIds },
                { onError: (e) => toast.error(`Não consegui salvar a ordem: ${errorMessage(e)}`) },
              )
            }
            onRemove={removeFromList}
          />
        </>
      ) : shown.length === 0 ? (
        <div className="notice">Nenhum jogo da lista com esse nome.</div>
      ) : prefs.view === "list" ? (
        <GameRows
          games={shown}
          accounts={accountsById}
          show={show}
          devicesOf={devicesOf}
          onOpen={openGame}
          showStatus
          ranks={positions}
          markHidden
          linkState={linkState}
          sort={view.sort}
          dir={view.dir}
          onSort={sortByColumn}
        />
      ) : (
        <div className={lib.grid}>
          {shown.map((g) => (
            <LibraryCard
              key={g.id}
              game={g}
              accounts={accountsById}
              show={show}
              devicesOf={devicesOf}
              onOpen={openGame}
              rank={positions?.get(g.id)}
              markHidden
              linkState={linkState}
            />
          ))}
        </div>
      )}

      <ListFormDialog open={editing} onClose={() => setEditing(false)} list={list} />
      <AddGamesDialog open={adding} onClose={() => setAdding(false)} list={list} />
      {dialog}
    </main>
  );
}
