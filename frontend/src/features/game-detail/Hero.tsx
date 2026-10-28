import { useState, type CSSProperties } from "react";
import { Link } from "react-router";

import type { Access, GameDetail, Priority, Status } from "../../api/types";
import { AccessBadge } from "../../components/AccessBadge";
import { GameCover } from "../../components/GameCover";
import { Icon } from "../../components/Icon";
import {
  ACCESS_HINT,
  ACCESS_LABEL,
  ACCESS_ORDER,
  PRIORITIES,
  PRIORITY_LABEL,
  STATUS,
  STATUS1,
  STATUS_DOT,
  STATUS_HINT,
  STATUS_ORDER,
} from "../../lib/constants";
import { initials } from "../../lib/cover";
import { useBackToLibrary } from "../library/returnTo";
import styles from "./GameDetail.module.css";

export function Hero({
  game,
  onMove,
  onPriority,
  onAccess,
  onRelease,
  busy,
}: {
  game: GameDetail;
  onMove: (s: Status) => void;
  onPriority: (p: Priority | null) => void;
  onAccess: (a: Access) => void;
  onRelease: (date: string | null) => void;
  busy: boolean;
}) {
  const genreShort = (game.genre ?? "").replace(/\s*\(.*\)\s*/, "");
  const tags = Array.from(new Set([game.platform, genreShort].filter(Boolean)));
  const backdrop = game.background ?? game.cover;
  const back = useBackToLibrary();

  return (
    <section aria-label="Cabeçalho do jogo" className={styles.hero}>
      <span className={styles.heroInitials} aria-hidden="true">
        {initials(game.name)}
      </span>
      {backdrop && <img className={styles.heroImg} src={backdrop} alt="" />}
      <span className={styles.heroFade} aria-hidden="true" />
      <div className={styles.heroInner}>
        <Link
          to={back.href}
          className={styles.back}
          onClick={(e) => {
            // Ctrl/meio-clique abrem a lista numa aba nova, como um link normal.
            if (!back.fromLibrary || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            back.go();
          }}
        >
          <Icon name="back" strokeWidth={2.4} />
          <span className={styles.backText}>{back.label}</span>
        </Link>
        <div className={styles.heroRow}>
          <GameCover name={game.name} platform={game.platform} cover={game.cover} size="hero" alt={`Capa de ${game.name}`} />
          <div className={styles.heroInfo}>
            <span className={styles.statusChip} style={{ color: STATUS_DOT[game.status] }}>
              {STATUS1[game.status]}
            </span>
            <h1 className={styles.heroTitle}>{game.name}</h1>
            <div className={styles.tags}>
              {tags.map((t) => (
                <span key={t} className={styles.tag}>
                  {t}
                </span>
              ))}
            </div>
            <ListPicker game={game} onMove={onMove} busy={busy} />
            <PriorityPicker priority={game.priority} onChange={onPriority} busy={busy} />
            <AccessPicker access={game.access} onChange={onAccess} busy={busy} />
            {game.status === "hype" && <ReleaseField key={game.release_date ?? ""} game={game} onChange={onRelease} />}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Em qual status o jogo está: um clique troca, e a linha de baixo explica o status apontado. */
function ListPicker({ game, onMove, busy }: { game: GameDetail; onMove: (s: Status) => void; busy: boolean }) {
  const [hovered, setHovered] = useState<Status | null>(null);
  const shown = hovered ?? game.status;
  return (
    <div className={styles.picker}>
      <span id="h-lista" className={styles.pickerLabel}>
        Status
      </span>
      <div className={styles.moves} role="group" aria-labelledby="h-lista" onMouseLeave={() => setHovered(null)}>
        {STATUS_ORDER.map((s) => {
          const current = s === game.status;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={current}
              // aria-disabled em vez de disabled: o foco fica no botão enquanto salva.
              aria-disabled={busy || undefined}
              aria-describedby="lista-dica"
              className={`${styles.move} ${current ? styles.moveOn : ""}`}
              style={{ "--dot": STATUS_DOT[s] } as CSSProperties}
              onMouseEnter={() => setHovered(s)}
              onFocus={() => setHovered(s)}
              onBlur={() => setHovered(null)}
              onClick={() => !current && !busy && onMove(s)}
            >
              {current ? (
                <Icon name="check" size={14} strokeWidth={3} className={styles.moveCheck} />
              ) : (
                <span className={styles.moveDot} aria-hidden="true" />
              )}
              {STATUS[s]}
            </button>
          );
        })}
      </div>
      <p id="lista-dica" className={styles.pickerHint} aria-live="polite">
        {shown === game.status ? (
          <>
            <strong>Está em {STATUS[shown]}.</strong> {STATUS_HINT[shown]}
          </>
        ) : (
          <>
            <strong>Mover para {STATUS[shown]}:</strong> {STATUS_HINT[shown]}
            {shown === "done" && !game.finished_at && " A data de término fica como hoje."}
          </>
        )}
      </p>
    </div>
  );
}

const PRIO_COLOR: Record<Priority, string> = { Alta: "var(--prio-alta)", Media: "var(--prio-media)", Baixa: "var(--muted)" };

/** Prioridade à vista e editável num clique; é ela que ordena a Lista de espera. */
function PriorityPicker({
  priority,
  onChange,
  busy,
}: {
  priority: Priority | null;
  onChange: (p: Priority | null) => void;
  busy: boolean;
}) {
  const choices: (Priority | null)[] = [...PRIORITIES, null];
  return (
    <div className={styles.prioRow}>
      <span id="h-prio" className={styles.pickerLabel}>
        Prioridade
      </span>
      <div className={styles.prios} role="group" aria-labelledby="h-prio" aria-describedby="prio-dica">
        {choices.map((p) => {
          const current = p === priority;
          return (
            <button
              key={p ?? "none"}
              type="button"
              aria-pressed={current}
              aria-disabled={busy || undefined}
              className={`${styles.move} ${styles.prio} ${current ? styles.moveOn : ""}`}
              style={{ "--dot": p ? PRIO_COLOR[p] : "var(--muted)" } as CSSProperties}
              onClick={() => !current && !busy && onChange(p)}
            >
              {current ? (
                <Icon name="check" size={14} strokeWidth={3} className={styles.moveCheck} />
              ) : (
                p && <span className={`${styles.moveDot} ${p === "Baixa" ? styles.dotRing : ""}`} aria-hidden="true" />
              )}
              {p ? PRIORITY_LABEL[p] : "Nenhuma"}
            </button>
          );
        })}
      </div>
      <span id="prio-dica" className={styles.prioNote}>
        A Lista de espera é ordenada por ela.
      </span>
    </div>
  );
}

const ACCESS_COLOR: Record<Access, string> = {
  owned: "var(--ok)",
  unreleased: "var(--st-hype)",
  wishlist: "var(--text-2)",
  gamepass: "#4fb04f",
};

/** Se você tem o jogo, à parte do status; fora o "Tenho", vira um ícone no card. */
function AccessPicker({ access, onChange, busy }: { access: Access; onChange: (a: Access) => void; busy: boolean }) {
  const [hovered, setHovered] = useState<Access | null>(null);
  const shown = hovered ?? access;
  return (
    <div className={styles.prioRow}>
      <span id="h-posse" className={styles.pickerLabel}>
        Posse
      </span>
      <div
        className={styles.prios}
        role="group"
        aria-labelledby="h-posse"
        aria-describedby="posse-dica"
        onMouseLeave={() => setHovered(null)}
      >
        {ACCESS_ORDER.map((a) => {
          const current = a === access;
          return (
            <button
              key={a}
              type="button"
              aria-pressed={current}
              aria-disabled={busy || undefined}
              className={`${styles.move} ${styles.prio} ${current ? styles.moveOn : ""}`}
              style={{ "--dot": ACCESS_COLOR[a] } as CSSProperties}
              onMouseEnter={() => setHovered(a)}
              onFocus={() => setHovered(a)}
              onBlur={() => setHovered(null)}
              onClick={() => !current && !busy && onChange(a)}
            >
              {current ? (
                <Icon name="check" size={14} strokeWidth={3} className={styles.moveCheck} />
              ) : (
                <AccessBadge access={a} variant="inline" />
              )}
              {ACCESS_LABEL[a]}
            </button>
          );
        })}
      </div>
      <span id="posse-dica" className={styles.prioNote} aria-live="polite">
        {ACCESS_HINT[shown]}
      </span>
    </div>
  );
}

/** Data de lançamento de um jogo no Hype: é ela que aparece no card. Salva ao sair do campo. */
function ReleaseField({ game, onChange }: { game: GameDetail; onChange: (date: string | null) => void }) {
  const [value, setValue] = useState(game.release_date ?? "");
  // Data digitada pela metade chega vazia ("badInput"): não apaga a data salva.
  const save = (input: HTMLInputElement) => {
    if (!input.validity.badInput && (value || null) !== game.release_date) onChange(value || null);
  };
  return (
    <div className={styles.prioRow}>
      <label htmlFor="h-lancamento" className={styles.pickerLabel}>
        Lançamento
      </label>
      <input
        id="h-lancamento"
        type="date"
        className={`input ${styles.releaseInput}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={(e) => save(e.currentTarget)}
        onKeyDown={(e) => e.key === "Enter" && save(e.currentTarget)}
        aria-describedby="lancamento-dica"
      />
      <span id="lancamento-dica" className={styles.prioNote}>
        {game.release_date
          ? "Aparece no card do Hype."
          : "Sem data ainda: ponha aqui ou espere a integração trazer. Aparece no card do Hype."}
        {game.locked_fields.includes("release_date") && " Editada à mão: a integração não troca."}
      </span>
    </div>
  );
}
