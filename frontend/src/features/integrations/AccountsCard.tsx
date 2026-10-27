import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";

import { errorMessage } from "../../api/client";
import { isJobActive, useAccountMutations, useAccounts, useJobs, useMeta, useSyncAccounts } from "../../api/queries";
import type { Account, Job, StoreName } from "../../api/types";
import { useConfirm } from "../../components/Confirm";
import { Icon } from "../../components/Icon";
import { StoreMark } from "../../components/StoreMark";
import { useToast } from "../../components/Toast";
import { useJobWatcher } from "../../components/useJobWatcher";
import { STORE_LABEL } from "../../lib/constants";
import { fmtLocalDateTime, plural } from "../../lib/format";
import styles from "./AccountsCard.module.css";
import { AddAccountDialog } from "./AddAccountDialog";
import { JobProgress } from "./JobProgress";

const STORES: StoreName[] = ["steam", "epic", "gog"];

const STATUS_TEXT: Record<Account["status"], string> = {
  never: "Ainda não sincronizada",
  ok: "Em dia",
  error: "Erro na última tentativa",
  reauth: "Precisa reconectar",
};

export function AccountsCard() {
  const accounts = useAccounts();
  const meta = useMeta();
  const jobs = useJobs("library_sync", 3000);
  const sync = useSyncAccounts();
  const toast = useToast();
  const [adding, setAdding] = useState<StoreName | null>(null);
  const [reconnecting, setReconnecting] = useState<Account | null>(null);

  const list = jobs.data ?? [];
  const current = list.find(isJobActive) ?? null;
  const watcher = useJobWatcher();
  const { start: watch, job: watched } = watcher;
  useEffect(() => {
    if (current && watched?.id !== current.id) watch(current);
  }, [current, watched?.id, watch]);
  const shown = (watched?.kind === "library_sync" ? watched : null) ?? current ?? list[0] ?? null;

  const accs = accounts.data ?? [];
  const syncingIds = new Set((current?.params.account_ids as number[] | undefined) ?? []);
  const steamReady = meta.data?.stores.steam ?? false;
  const hour = String(meta.data?.library_sync_hour ?? 5).padStart(2, "0");

  const syncAll = () =>
    sync.mutate(undefined, {
      onSuccess: (job) => {
        watch(job);
        toast.show("Sincronização das contas na fila.", "ok");
      },
      onError: (e) => toast.error(errorMessage(e)),
    });

  return (
    <section aria-labelledby="h-accounts" className="card">
      <div className={styles.head}>
        <h2 id="h-accounts" className="section-title">
          Contas das lojas <span className="count">{accs.length}</span>
        </h2>
        {accs.length > 0 && (
          <button type="button" className="btn btn-sm" onClick={syncAll} disabled={sync.isPending || !!current}>
            <Icon name="refresh" size={14} /> {current ? "Sincronizando…" : "Sincronizar todas"}
          </button>
        )}
      </div>
      <p className="lead">
        Os jogos das contas entram no status <strong>Biblioteca</strong>. O mesmo jogo em várias contas vira um só, com o
        apelido de cada conta. Checagem automática uma vez por dia, a partir das {hour}h; os jogos novos já chegam com
        capa, HLTB e Metacritic.
      </p>

      {accs.length > 0 && (
        <ul className={styles.list}>
          {accs.map((a) => (
            <AccountRow
              key={a.id}
              account={a}
              syncing={syncingIds.has(a.id)}
              onSynced={watch}
              onReconnect={() => setReconnecting(a)}
            />
          ))}
        </ul>
      )}

      <div className={styles.add}>
        {STORES.map((s) => (
          <button
            key={s}
            type="button"
            className="btn"
            onClick={() => setAdding(s)}
            disabled={s === "steam" && !steamReady}
            title={s === "steam" && !steamReady ? "Cadastre a chave da Steam em Configurações" : undefined}
          >
            <StoreMark store={s} /> Adicionar {STORE_LABEL[s]}
          </button>
        ))}
      </div>
      {!steamReady && meta.data && (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Para contas Steam, cadastre uma chave grátis da Steam em{" "}
          <Link to="/configuracoes#chaves">Configurações</Link> (lá tem o passo a passo).
        </p>
      )}

      {shown && <JobProgress job={shown} />}

      <AddAccountDialog
        store={adding ?? reconnecting?.store ?? null}
        account={reconnecting}
        onClose={() => {
          setAdding(null);
          setReconnecting(null);
        }}
      />
    </section>
  );
}

function AccountRow({
  account: a,
  syncing,
  onSynced,
  onReconnect,
}: {
  account: Account;
  syncing: boolean;
  onSynced: (job: Job) => void;
  onReconnect: () => void;
}) {
  const { update, unignore, remove } = useAccountMutations();
  const sync = useSyncAccounts();
  const toast = useToast();
  const [dialog, confirm] = useConfirm();
  const [renaming, setRenaming] = useState(false);
  const [nickname, setNickname] = useState(a.nickname);
  const fail = (e: unknown) => toast.error(errorMessage(e));

  const rename = (e: FormEvent) => {
    e.preventDefault();
    const name = nickname.trim();
    if (!name || name === a.nickname) return setRenaming(false);
    update.mutate({ id: a.id, patch: { nickname: name } }, { onSuccess: () => setRenaming(false), onError: fail });
  };

  const askRemove = async () => {
    const ok = await confirm({
      title: `Remover ${STORE_LABEL[a.store]} · ${a.nickname}?`,
      message: `Os ${plural(a.game_count, "jogo continua", "jogos continuam")} na biblioteca, só perdem o selo desta conta.`,
      confirmLabel: "Remover",
      danger: true,
    });
    if (ok) remove.mutate(a.id, { onError: fail });
  };

  const status = a.status === "error" && a.last_error ? a.last_error : STATUS_TEXT[a.status];
  return (
    <li className={styles.row}>
      <StoreMark store={a.store} size={36} />
      <div className={styles.info}>
        {renaming ? (
          <form className={styles.rename} onSubmit={rename}>
            <input
              className="input"
              aria-label="Apelido da conta"
              maxLength={40}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              autoFocus
            />
            <button type="submit" className="btn btn-sm btn-primary" disabled={update.isPending}>
              Salvar
            </button>
          </form>
        ) : (
          <span className={styles.name}>
            {a.nickname}
            <button
              type="button"
              className="btn btn-icon"
              onClick={() => setRenaming(true)}
              aria-label={`Renomear ${a.nickname}`}
            >
              <Icon name="edit" size={14} />
            </button>
          </span>
        )}
        <span className="muted">
          {STORE_LABEL[a.store]}
          {a.display_name ? " · " : ""}
          {a.profile_url ? (
            <a href={a.profile_url} target="_blank" rel="noopener noreferrer">
              {a.display_name ?? "perfil"}
            </a>
          ) : (
            a.display_name
          )}
          {" · "}
          {plural(a.game_count, "jogo", "jogos")}
          {a.last_sync_at ? ` · sincronizada em ${fmtLocalDateTime(a.last_sync_at)}` : ""}
        </span>
        <span className={styles.status} data-status={a.status}>
          {syncing ? "Sincronizando…" : status}
        </span>
      </div>
      <div className={styles.actions}>
        <label className="check" title="Incluir na checagem diária">
          <input
            type="checkbox"
            checked={a.enabled}
            onChange={(e) => update.mutate({ id: a.id, patch: { enabled: e.target.checked } }, { onError: fail })}
          />
          Diária
        </label>
        {a.status === "reauth" || a.store !== "steam" ? (
          <button
            type="button"
            className={`btn btn-sm ${a.status === "reauth" ? "btn-primary" : ""}`}
            onClick={onReconnect}
          >
            Reconectar
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-sm"
          disabled={sync.isPending || syncing || a.status === "reauth"}
          onClick={() => sync.mutate([a.id], { onSuccess: onSynced, onError: fail })}
        >
          <Icon name="refresh" size={14} /> Sincronizar
        </button>
        {a.ignored_count > 0 && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            title="Jogos desta conta que você apagou da biblioteca"
            onClick={() =>
              unignore.mutate(a.id, {
                onSuccess: () => toast.show("Os jogos voltam na sincronização que acabou de entrar na fila.", "ok"),
                onError: fail,
              })
            }
          >
            Restaurar {plural(a.ignored_count, "ignorado", "ignorados")}
          </button>
        )}
        <button type="button" className="btn btn-icon" onClick={askRemove} aria-label={`Remover ${a.nickname}`}>
          <Icon name="trash" />
        </button>
      </div>
      {dialog}
    </li>
  );
}
