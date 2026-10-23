import { createBrowserRouter, Navigate } from "react-router";

import { Layout } from "./components/Layout";
import { NotFound } from "./components/NotFound";
import { AddGamePage } from "./features/add-game/AddGamePage";
import { DevicesPage } from "./features/devices/DevicesPage";
import { GameDetailPage } from "./features/game-detail/GameDetailPage";
import { IntegrationsPage } from "./features/integrations/IntegrationsPage";
import { LibraryPage } from "./features/library/LibraryPage";

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/biblioteca" replace /> },
      { path: "biblioteca", element: <LibraryPage /> },
      { path: "jogos/:id", element: <GameDetailPage /> },
      { path: "adicionar", element: <AddGamePage /> },
      { path: "consoles", element: <DevicesPage /> },
      { path: "integracoes", element: <IntegrationsPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
