import { Link } from "react-router";

import { errorMessage } from "../../api/client";
import { useUpdateGame } from "../../api/queries";
import type { Device, GameDetail } from "../../api/types";
import { Icon } from "../../components/Icon";
import { McRing } from "../../components/McRing";
import { StoreMark } from "../../components/StoreMark";
import { useToast } from "../../components/Toast";
import { ORIGIN_LABEL, PRIORITY_LABEL, STORE_LABEL, mcWord } from "../../lib/constants";
import { fmtDate, fmtLocalDate, hrs } from "../../lib/format";
import styles from "./GameDetail.module.css";

function LockedBadge({ game, field, label }: { game: GameDetail; field: string; label: string }) {
  const update = useUpdateGame(game.id);
  const toast = useToast();
  if (!game.locked_fields.includes(field)) return null;
  return (
    <button
      type="button"
      className={styles.lockBtn}
      title={`${label} editado à mão: a integração não sobrescreve. Clique para destravar.`}
      aria-label={`${label} travado (editado à mão). Destravar para a integração atualizar`}
      disabled={update.isPending}
      onClick={() => update.mutate({ unlock: [field] }, { onError: (e) => toast.error(errorMessage(e)) })}
    >
      <Icon name="lock" size={12} /> destravar
    </button>
  );
}

export function ScoresCard({ game }: { game: GameDetail }) {
  const mc = game.metacritic_score;
  const extra = [
    game.hltb_extra_hours ? `+extras ${hrs(game.hltb_extra_hours)}` : "",
    game.hltb_complete_hours ? `100% ${hrs(game.hltb_complete_hours)}` : "",
  ].filter(Boolean);
  return (
    <section aria-labelledby="h-notas" className="card" style={{ gap: 16 }}>
      <h2 id="h-notas" className={`section-title ${styles.asideTitle}`}>
        Notas e tempo
      </h2>
      <div className={styles.mcRow}>
        <McRing score={mc} />
        <div className={styles.mcText}>
          <span className="eyebrow" style={{ letterSpacing: 0.8 }}>
            Metacritic
          </span>
          <span className={styles.mcWord}>{mcWord(mc)}</span>
          {game.metacritic_user_score !== null && (
            <span className="muted" style={{ fontSize: 12 }}>
              Usuários: {String(game.metacritic_user_score).replace(".", ",")}/10
            </span>
          )}
          {game.metacritic_url && (
            <a href={game.metacritic_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12 }}>
              Ver no Metacritic
            </a>
          )}
          <LockedBadge game={game} field="metacritic_score" label="Metacritic" />
        </div>
      </div>
      <div className={styles.triple}>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Sua nota</span>
          <span className={styles.metricValue}>{game.user_score ?? "—"}</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>HLTB</span>
          <span className={styles.metricValue}>{hrs(game.hltb_main_hours) ?? "—"}</span>
        </div>
        <div className={styles.metric} title={game.played_hours_source === "store" ? "Somado das suas contas de loja" : undefined}>
          <span className={styles.metricLabel}>Seu tempo{game.played_hours_source === "store" ? " (lojas)" : ""}</span>
          <span className={styles.metricValue}>{hrs(game.played_hours) ?? "—"}</span>
        </div>
      </div>
      {(extra.length > 0 || game.locked_fields.includes("hltb_main_hours")) && (
        <div className="row" style={{ gap: 10 }}>
          {extra.length > 0 && <span className={styles.hltbExtra}>HLTB: {extra.join(" · ")}</span>}
          <LockedBadge game={game} field="hltb_main_hours" label="HLTB" />
        </div>
      )}
    </section>
  );
}

export function WhereCard({ game, devices }: { game: GameDetail; devices: Device[] }) {
  const where = devices.filter((d) => d.platform_ids.includes(game.platform_id));
  return (
    <section aria-labelledby="h-onde" className="card" style={{ gap: 12 }}>
      <div className={styles.headRow}>
        <h2 id="h-onde" className={`section-title ${styles.asideTitle}`}>
          Onde jogar
        </h2>
        <Link to="/consoles" className="btn btn-link">
          Gerenciar
        </Link>
      </div>
      {where.map((d) => (
        <div key={d.id} className={styles.device}>
          <span className={styles.deviceIcon} aria-hidden="true">
            <Icon name="device" strokeWidth={2} />
          </span>
          <span className={styles.deviceText}>
            <span className={styles.deviceName}>{d.name}</span>
            <span className={styles.deviceKind}>{d.kind}</span>
          </span>
        </div>
      ))}
      {!where.length && (
        <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
          Nenhum aparelho seu roda {game.platform}. Cadastre um em <Link to="/consoles">Meus consoles</Link>.
        </p>
      )}
      {game.ownerships.length > 0 && (
        <div className={styles.owned}>
          <span className="eyebrow">Nas suas contas</span>
          {game.ownerships.map((o) => (
            <div key={`${o.account_id}:${o.external_id}`} className={styles.device}>
              <StoreMark store={o.store} size={32} />
              <span className={styles.deviceText}>
                <span className={styles.deviceName}>{o.nickname}</span>
                <span className={styles.deviceKind}>
                  {[
                    STORE_LABEL[o.store],
                    o.playtime_hours ? `${hrs(o.playtime_hours)} jogadas` : "",
                    o.last_played_at ? `último: ${fmtLocalDate(o.last_played_at)}` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              {o.url && (
                <a
                  href={o.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`btn btn-icon ${styles.ownedLink}`}
                  aria-label={`Abrir ${o.name} na ${STORE_LABEL[o.store]}`}
                >
                  <Icon name="external" />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
      {game.stores.length > 0 && (
        <div className="row" style={{ gap: 6 }}>
          <span className="muted" style={{ fontSize: 12 }}>
            Lojas:
          </span>
          {game.stores.map((s) => (
            <span key={s} className="chip">
              {s}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

export function InfoCard({
  game,
  onEdit,
  onMerge,
  onDelete,
}: {
  game: GameDetail;
  onEdit: () => void;
  onMerge: () => void;
  onDelete: () => void;
}) {
  const finished = game.finished_at ? fmtDate(game.finished_at) : (game.finished_label ?? "—");
  const zerado = game.times_completed
    ? `${game.times_completed} ${game.times_completed === 1 ? "vez" : "vezes"}`
    : game.status === "done"
      ? "1 vez"
      : "—";
  return (
    <section aria-labelledby="h-info" className="card" style={{ gap: 12 }}>
      <h2 id="h-info" className={`section-title ${styles.asideTitle}`}>
        Informações
      </h2>
      <dl className={styles.dl}>
        <dt>Plataforma</dt>
        <dd>{game.platform}</dd>
        <dt>Gênero</dt>
        <dd>{game.genre ?? "Sem gênero"}</dd>
        <dt>Prioridade</dt>
        <dd>{game.priority ? PRIORITY_LABEL[game.priority] : "—"}</dd>
        <dt>Finalizado em</dt>
        <dd>{finished}</dd>
        <dt>Zerado</dt>
        <dd>{zerado}</dd>
        {game.release_date && (
          <>
            <dt>Lançamento</dt>
            <dd>{fmtDate(game.release_date)}</dd>
          </>
        )}
        {game.developer && (
          <>
            <dt>Desenvolvedor</dt>
            <dd>{game.developer}</dd>
          </>
        )}
        <dt>Origem</dt>
        <dd>{ORIGIN_LABEL[game.origin] ?? game.origin}</dd>
      </dl>
      <div className="row">
        <button type="button" className="btn btn-sm" onClick={onEdit}>
          <Icon name="edit" size={14} /> Editar
        </button>
        <button type="button" className="btn btn-sm" onClick={onMerge}>
          <Icon name="link" size={14} /> Mesclar…
        </button>
        <button type="button" className="btn btn-sm btn-danger" onClick={onDelete}>
          <Icon name="trash" size={14} /> Excluir
        </button>
      </div>
    </section>
  );
}
