import { useMemo, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router";

import { useDevices, useGames } from "../../api/queries";
import type { GameCard, Priority, Status } from "../../api/types";
import { GameCover } from "../../components/GameCover";
import { Icon } from "../../components/Icon";
import { ErrorState, LoadingState } from "../../components/NotFound";
import { PRIORITY_LABEL, STATUS, STATUS_DOT, STATUS_ORDER, mcColor } from "../../lib/constants";
import { hrs } from "../../lib/format";
import { MOBILE, useMediaQuery } from "../../lib/useMediaQuery";
import styles from "./LibraryPage.module.css";
import {
  SORT_LABEL,
  defaultSort,
  deviceCounts,
  filterGames,
  inTab,
  libraryStats,
  platformOptions,
  statusCounts,
  type LibraryFilters,
  type SortKey,
} from "./selectors";

const PRIO_PILLS: [Priority | "", string][] = [
  ["", "Todas prioridades"],
  ["Alta", "Alta"],
  ["Media", "Média"],
  ["Baixa", "Baixa"],
];

function readFilters(sp: URLSearchParams): LibraryFilters {
  const lista = sp.get("lista") as Status | null;
  const tab: Status = lista && STATUS_ORDER.includes(lista) ? lista : "backlog";
  const ordem = sp.get("ordem") as SortKey | null;
  const prio = sp.get("prio") as Priority | null;
  const aparelho = Number(sp.get("aparelho"));
  return {
    tab,
    q: sp.get("q") ?? "",
    platform: sp.get("plataforma") ?? "",
    deviceId: Number.isFinite(aparelho) && aparelho > 0 ? aparelho : null,
    priority: prio && prio in PRIORITY_LABEL ? prio : "",
    sort: ordem && ordem in SORT_LABEL ? ordem : defaultSort(tab),
  };
}

export function LibraryPage() {
  const [sp, setSp] = useSearchParams();
  const games = useGames();
  const devices = useDevices();
  const isMobile = useMediaQuery(MOBILE);
  const f = readFilters(sp);

  const update = (patch: Record<string, string | null>) =>
    setSp(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        return next;
      },
      { replace: true },
    );

  const all = games.data ?? [];
  const devs = devices.data ?? [];
  const tabGames = useMemo(() => inTab(all, f.tab), [all, f.tab]);
  const filterKey = JSON.stringify(f);
  const list = useMemo(() => filterGames(all, devs, JSON.parse(filterKey) as LibraryFilters), [all, devs, filterKey]);
  const counts = useMemo(() => statusCounts(all), [all]);
  const devCounts = useMemo(() => deviceCounts(tabGames, devs), [tabGames, devs]);
  const stats = useMemo(() => libraryStats(all), [all]);
  const platOpts = useMemo(() => platformOptions(tabGames), [tabGames]);

  if (games.isError) return <ErrorState error={games.error} onRetry={() => games.refetch()} />;
  if (games.isPending) return <LoadingState text="Carregando sua biblioteca…" />;

  const device = devs.find((d) => d.id === f.deviceId);
  const notes = [f.platform, device ? `jogável em ${device.name}` : ""].filter(Boolean);

  return (
    <div className={styles.layout}>
      <aside aria-label="Filtros da biblioteca" className={styles.sidebar}>
        <div className={styles.group}>
          <span className={`eyebrow ${styles.groupLabel}`}>Listas</span>
          <div className={styles.lists}>
            {STATUS_ORDER.map((k) => (
              <button
                key={k}
                type="button"
                className={styles.side}
                aria-current={k === f.tab ? "page" : undefined}
                onClick={() => update({ lista: k === "backlog" ? null : k, ordem: null, plataforma: null, aparelho: null })}
              >
                <span className={styles.dot} style={{ background: STATUS_DOT[k] }} aria-hidden="true" />
                <span className={styles.sideLabel}>{STATUS[k]}</span>
                <span className={styles.sideCount}>{counts[k]}</span>
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
                  const on = f.deviceId === d.id;
                  return (
                    <button
                      key={d.id ?? "all"}
                      type="button"
                      className={`${styles.side} ${styles.sideSm}`}
                      aria-pressed={on}
                      onClick={() => update({ aparelho: d.id ? String(d.id) : null })}
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
            <h1 className={styles.title}>{STATUS[f.tab]}</h1>
            <span className={styles.subtitle}>
              {list.length} {list.length === 1 ? "jogo" : "jogos"}
              {notes.length ? ` · ${notes.join(" · ")}` : ""}
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
              onChange={(e) => update({ q: e.target.value })}
            />
          </div>
          <label className={styles.inline}>
            Plataforma
            <select className="select input-raised" value={f.platform} onChange={(e) => update({ plataforma: e.target.value })}>
              <option value="">Todas</option>
              {platOpts.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.inline}>
            Ordenar
            <select
              className="select input-raised"
              value={f.sort}
              onChange={(e) => update({ ordem: e.target.value === defaultSort(f.tab) ? null : e.target.value })}
            >
              {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {f.tab === "backlog" && (
          <div role="group" aria-label="Prioridade" className={styles.prios}>
            {PRIO_PILLS.map(([value, label]) => (
              <button
                key={label}
                type="button"
                className="pill"
                aria-pressed={f.priority === value}
                onClick={() => update({ prio: value || null })}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div className={styles.content}>
          {all.length === 0 ? (
            <div className="notice">
              Sua biblioteca está vazia. <Link to="/integracoes">Importe a planilha</Link> ou{" "}
              <Link to="/adicionar">adicione um jogo</Link>.
            </div>
          ) : list.length === 0 ? (
            <div className="notice">Nenhum jogo com esses filtros.</div>
          ) : (
            <div className={styles.grid}>
              {list.map((g) => (
                <Card key={g.id} game={g} />
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

function Card({ game: g }: { game: GameCard }) {
  const played = g.status === "done" || g.status === "dropped";
  const timeLabel = played
    ? g.played_hours
      ? `${hrs(g.played_hours)} jogadas`
      : "—"
    : g.hltb_main_hours
      ? (hrs(g.hltb_main_hours) ?? "")
      : "HLTB —";
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
    </Link>
  );
}
