import { useMemo, useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router";

import { useAccounts, useDevices, useGames } from "../../api/queries";
import type { Account, GameCard, Priority } from "../../api/types";
import { Dialog } from "../../components/Dialog";
import { GameCover } from "../../components/GameCover";
import { Icon } from "../../components/Icon";
import { ErrorState, LoadingState } from "../../components/NotFound";
import { StoreMark } from "../../components/StoreMark";
import { STATUS, STATUS_DOT, STORE_LABEL, mcColor } from "../../lib/constants";
import { hrs } from "../../lib/format";
import { MOBILE, useMediaQuery } from "../../lib/useMediaQuery";
import { FilterPanel } from "./FilterPanel";
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
import { deviceCounts, libraryStats, statusCounts } from "./selectors";

const PRIO_PILLS: [Priority | "", string][] = [
  ["", "Todas prioridades"],
  ["Alta", "Alta"],
  ["Media", "Média"],
  ["Baixa", "Baixa"],
];

const TAB_LABEL = (t: Tab) => (t === "all" ? "Todos os jogos" : STATUS[t]);
const TAB_DOT = (t: Tab) => (t === "all" ? "var(--muted)" : STATUS_DOT[t]);

export function LibraryPage() {
  const [sp, setSp] = useSearchParams();
  const games = useGames();
  const devices = useDevices();
  const accounts = useAccounts();
  const isMobile = useMediaQuery(MOBILE);
  const [panelOpen, setPanelOpen] = useState(false);
  const f = parseFilters(sp);
  const urlKey = sp.toString();

  const set = (next: Filters) => setSp(serializeFilters(next), { replace: true });
  const patch = (p: Partial<Filters>) => set({ ...f, ...p });

  const all = games.data ?? [];
  const devs = devices.data ?? [];
  const accs = accounts.data ?? [];
  const tabGames = useMemo(() => inTab(all, f.tab), [all, f.tab]);
  const list = useMemo(() => filterGames(all, devs, parseFilters(new URLSearchParams(urlKey))), [all, devs, urlKey]);
  const counts = useMemo(() => statusCounts(all), [all]);
  const devCounts = useMemo(() => deviceCounts(tabGames, devs), [tabGames, devs]);
  const stats = useMemo(() => libraryStats(all), [all]);
  const fc = useMemo(() => facets(tabGames, accs), [tabGames, accs]);
  const accountsById = useMemo(() => new Map(accs.map((a) => [a.id, a])), [accs]);

  if (games.isError) return <ErrorState error={games.error} onRetry={() => games.refetch()} />;
  if (games.isPending) return <LoadingState text="Carregando sua biblioteca…" />;

  const chips = activeChips(f, { devices: devs, genres: fc.genres, accounts: accs });
  const changeTab = (tab: Tab) => {
    const sort = defaultSort(tab);
    set({ ...f, tab, sort, dir: SORTS[sort].dir });
  };
  const changeSort = (sort: SortKey) => patch({ sort, dir: SORTS[sort].dir });
  const singleDevice = f.devices.length === 1 ? f.devices[0] : null;
  const singlePrio = f.priorities.length === 1 ? f.priorities[0] : f.priorities.length ? null : "";

  const panel = <FilterPanel f={f} onChange={set} facets={fc} devices={devs} accounts={accs} />;

  return (
    <div className={styles.layout}>
      <aside aria-label="Listas e aparelhos" className={styles.sidebar}>
        <div className={styles.group}>
          <span className={`eyebrow ${styles.groupLabel}`}>Listas</span>
          <div className={styles.lists}>
            {TAB_ORDER.map((k) => (
              <button
                key={k}
                type="button"
                className={styles.side}
                aria-current={k === f.tab ? "page" : undefined}
                onClick={() => changeTab(k)}
              >
                <span className={styles.dot} style={{ background: TAB_DOT(k) }} aria-hidden="true" />
                <span className={styles.sideLabel}>{k === "all" ? "Todos" : STATUS[k]}</span>
                <span className={styles.sideCount}>{k === "all" ? all.length : counts[k]}</span>
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
          ) : list.length === 0 ? (
            <div className="notice">
              Nenhum jogo com esses filtros.{" "}
              {chips.length > 0 && (
                <button type="button" className="btn btn-link" onClick={() => set(clearFilters(f))}>
                  Limpar filtros
                </button>
              )}
            </div>
          ) : (
            <div className={styles.grid}>
              {list.map((g) => (
                <Card key={g.id} game={g} accounts={accountsById} />
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

function prioDot(p: Priority): CSSProperties {
  if (p === "Alta") return { background: "var(--prio-alta)" };
  if (p === "Media") return { background: "var(--prio-media)" };
  return { background: "transparent", boxShadow: "inset 0 0 0 1.5px var(--muted)" };
}

const MAX_ACCOUNT_CHIPS = 2;

function Card({ game: g, accounts }: { game: GameCard; accounts: Map<number, Account> }) {
  const played = g.status === "done" || g.status === "dropped";
  const timeLabel = played
    ? g.played_hours
      ? `${hrs(g.played_hours)} jogadas`
      : "—"
    : g.hltb_main_hours
      ? (hrs(g.hltb_main_hours) ?? "")
      : "HLTB —";
  const owners = g.account_ids.map((id) => accounts.get(id)).filter((a): a is Account => !!a);
  return (
    <Link to={`/jogos/${g.id}`} className={styles.card} aria-label={`Abrir ${g.name}`}>
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
        {g.status === "backlog" && g.priority && (
          <span className={styles.prioDot} style={prioDot(g.priority)} aria-hidden="true" />
        )}
        <span className={styles.cardText}>{g.name}</span>
      </span>
      {owners.length > 0 && (
        <span className={styles.owners}>
          {owners.slice(0, MAX_ACCOUNT_CHIPS).map((a) => (
            <span key={a.id} className={styles.owner} title={`${STORE_LABEL[a.store]} · ${a.nickname}`}>
              <StoreMark store={a.store} />
              <span className="sr-only">{STORE_LABEL[a.store]} ·</span>
              <span className={styles.ownerName}>{a.nickname}</span>
            </span>
          ))}
          {owners.length > MAX_ACCOUNT_CHIPS && (
            <span
              className={styles.owner}
              title={owners
                .slice(MAX_ACCOUNT_CHIPS)
                .map((a) => a.nickname)
                .join(", ")}
            >
              +{owners.length - MAX_ACCOUNT_CHIPS}
            </span>
          )}
        </span>
      )}
    </Link>
  );
}
