import { useState, type FormEvent } from "react";

import { errorMessage } from "../../api/client";
import { useMe, useUserMutations, useUsers } from "../../api/queries";
import type { UserAdmin } from "../../api/types";
import { useConfirm } from "../../components/Confirm";
import { Dialog } from "../../components/Dialog";
import { Icon } from "../../components/Icon";
import { ErrorState, LoadingState, NotFound } from "../../components/NotFound";
import { useToast } from "../../components/Toast";
import { fmtLocalDateTime, plural } from "../../lib/format";

export function UsersPage() {
  const me = useMe();
  const isAdmin = !!me.data?.auth_enabled && !!me.data.user?.is_admin;
  const users = useUsers(isAdmin);
  const { update, remove } = useUserMutations();
  const toast = useToast();
  const [dialog, confirm] = useConfirm();
  const [resetting, setResetting] = useState<UserAdmin | null>(null);

  if (me.isPending) return <LoadingState />;
  if (!isAdmin) return <NotFound message="Só administradores veem os usuários (e só com o login ligado)." />;
  if (users.isPending) return <LoadingState />;
  if (users.isError) return <ErrorState error={users.error} onRetry={() => users.refetch()} />;
  const selfId = me.data?.user?.id;

  const toggleAdmin = (u: UserAdmin) =>
    update.mutate({ id: u.id, patch: { is_admin: !u.is_admin } }, { onError: (err) => toast.error(errorMessage(err)) });

  const askRemove = async (u: UserAdmin) => {
    const ok = await confirm({
      title: `Remover ${u.display_name}?`,
      message: `A biblioteca dele (${plural(u.game_count, "jogo", "jogos")}, aparelhos e contas de loja) será apagada. Não dá para desfazer.`,
      confirmLabel: "Remover",
      danger: true,
    });
    if (ok) remove.mutate(u.id, { onError: (err) => toast.error(errorMessage(err)) });
  };

  return (
    <main className="page page-narrow">
      <div className="page-head">
        <h1 className="page-title">Usuários</h1>
        <p className="lead">
          Cada usuário tem a própria biblioteca, aparelhos e contas de loja. Plataformas e gêneros são de todos.
        </p>
      </div>
      <section className="card" aria-labelledby="h-users">
        <h2 id="h-users" className="section-title">
          Contas <span className="count">{users.data.length}</span>
        </h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Usuário</th>
                <th scope="col">Jogos</th>
                <th scope="col">Último acesso</th>
                <th scope="col">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.data.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.display_name}</strong> <span className="muted">@{u.username}</span>
                    {u.is_admin && (
                      <span className="chip" style={{ marginLeft: 8 }}>
                        Admin
                      </span>
                    )}
                  </td>
                  <td>{u.game_count}</td>
                  <td>{u.last_login_at ? fmtLocalDateTime(u.last_login_at) : "—"}</td>
                  <td>
                    <div className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => toggleAdmin(u)}
                        disabled={update.isPending}
                      >
                        {u.is_admin ? "Tirar admin" : "Tornar admin"}
                      </button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setResetting(u)}>
                        Redefinir senha
                      </button>
                      {u.id !== selfId && u.id !== 1 && (
                        <button
                          type="button"
                          className="btn btn-icon"
                          onClick={() => askRemove(u)}
                          aria-label={`Remover ${u.display_name}`}
                        >
                          <Icon name="trash" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <NewUserForm />
      <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />
      {dialog}
    </main>
  );
}

function NewUserForm() {
  const { create } = useUserMutations();
  const toast = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [admin, setAdmin] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      { username: username.trim(), password, is_admin: admin },
      {
        onSuccess: (u) => {
          toast.show(`Conta ${u.username} criada.`, "ok");
          setUsername("");
          setPassword("");
          setAdmin(false);
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  return (
    <form className="card" onSubmit={submit} aria-labelledby="h-new-user">
      <h2 id="h-new-user" className="section-title">
        Nova conta
      </h2>
      <p className="lead">Útil quando o cadastro está fechado (AUTH_ALLOW_SIGNUP=false).</p>
      <div className="field-grid">
        <label className="field">
          Usuário
          <input
            className="input"
            required
            minLength={3}
            maxLength={40}
            pattern="[\w.\-]+"
            autoComplete="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="field">
          Senha inicial
          <input
            className="input"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} /> Administrador
      </label>
      <div className="row-end">
        <button type="submit" className="btn btn-primary" disabled={create.isPending}>
          Criar conta
        </button>
      </div>
    </form>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: UserAdmin | null; onClose: () => void }) {
  const { resetPassword } = useUserMutations();
  const toast = useToast();
  const [password, setPassword] = useState("");

  const close = () => {
    setPassword("");
    onClose();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    resetPassword.mutate(
      { id: user.id, password },
      {
        onSuccess: () => {
          toast.show(`Senha de ${user.username} redefinida. As sessões dele foram encerradas.`, "ok");
          close();
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  return (
    <Dialog open={!!user} onClose={close} title={`Redefinir senha de ${user?.display_name ?? ""}`}>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label className="field">
          Nova senha (mínimo 8 caracteres)
          <input
            className="input"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <div className="row-end">
          <button type="button" className="btn btn-ghost" onClick={close}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={resetPassword.isPending}>
            Redefinir
          </button>
        </div>
      </form>
    </Dialog>
  );
}
