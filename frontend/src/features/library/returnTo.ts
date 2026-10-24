// Voltar do detalhe para a biblioteca no mesmo ponto. Os filtros já vivem na URL; aqui ficam o card
// clicado em cada entrada do histórico (para rolar até ele) e a última URL da lista (link "Biblioteca").
import { useLocation, useNavigate } from "react-router";

const KEY = "gamerhub:biblioteca";
const MAX_ANCHORS = 30;

/** Card clicado: distância dele até o topo da janela e se o painel de filtros estava aberto. */
export interface Anchor {
  id: number;
  top: number;
  panel: boolean;
}

interface Saved {
  search: string;
  anchors: Record<string, Anchor>;
}

function read(): Saved {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) return { search: "", anchors: {}, ...(JSON.parse(raw) as Partial<Saved>) };
  } catch {
    // Sem sessionStorage (aba anônima bloqueada): volta para o topo da lista.
  }
  return { search: "", anchors: {} };
}

function write(saved: Saved): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // idem
  }
}

export function rememberSearch(search: string): void {
  const saved = read();
  if (saved.search !== search) write({ ...saved, search });
}

/** `locationKey` é a entrada do histórico da lista: o "voltar" do navegador cai nela de novo. */
export function rememberAnchor(locationKey: string, anchor: Anchor): void {
  const saved = read();
  const anchors = { ...saved.anchors };
  delete anchors[locationKey];
  anchors[locationKey] = anchor;
  const keys = Object.keys(anchors);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ANCHORS))) delete anchors[k];
  write({ ...saved, anchors });
}

export const savedAnchor = (locationKey: string): Anchor | null => read().anchors[locationKey] ?? null;

/** Estado do link do card: o detalhe sabe que pode simplesmente voltar no histórico. */
export const FROM_LIBRARY = { fromLibrary: true };

/**
 * Link "Biblioteca" do detalhe. Aberto por um card: volta no histórico (mesma lista, filtros e posição).
 * Senão (link direto, outra página): abre a lista com os últimos filtros usados.
 */
export function useBackToLibrary() {
  const location = useLocation();
  const navigate = useNavigate();
  const fromLibrary = (location.state as typeof FROM_LIBRARY | null)?.fromLibrary === true;
  const search = read().search;
  const href = search ? `/biblioteca?${search}` : "/biblioteca";
  const go = () => {
    if (fromLibrary) navigate(-1);
    else navigate(href);
  };
  return { href, fromLibrary, go };
}
