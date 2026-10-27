import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link, useLocation, useNavigationType, useSearchParams } from "react-router";

import { errorMessage } from "../../api/client";
import { useAccounts, useDevices, useGames, useSetHidden } from "../../api/queries";
import type { GameCard, Priority } from "../../api/types";
import { Dialog } from "../../components/Dialog";
import { Icon } from "../../components/Icon";
import { ErrorState, LoadingState } from "../../components/NotFound";
import { useToast } from "../../components/Toast";
import { STATUS, STATUS_DOT } from "../../lib/constants";
import { usePrefs } from "../../lib/prefs";
import { MOBILE, useMediaQuery } from "../../lib/useMediaQuery";
import { CardDisplayMenu } from "./CardDisplayMenu";
import { cardDisplay, devicesByPlatform, sharedSummary } from "./cardInfo";
import { FilterPanel } from "./FilterPanel";
import { GameRows } from "./GameRows";
import { LibraryCard } from "./LibraryCard";
import {
  SORTS,
  TAB_ORDER,
  activeChips,
  clearFilters,
  defaultSort,
  facets,
  filterGames,
  inTab,
  parseFilters,
  serializeFilters,
  type Filters,
  type SortKey,
  type Tab,
} from "./filters";
import styles from "./LibraryPage.module.css";
import { rememberAnchor, rememberSearch, savedAnchor, useScrollToAnchor } from "./returnTo";
import { deviceCounts, libraryStats, statusCounts } from "./selectors";
import { ViewToggle } from "./ViewToggle";

const PRIO_PILLS: [Priority | "", string][] = [
  ["", "Todas prioridades"],
  ["Alta", "Alta"],
  ["Media", "Média"],
  ["Baixa", "Baixa"],
];

const TAB_LABEL = (t: Tab) => (t === "all" ? "Todos os jogos" : t === "hidden" ? "Ocultos" : STATUS[t]);
const TAB_SHORT = (t: Tab) => (t === "all" ? "Todos" : t === "hidden" ? "Ocultos" : STATUS[t]);
const tabDot = (t: Tab): CSSProperties =>
  t === "hidden"
    ? { background: "transparent", boxShadow: "inset 0 0 0 1.5px var(--muted)" }
    : { background: t === "all" ? "var(--muted)" : STATUS_DOT[t] };

export function LibraryPage() {
  const [sp, setSp] = useSearchParams();
  const location = useLocation();
  const navType = useNavigationType();
  const games = useGames();
  const devices = useDevices();
  const accounts = useAccounts();
  const setHidden = useSetHidden();
  const toast = useToast();
  const isMobile = useMediaQuery(MOBILE);
  // Voltando do detalhe pelo histórico: o card clicado e o painel de filtros como estavam.
  const [restore] = useState(() => (navType === "POP" ? savedAnchor(location.key) : null));
  const [panelOpen, setPanelOpen] = useState(restore?.panel ?? false);
  const f = parseFilters(sp);
  const urlKey = sp.toString();

  const set = (next: Filters) => setSp(serializeFilters(next), { replace: true, preventScrollReset: true });
  const patch = (p: Partial<Filters>) => set({ ...f, ...p });

  const all = games.data ?? [];
  const devs = devices.data ?? [];
  const accs = accounts.data ?? [];
  const visible = useMemo(() => all.filter((g) => !g.hidden), [all]);
  const hiddenCount = all.length - visible.length;
  const tabGames = useMemo(() => inTab(all, f.tab), [all, f.tab]);
  const list = useMemo(() => filterGames(all, devs, parseFilters(new URLSearchParams(urlKey))), [all, devs, urlKey]);
  const counts = useMemo(() => statusCounts(visible), [visible]);
  const devCounts = useMemo(() => deviceCounts(tabGames, devs), [tabGames, devs]);
  const stats = useMemo(() => libraryStats(visible), [visible]);
  const fc = useMemo(() => facets(tabGames, accs), [tabGames, accs]);
  const accountsById = useMemo(() => new Map(accs.map((a) => [a.id, a])), [accs]);
  const [prefs] = usePrefs();
  const devicesOf = useMemo(() => devicesByPlatform(devs), [devs]);
  const show = useMemo(() => cardDisplay(list, prefs.card, devicesOf), [list, prefs.card, devicesOf]);
  const sharedParts = sharedSummary(show.shared, accountsById);

  useEffect(() => rememberSearch(urlKey), [urlKey]);

  useScrollToAnchor(games.isSuccess, restore);

  if (games.isError) return <ErrorState error={games.error} onRetry={() => games.refetch()} />;
  if (games.isPending) return <LoadingState text="Carregando sua biblioteca…" />;

  const chips = activeChips(f, { devices: devs, genres: fc.genres, accounts: accs });
  const changeTab = (tab: Tab) => {
    const sort = defaultSort(tab);
    set({ ...f, tab, sort, dir: SORTS[sort].dir });
  };
  const changeSort = (sort: SortKey) => patch({ sort, dir: SORTS[sort].dir });
  // Cabeçalho da visão em lista: a coluna ativa inverte a direção.
  const sortByColumn = (sort: SortKey) =>
    sort === f.sort ? patch({ dir: f.dir === "asc" ? "desc" : "asc" }) : changeSort(sort);
  const singleDevice = f.devices.length === 1 ? f.devices[0] : null;
  const singlePrio = f.priorities.length === 1 ? f.priorities[0] : f.priorities.length ? null : "";
  const tabs = TAB_ORDER.filter((k) => k !== "hidden" || hiddenCount > 0 || f.tab === "hidden");

  const openGame = (id: number, top: number) => rememberAnchor(location.key, { id, top, panel: panelOpen });
  const toggleHidden = (g: GameCard) => {
    const hidden = !g.hidden;
    // mutateAsync: cada clique tem o seu aviso, mesmo ocultando vários em seguida.
    setHidden.mutateAsync({ id: g.id, hidden }).then(
      () =>
        toast.show(hidden ? `${g.name} foi para Ocultos.` : `${g.name} voltou para ${STATUS[g.status]}.`, "info", {
          label: "Desfazer",
          onClick: () => setHidden.mutate({ id: g.id, hidden: !hidden }),
        }),
      (e) => toast.error(`Não consegui ${hidden ? "ocultar" : "mostrar"} ${g.name}: ${errorMessage(e)}`),
    );
  };

  const panel = <FilterPanel f={f} onChange={set} facets={fc} devices={devs} accounts={accs} />;

  return (
    <div className={styles.layout}>
      <aside aria-label="Status e aparelhos" className={styles.sidebar}>
        <div className={styles.group}>
          <span className={`eyebrow ${styles.groupLabel}`}>Status</span>
          <div className={styles.lists}>
            {tabs.map((k) => (
              <button
                key={k}
                type="button"
                className={styles.side}
                aria-current={k === f.tab ? "page" : undefined}
                onClick={() => changeTab(k)}
              >
                <span className={styles.dot} style={tabDot(k)} aria-hidden="true" />
                <span className={styles.sideLabel}>{TAB_SHORT(k)}</span>
                <span className={styles.sideCount}>
                  {k === "all" ? visible.length : k === "hidden" ? hiddenCount : counts[k]}
                </span>
              </button>
            ))}
          </div>
        </div>

        <details className={styles.more} open={!isMobile || undefined}>
          <summary className={styles.moreSummary}>
            <Icon name="filter" size={14} /> Aparelhos e números
          </summary>
          <div className={styles.moreBody}>
            <div className={styles.group}>
              <span className={`eyebrow ${styles.groupLabel}`}>Jogável em</span>
              <div className={styles.devices}>
                {[{ id: null as number | null, name: "Todos os aparelhos" }, ...devs].map((d) => {
                  const on = d.id === null ? f.devices.length === 0 : singleDevice === d.id;
                  return (
                    <button
                      key={d.id ?? "all"}
                      type="button"
                      className={`${styles.side} ${styles.sideSm}`}
                      aria-pressed={on}
                      onClick={() => patch({ devices: d.id ? [d.id] : [] })}
                    >
                      <span className={styles.sideLabel}>{d.name}</span>
                      <span className={styles.sideCount}>{d.id ? (devCounts.get(d.id) ?? 0) : tabGames.length}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className={styles.stats}>
              <Stat value={stats.hours} label="na fila (HLTB)" />
              <Stat value={stats.played} label="jogadas" />
              <Stat value={String(stats.high)} label="prioridade alta" />
              <Stat value={stats.avg} label="nota média" />
            </div>
          </div>
        </details>
      </aside>

      <main className={styles.main}>
        <div className={styles.toolbar}>
          <div className={styles.titleBlock}>
            <h1 className={styles.title}>{TAB_LABEL(f.tab)}</h1>
            <span className={styles.subtitle}>
              {list.length} {list.length === 1 ? "jogo" : "jogos"}
              {list.length !== tabGames.length ? ` de ${tabGames.length}` : ""}
            </span>
            {sharedParts.length > 0 && <span className={styles.shared}>{sharedParts.join(" · ")}</span>}
          </div>
          <div className={styles.search}>
            <Icon name="search" size={16} strokeWidth={2} className={styles.searchIcon} />
            <input
              type="search"
              aria-label="Buscar jogo"
              placeholder="Buscar na biblioteca"
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
              onChange={(e) => changeSort(e.target.value as SortKey)}
            >
              {(Object.keys(SORTS) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORTS[k].label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={`btn btn-icon ${styles.dirBtn}`}
            onClick={() => patch({ dir: f.dir === "asc" ? "desc" : "asc" })}
            aria-label={f.dir === "asc" ? "Ordem crescente (inverter)" : "Ordem decrescente (inverter)"}
            title={f.dir === "asc" ? "Crescente" : "Decrescente"}
          >
            <Icon name="sort" style={f.dir === "desc" ? { transform: "scaleY(-1)" } : undefined} />
          </button>
          <div className={styles.toolbarActions}>
            <button
              type="button"
              className={`btn ${panelOpen ? "btn-primary" : ""} ${styles.filterBtn}`}
              aria-expanded={panelOpen}
              aria-controls={isMobile ? undefined : "painel-filtros"}
              onClick={() => setPanelOpen((o) => !o)}
            >
              <Icon name="filter" size={14} /> Filtros
              {chips.length > 0 && <span className={styles.badge}>{chips.length}</span>}
            </button>
            <ViewToggle />
            <CardDisplayMenu />
          </div>
        </div>

        {f.tab === "backlog" && (
          <div role="group" aria-label="Prioridade" className={styles.prios}>
            {PRIO_PILLS.map(([value, label]) => (
              <button
                key={label}
                type="button"
                className="pill"
                aria-pressed={singlePrio === value}
                onClick={() => patch({ priorities: value ? [value] : [] })}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {panelOpen && !isMobile && (
          <div id="painel-filtros" className={styles.panelWrap}>
            {panel}
          </div>
        )}
        {isMobile && (
          <Dialog open={panelOpen} onClose={() => setPanelOpen(false)} title="Filtros" wide>
            {panel}
            <div className="row-end">
              <button type="button" className="btn btn-primary" onClick={() => setPanelOpen(false)}>
                Ver {list.length} {list.length === 1 ? "jogo" : "jogos"}
              </button>
            </div>
          </Dialog>
        )}

        {chips.length > 0 && (
          <div className={styles.chips} aria-label="Filtros ativos">
            {chips.map((c) => (
              <button
                key={c.id}
                type="button"
                className={styles.chip}
                onClick={() => set(c.remove(f))}
                aria-label={`Remover filtro ${c.label}`}
              >
                {c.label} <Icon name="close" size={12} />
              </button>
            ))}
            <button type="button" className="btn btn-link btn-sm" onClick={() => set(clearFilters(f))}>
              Limpar filtros
            </button>
          </div>
        )}

        <div className={styles.content}>
          {all.length === 0 ? (
            <div className="notice">
              Sua biblioteca está vazia.{" "}
              <Link to="/integracoes">Importe a planilha, conecte uma conta Steam, Epic ou GOG</Link> ou{" "}
              <Link to="/adicionar">adicione um jogo</Link>.
            </div>
          ) : f.tab === "hidden" && tabGames.length === 0 ? (
            <div className="notice">
              Nenhum jogo oculto. Para esconder um jogo sem excluir, use o olho no canto da capa.
            </div>
          ) : list.length === 0 ? (
            <div className="notice">
              Nenhum jogo com esses filtros.{" "}
              {chips.length > 0 && (
                <button type="button" className="btn btn-link" onClick={() => set(clearFilters(f))}>
                  Limpar filtros
                </button>
              )}
            </div>
          ) : prefs.view === "list" ? (
            <GameRows
              games={list}
              accounts={accountsById}
              show={show}
              devicesOf={devicesOf}
              onOpen={openGame}
              onToggleHidden={toggleHidden}
              showStatus={f.tab === "all" || f.tab === "hidden"}
              sort={f.sort}
              dir={f.dir}
              onSort={sortByColumn}
            />
          ) : (
            <div className={styles.grid}>
              {list.map((g) => (
                <LibraryCard
                  key={g.id}
                  game={g}
                  accounts={accountsById}
                  show={show}
                  devicesOf={devicesOf}
                  onOpen={openGame}
                  onToggleHidden={toggleHidden}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}
