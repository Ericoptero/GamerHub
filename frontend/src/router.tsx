import { createBrowserRouter, Navigate } from "react-router";

import { Layout } from "./components/Layout";
import { NotFound } from "./components/NotFound";
import { AddGamePage } from "./features/add-game/AddGamePage";
import { LoginPage } from "./features/auth/LoginPage";
import { UsersPage } from "./features/auth/UsersPage";
import { DevicesPage } from "./features/devices/DevicesPage";
import { GameDetailPage } from "./features/game-detail/GameDetailPage";
import { IntegrationsPage } from "./features/integrations/IntegrationsPage";
import { LibraryPage } from "./features/library/LibraryPage";

// Sem chave própria, a primeira entrada vira "default" em toda página carregada: abrir o app de novo na
// mesma aba (favorito, URL digitada) herdaria a rolagem salva da visita anterior. No F5 a chave fica.
if (!window.history.state?.key) {
  window.history.replaceState({ usr: null, key: Math.random().toString(36).slice(2, 10), idx: 0 }, "");
}

export const router = createBrowserRouter([
  { path: "entrar", element: <LoginPage /> },
  {
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/biblioteca" replace /> },
      { path: "biblioteca", element: <LibraryPage /> },
      { path: "jogos/:id", element: <GameDetailPage /> },
      { path: "adicionar", element: <AddGamePage /> },
      { path: "consoles", element: <DevicesPage /> },
      { path: "integracoes", element: <IntegrationsPage /> },
      { path: "usuarios", element: <UsersPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
