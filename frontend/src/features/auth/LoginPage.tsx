import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";

import { errorMessage } from "../../api/client";
import { useLogin, useMe, useSignup } from "../../api/queries";
import { Icon } from "../../components/Icon";
import { ErrorState, LoadingState } from "../../components/NotFound";
import styles from "./LoginPage.module.css";

type Mode = "login" | "signup";

export function LoginPage() {
  const me = useMe();
  const location = useLocation();
  const navigate = useNavigate();
  const login = useLogin();
  const signup = useSignup();
  const [mode, setMode] = useState<Mode | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (me.isPending) return <LoadingState />;
  if (me.isError) return <ErrorState error={me.error} onRetry={() => me.refetch()} />;
  const from = (location.state as { from?: string } | null)?.from || "/biblioteca";
  if (!me.data.auth_enabled || me.data.user) return <Navigate to={from} replace />;

  const { needs_setup: setup, signup_allowed: canSignup } = me.data;
  const current: Mode = setup ? "signup" : (mode ?? "login");
  const busy = login.isPending || signup.isPending;

  const switchTo = (m: Mode) => {
    setMode(m);
    setError(null);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const done = {
      onSuccess: () => navigate(from, { replace: true }),
      onError: (err: unknown) => setError(errorMessage(err)),
    };
    if (current === "login") {
      login.mutate({ username: username.trim(), password }, done);
      return;
    }
    if (password !== confirm) {
      setError("As senhas não conferem.");
      return;
    }
    signup.mutate({ username: username.trim(), password, display_name: displayName.trim() || null }, done);
  };

  return (
    <main className={styles.wrap}>
      <div className={styles.brand}>
        <span className={styles.logo}>
          <Icon name="logo" size={22} />
        </span>
        <span className={styles.brandText}>Backlog</span>
      </div>
      <form className={`card ${styles.card}`} onSubmit={submit} aria-labelledby="h-login">
        <h1 id="h-login" className="section-title">
          {setup ? "Primeiro acesso" : current === "login" ? "Entrar" : "Criar conta"}
        </h1>
        {setup && (
          <p className="lead">
            Crie a conta de administrador. Ela fica com a biblioteca que já está no GamerHub; quem se cadastrar depois
            começa com uma biblioteca vazia.
          </p>
        )}
        {!setup && canSignup && (
          <div role="tablist" aria-label="Entrar ou criar conta" className="seg">
            <button type="button" role="tab" aria-selected={current === "login"} onClick={() => switchTo("login")}>
              Entrar
            </button>
            <button type="button" role="tab" aria-selected={current === "signup"} onClick={() => switchTo("signup")}>
              Criar conta
            </button>
          </div>
        )}
        <label className="field">
          Usuário
          <input
            className="input"
            required
            autoComplete="username"
            autoCapitalize="none"
            minLength={current === "signup" ? 3 : 1}
            maxLength={40}
            pattern={current === "signup" ? "[\\w.\\-]+" : undefined}
            title="Letras, números, ponto, hífen e sublinhado"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        {current === "signup" && (
          <label className="field">
            Nome para exibir (opcional)
            <input
              className="input"
              maxLength={80}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>
        )}
        <label className="field">
          Senha
          <input
            className="input"
            type="password"
            required
            minLength={current === "signup" ? 8 : 1}
            autoComplete={current === "signup" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {current === "signup" && (
          <label className="field">
            Repita a senha
            <input
              className="input"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Aguarde…" : current === "login" ? "Entrar" : "Criar conta"}
        </button>
        {!setup && !canSignup && (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Sem conta? Peça para um administrador criar uma.
          </p>
        )}
      </form>
    </main>
  );
}
