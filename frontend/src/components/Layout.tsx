import { Link, NavLink, Outlet, useLocation } from "react-router";

import { Icon } from "./Icon";
import styles from "./Layout.module.css";

export function Layout() {
  const { pathname } = useLocation();
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
      </header>
      <Outlet />
    </div>
  );
}
