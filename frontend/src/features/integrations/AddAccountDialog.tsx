import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { errorMessage } from "../../api/client";
import { keys, loginUrl, useAccountMutations } from "../../api/queries";
import type { Account, StoreName } from "../../api/types";
import { Dialog } from "../../components/Dialog";
import { Icon } from "../../components/Icon";
import { useToast } from "../../components/Toast";
import { STORE_LABEL } from "../../lib/constants";
import styles from "./AccountsCard.module.css";

const STEPS: Record<Exclude<StoreName, "steam">, string[]> = {
  epic: [
    "Abra o login da Epic e entre com a conta que quer conectar (se já estiver logado com outra, saia antes).",
    'A página vai mostrar um texto parecido com {"authorizationCode": "…"}. Copie tudo e cole abaixo.',
    "O código vale poucos minutos: se der erro, abra o login de novo.",
  ],
  gog: [
    "Abra o login da GOG e entre com a conta que quer conectar.",
    "O navegador vai parar numa página em branco. Copie o endereço dela (começa com https://embed.gog.com/on_login_success e tem code=…) e cole abaixo.",
  ],
};

interface Props {
  /** Loja da conta nova (ou da conta sendo reconectada); null fecha o diálogo. */
  store: StoreName | null;
  /** Reconectar esta conta (Epic/GOG com token vencido) em vez de criar outra. */
  account: Account | null;
  onClose: () => void;
}

export function AddAccountDialog({ store, account, onClose }: Props) {
  const open = store !== null;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={
        account
          ? `Reconectar ${STORE_LABEL[account.store]} · ${account.nickname}`
          : `Adicionar conta ${STORE_LABEL[store ?? "steam"]}`
      }
    >
      {store && (
        <AccountForm key={`${store}-${account?.id ?? "new"}`} store={store} account={account} onClose={onClose} />
      )}
    </Dialog>
  );
}

function AccountForm({ store, account, onClose }: { store: StoreName } & Omit<Props, "store">) {
  const { create, reconnect } = useAccountMutations();
  const toast = useToast();
  const [ref, setRef] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const needsLogin = store !== "steam";
  const login = useQuery({
    queryKey: [...keys.accounts, "login-url", store],
    queryFn: () => loginUrl(store),
    enabled: needsLogin,
    staleTime: Infinity,
  });
  const busy = create.isPending || reconnect.isPending;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const done = (a: Account) => {
      toast.show(
        account
          ? `${a.nickname} reconectada. Sincronizando…`
          : `${STORE_LABEL[a.store]} · ${a.nickname} adicionada. Buscando os jogos…`,
        "ok",
      );
      onClose();
    };
    const fail = (err: unknown) => setError(errorMessage(err));
    if (account) {
      reconnect.mutate({ id: account.id, ref: ref.trim() }, { onSuccess: done, onError: fail });
    } else {
      create.mutate({ store, nickname: nickname.trim(), ref: ref.trim() }, { onSuccess: done, onError: fail });
    }
  };

  return (
    <form onSubmit={submit} className={styles.form}>
      {needsLogin && (
        <ol className={styles.steps}>
          {STEPS[store].map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      )}
      {needsLogin && (
        <a
          className="btn"
          href={login.data ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={!login.data}
          style={{ alignSelf: "flex-start" }}
        >
          <Icon name="external" size={14} /> Abrir login da {STORE_LABEL[store]}
        </a>
      )}
      <label className="field">
        {store === "steam"
          ? "URL do perfil Steam (ou o ID de 17 dígitos)"
          : store === "epic"
            ? "Texto da página ou código"
            : "Endereço da página em branco"}
        {store === "steam" ? (
          <input
            className="input"
            required
            placeholder="https://steamcommunity.com/id/JogadorExemplo/"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            autoFocus
          />
        ) : (
          <textarea
            className="textarea"
            required
            rows={3}
            spellCheck={false}
            placeholder={
              store === "epic"
                ? '{"authorizationCode":"…"}'
                : "https://embed.gog.com/on_login_success?origin=client&code=…"
            }
            value={ref}
            onChange={(e) => setRef(e.target.value)}
          />
        )}
      </label>
      {store === "steam" && (
        <p className="muted" style={{ margin: 0, fontSize: 12, lineHeight: 1.5 }}>
          Funciona com <code>steamcommunity.com/id/…</code> e <code>steamcommunity.com/profiles/…</code>. O perfil
          precisa mostrar os jogos: em Privacidade, deixe “Detalhes do jogo” como Público.
        </p>
      )}
      {!account && (
        <label className="field">
          Apelido (aparece nos jogos)
          <input
            className="input"
            required
            maxLength={40}
            placeholder={store === "steam" ? "Ex.: Principal, Irmão" : "Ex.: Epic do Bruno"}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
        </label>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="row-end">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Conectando…" : account ? "Reconectar" : "Adicionar"}
        </button>
      </div>
    </form>
  );
}
