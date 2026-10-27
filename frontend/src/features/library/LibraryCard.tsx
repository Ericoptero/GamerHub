import type { CSSProperties } from "react";
import { Link } from "react-router";

import type { Account, GameCard, Priority } from "../../api/types";
import { GameCover } from "../../components/GameCover";
import { Icon } from "../../components/Icon";
import { StoreMark } from "../../components/StoreMark";
import { STORE_LABEL, mcColor } from "../../lib/constants";
import { hrs } from "../../lib/format";
import { metaLine, type CardDisplay } from "./cardInfo";
import styles from "./LibraryPage.module.css";
import { FROM_LIBRARY, type CardLinkState } from "./returnTo";

export function prioDot(p: Priority): CSSProperties {
  if (p === "Alta") return { background: "var(--prio-alta)" };
  if (p === "Media") return { background: "var(--prio-media)" };
  return { background: "transparent", boxShadow: "inset 0 0 0 1.5px var(--muted)" };
}

/** Horas jogadas para o que já acabou (finalizado/dropado); senão o tempo do HLTB. */
export function timeLabel(g: GameCard): string {
  if (g.status === "done" || g.status === "dropped") return g.played_hours ? `${hrs(g.played_hours)} jogadas` : "—";
  return g.hltb_main_hours ? (hrs(g.hltb_main_hours) ?? "") : "HLTB —";
}

export const MAX_ACCOUNT_CHIPS = 2;

export interface CardProps {
  game: GameCard;
  accounts: Map<number, Account>;
  show: CardDisplay;
  devicesOf: Map<number, string[]>;
  onOpen: (id: number, top: number) => void;
  /** Sem ele, o card não tem o botão de ocultar (ex.: dentro de uma lista). */
  onToggleHidden?: (game: GameCard) => void;
  /** Posição numa lista ranqueada (#1, #2…). */
  rank?: number;
  /** Numa lista, o oculto continua aparecendo, esmaecido e com selo. */
  markHidden?: boolean;
  linkState?: CardLinkState;
}

/** Os chips das contas de loja que têm o jogo (até 2, e "+N"). */
export function OwnerChips({ owners }: { owners: Account[] }) {
  if (!owners.length) return null;
  return (
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
  );
}

export const ownersOf = (g: GameCard, show: CardDisplay, accounts: Map<number, Account>) =>
  show.accounts ? g.account_ids.map((id) => accounts.get(id)).filter((a): a is Account => !!a) : [];

export function LibraryCard({
  game: g,
  accounts,
  show,
  devicesOf,
  onOpen,
  onToggleHidden,
  rank,
  markHidden,
  linkState = FROM_LIBRARY,
}: CardProps) {
  const meta = metaLine(g, show, devicesOf);
  const dim = markHidden && g.hidden;
  return (
    <div className={`${styles.cardWrap} ${dim ? styles.dim : ""}`} data-game={g.id}>
      <Link
        to={`/jogos/${g.id}`}
        state={linkState}
        className={styles.card}
        aria-label={`Abrir ${g.name}`}
        onClick={(e) => onOpen(g.id, e.currentTarget.getBoundingClientRect().top)}
      >
        <GameCover
          name={g.name}
          platform={g.platform}
          cover={g.cover}
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
          {g.status === "backlog" && g.priority && (
            <span className={styles.prioDot} style={prioDot(g.priority)} aria-hidden="true" />
          )}
          <span className={styles.cardText}>{g.name}</span>
          {show.score && g.user_score !== null && (
            <span className={styles.userScore} title={`Sua nota: ${g.user_score}/10`}>
              <Icon name="star" size={11} strokeWidth={0} fill="currentColor" />
              {g.user_score}
            </span>
          )}
        </span>
        {(meta || dim) && (
          <span className={styles.meta} title={meta}>
            {dim && <span className={styles.hiddenTag}>Oculto</span>}
            {show.devices && <Icon name="device" size={12} strokeWidth={2} className={styles.metaIcon} />}
            <span className={styles.metaText}>{meta}</span>
          </span>
        )}
        <OwnerChips owners={ownersOf(g, show, accounts)} />
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
    </div>
  );
}
