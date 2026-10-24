import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, NavLink, Outlet, ScrollRestoration, useLocation, useNavigate } from "react-router";

import { UNAUTHORIZED_EVENT } from "../api/client";
import { keys, useLogout, useMe } from "../api/queries";
import type { User } from "../api/types";
import { ChangePasswordDialog } from "../features/auth/ChangePasswordDialog";
import { Icon } from "./Icon";
import styles from "./Layout.module.css";
import { ErrorState, LoadingState } from "./NotFound";

export function Layout() {
  const { pathname, search } = useLocation();
  const qc = useQueryClient();
  const me = useMe();

  // Qualquer 401 da API (sessão expirou, outro navegador trocou a senha…) volta para a tela de login.
  useEffect(() => {
    const onUnauthorized = () => qc.invalidateQueries({ queryKey: keys.me });
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [qc]);

  if (me.isPending) return <LoadingState />;
  if (me.isError) return <ErrorState error={me.error} onRetry={() => me.refetch()} />;
  if (me.data.auth_enabled && !me.data.user) {
    return <Navigate to="/entrar" replace state={{ from: pathname + search }} />;
  }

  const libActive = pathname.startsWith("/biblioteca") || pathname.startsWith("/jogos");
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link to="/biblioteca" className={styles.brand} aria-label="Início">
          <span className={styles.logo}>
            <Icon name="logo" size={18} />
          </span>
          <span className={styles.brandText}>Backlog</span>
        </Link>
        <nav aria-label="Principal" className={styles.nav}>
          <Link
            to="/biblioteca"
            className={`${styles.navItem} ${libActive ? styles.navOn : ""}`}
            aria-current={libActive ? "page" : undefined}
          >
            Biblioteca
          </Link>
          <NavLink to="/consoles" className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navOn : ""}`}>
            Meus consoles
          </NavLink>
          <NavLink to="/integracoes" className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navOn : ""}`}>
            Integrações
          </NavLink>
        </nav>
        <Link to="/adicionar" className={`btn btn-primary ${styles.add}`} aria-label="Adicionar jogo">
          <Icon name="plus" strokeWidth={2.6} />
          <span className={styles.addText}>Adicionar jogo</span>
        </Link>
        {me.data.auth_enabled && me.data.user && <UserMenu user={me.data.user} />}
      </header>
      {/* Topo ao abrir uma página, posição de volta no "voltar". Fica antes do Outlet: a biblioteca
          ajusta depois (rola até o card clicado). */}
      <ScrollRestoration />
      <Outlet />
    </div>
  );
}

function UserMenu({ user }: { user: User }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [changing, setChanging] = useState(false);
  const logout = useLogout();
  const navigate = useNavigate();
  const close = () => ref.current?.removeAttribute("open");

  // Fecha ao clicar fora.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return (
    <details ref={ref} className={styles.userMenu}>
      <summary className={`btn btn-ghost ${styles.userButton}`} aria-label={`Conta: ${user.display_name}`}>
        <Icon name="user" />
        <span className={styles.userName}>{user.display_name}</span>
      </summary>
      <div className={styles.menu} role="menu">
        <span className={styles.menuHead}>
          {user.display_name}
          <span className="muted">@{user.username}</span>
        </span>
        <button
          type="button"
          role="menuitem"
          className={styles.menuItem}
          onClick={() => {
            close();
            setChanging(true);
          }}
        >
          <Icon name="lock" /> Trocar senha
        </button>
        {user.is_admin && (
          <Link to="/usuarios" role="menuitem" className={styles.menuItem} onClick={close}>
            <Icon name="user" /> Usuários
          </Link>
        )}
        <button
          type="button"
          role="menuitem"
          className={styles.menuItem}
          disabled={logout.isPending}
          onClick={() => {
            close();
            logout.mutate(undefined, { onSuccess: () => navigate("/entrar", { replace: true }) });
          }}
        >
          <Icon name="logout" /> Sair
        </button>
      </div>
      <ChangePasswordDialog open={changing} onClose={() => setChanging(false)} />
    </details>
  );
}
