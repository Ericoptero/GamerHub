import type { CSSProperties } from "react";
import { Link } from "react-router";

import type { Account, GameCard } from "../../api/types";
import { GameCover } from "../../components/GameCover";
import { Icon } from "../../components/Icon";
import { STATUS1, STATUS_DOT, mcColor } from "../../lib/constants";
import { hrs } from "../../lib/format";
import { metaLine, type CardDisplay } from "./cardInfo";
import type { SortDir, SortKey } from "./filters";
import styles from "./GameRows.module.css";
import { OwnerChips, ownersOf, prioDot } from "./LibraryCard";
import cardStyles from "./LibraryPage.module.css";
import { FROM_LIBRARY, type CardLinkState } from "./returnTo";

/** Colunas que somem no celular. */
const WIDE = new Set<SortKey>(["short", "played"]);

/** Colunas que ordenam ao clicar no cabeçalho. */
const COLUMNS: { key: SortKey; label: string; title: string }[] = [
  { key: "short", label: "HLTB", title: "HowLongToBeat (história principal)" },
  { key: "played", label: "Jogadas", title: "Horas jogadas" },
  { key: "mc", label: "MC", title: "Metacritic (crítica)" },
  { key: "score", label: "Nota", title: "Sua nota" },
];

interface Props {
  games: GameCard[];
  accounts: Map<number, Account>;
  show: CardDisplay;
  devicesOf: Map<number, string[]>;
  onOpen: (id: number, top: number) => void;
  onToggleHidden?: (game: GameCard) => void;
  /** Coluna de status: útil quando a lista mistura status (Todos, Ocultos, listas). */
  showStatus: boolean;
  /** Posição de cada jogo numa lista ranqueada. */
  ranks?: Map<number, number>;
  markHidden?: boolean;
  linkState?: CardLinkState;
  /** Ordenação atual e a troca pelo cabeçalho; "manual" é a ordem de uma lista. */
  sort: SortKey | "manual";
  dir: SortDir;
  onSort: (key: SortKey) => void;
}

/** A biblioteca (ou uma lista) em linhas, como uma tabela: capa pequena, nome, status e números. */
export function GameRows({
  games,
  accounts,
  show,
  devicesOf,
  onOpen,
  onToggleHidden,
  showStatus,
  ranks,
  markHidden,
  linkState = FROM_LIBRARY,
  sort,
  dir,
  onSort,
}: Props) {
  const columns = COLUMNS.filter((c) => c.key !== "score" || show.score);
  // No celular saem as colunas de status, HLTB e jogadas (vão para a linha de baixo do nome).
  const template = (small: boolean) =>
    [
      ranks ? "28px" : null,
      "40px",
      "minmax(0, 1fr)",
      showStatus && !small ? "112px" : null,
      ...columns.filter((c) => !small || !WIDE.has(c.key)).map(() => (small ? "40px" : "64px")),
      onToggleHidden ? "36px" : null,
    ]
      .filter(Boolean)
      .join(" ");
  const grid = { "--cols": template(false), "--cols-sm": template(true) } as CSSProperties;

  return (
    <div className={styles.table} style={grid}>
      <div className={styles.head} role="group" aria-label="Ordenar pela coluna">
        {ranks && <span className={styles.rankCell}>#</span>}
        <span />
        <SortButton label="Nome" title="Nome" k="name" sort={sort} dir={dir} onSort={onSort} />
        {showStatus && <span className={styles.statusCell}>Status</span>}
        {columns.map((c) => (
          <SortButton key={c.key} label={c.label} title={c.title} k={c.key} sort={sort} dir={dir} onSort={onSort} num />
        ))}
        {onToggleHidden && <span />}
      </div>
      <ul className={styles.rows}>
        {games.map((g) => {
          const meta = metaLine(g, show, devicesOf);
          const dim = markHidden && g.hidden;
          const owners = ownersOf(g, show, accounts);
          return (
            <li key={g.id} className={`${styles.rowWrap} ${dim ? cardStyles.dim : ""}`} data-game={g.id}>
              <Link
                to={`/jogos/${g.id}`}
                state={linkState}
                className={styles.row}
                aria-label={`Abrir ${g.name}`}
                onClick={(e) => onOpen(g.id, e.currentTarget.getBoundingClientRect().top)}
              >
                {ranks && <span className={styles.rankCell}>{ranks.get(g.id)}</span>}
                <span className={styles.cover}>
                  <GameCover name={g.name} platform={g.platform} cover={g.cover} size="thumb" />
                </span>
                <span className={styles.nameCell}>
                  <span className={styles.name}>
                    {g.status === "backlog" && g.priority && (
                      <span className={cardStyles.prioDot} style={prioDot(g.priority)} aria-hidden="true" />
                    )}
                    <span className={styles.nameText}>{g.name}</span>
                    {dim && <span className={cardStyles.hiddenTag}>Oculto</span>}
                  </span>
                  {meta && (
                    <span className={styles.meta} title={meta}>
                      {meta}
                    </span>
                  )}
                  {/* No celular as colunas somem e o essencial vem nesta linha. */}
                  <span className={styles.compact}>
                    {showStatus && <span style={{ color: STATUS_DOT[g.status] }}>{STATUS1[g.status]}</span>}
                    {g.hltb_main_hours ? <span>HLTB {hrs(g.hltb_main_hours)}</span> : null}
                    {g.played_hours ? <span>{hrs(g.played_hours)} jogadas</span> : null}
                  </span>
                  <OwnerChips owners={owners} />
                </span>
                {showStatus && (
                  <span className={styles.statusCell}>
                    <span className={styles.statusDot} style={{ background: STATUS_DOT[g.status] }} aria-hidden="true" />
                    {STATUS1[g.status]}
                  </span>
                )}
                <span className={`${styles.num} ${styles.wide}`}>{hrs(g.hltb_main_hours) ?? "—"}</span>
                <span className={`${styles.num} ${styles.wide}`}>{hrs(g.played_hours) ?? "—"}</span>
                <span className={styles.num} style={{ color: mcColor(g.metacritic_score), fontWeight: 700 }}>
                  {g.metacritic_score ?? "—"}
                </span>
                {show.score && (
                  <span className={`${styles.num} ${g.user_score !== null ? styles.score : ""}`}>
                    {g.user_score !== null ? (
                      <>
                        <Icon name="star" size={11} strokeWidth={0} fill="currentColor" />
                        {g.user_score}
                      </>
                    ) : (
                      "—"
                    )}
                  </span>
                )}
              </Link>
              {onToggleHidden && (
                <button
                  type="button"
                  className={styles.hideBtn}
                  onClick={() => onToggleHidden(g)}
                  aria-label={g.hidden ? `Mostrar ${g.name} de novo` : `Ocultar ${g.name}`}
                  title={g.hidden ? "Mostrar de novo" : "Ocultar (fica só em Ocultos)"}
                >
                  <Icon name={g.hidden ? "eye" : "eyeOff"} size={16} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SortButton({
  label,
  title,
  k,
  sort,
  dir,
  onSort,
  num,
}: {
  label: string;
  title: string;
  k: SortKey;
  sort: SortKey | "manual";
  dir: SortDir;
  onSort: (key: SortKey) => void;
  num?: boolean;
}) {
  const on = sort === k;
  return (
    <button
      type="button"
      className={`${styles.sortBtn} ${num ? styles.num : ""} ${WIDE.has(k) ? styles.wide : ""}`}
      aria-pressed={on}
      title={`Ordenar por ${title.toLowerCase()}${on ? " (inverter)" : ""}`}
      onClick={() => onSort(k)}
    >
      {label}
      {on && <Icon name="sort" size={12} style={dir === "desc" ? { transform: "scaleY(-1)" } : undefined} />}
    </button>
  );
}
