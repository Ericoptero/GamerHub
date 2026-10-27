// Voltar do detalhe para a biblioteca (ou para a lista de onde o jogo foi aberto) no mesmo ponto. Os
// filtros já vivem na URL; aqui ficam o card clicado em cada entrada do histórico (para rolar até ele) e a
// última URL da biblioteca (link "Biblioteca").
import { useLayoutEffect } from "react";
import { useLocation, useNavigate } from "react-router";

const KEY = "gamerhub:biblioteca";
const MAX_ANCHORS = 30;
const ALIGN_FRAMES = 20;

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

/**
 * Rola até o card clicado (`[data-game]`) quando os jogos chegam. Só a posição da janela não basta: a
 * altura dos cards fora da tela é estimada (content-visibility) e a lista chegaria no lugar errado. Roda
 * depois do ScrollRestoration.
 */
export function useScrollToAnchor(ready: boolean, restore: Anchor | null): void {
  useLayoutEffect(() => {
    if (!ready || !restore) return;
    // Os cards que chegam perto da tela só ganham a altura de verdade nos quadros seguintes e empurram
    // a lista: corrige por ~1/3 s, ou até a pessoa rolar.
    let frame = 0;
    let left = ALIGN_FRAMES;
    const align = () => {
      const el = document.querySelector(`[data-game="${restore.id}"]`);
      if (!el) return;
      const delta = el.getBoundingClientRect().top - restore.top;
      if (Math.abs(delta) >= 1) window.scrollBy(0, delta);
      if (--left > 0) frame = requestAnimationFrame(align);
    };
    const stop = () => cancelAnimationFrame(frame);
    const input = new AbortController();
    for (const ev of ["wheel", "touchstart", "keydown"]) {
      window.addEventListener(ev, stop, { passive: true, signal: input.signal });
    }
    align();
    return () => {
      stop();
      input.abort();
    };
  }, [ready, restore]);
}

/** Estado do link do card: o detalhe sabe que pode simplesmente voltar no histórico. */
export const FROM_LIBRARY = { fromLibrary: true } as const;

export interface CardLinkState {
  fromLibrary: true;
  /** Aberto de uma das suas listas: o "voltar" leva para ela. */
  fromList?: { id: number; name: string };
}

export const fromList = (id: number, name: string): CardLinkState => ({ fromLibrary: true, fromList: { id, name } });

/** A lista de onde o jogo foi aberto, se foi (o menu acende "Listas" em vez de "Biblioteca"). */
export function openedFromList(state: unknown): CardLinkState["fromList"] | undefined {
  return (state as CardLinkState | null)?.fromList;
}

/**
 * Link "Biblioteca" (ou o nome da lista) do detalhe. Aberto por um card: volta no histórico (mesma lista,
 * filtros e posição). Senão (link direto, outra página): abre a biblioteca com os últimos filtros usados.
 */
export function useBackToLibrary() {
  const location = useLocation();
  const navigate = useNavigate();
  const fromLibrary = (location.state as CardLinkState | null)?.fromLibrary === true;
  const list = openedFromList(location.state);
  const search = read().search;
  const href = list ? `/listas/${list.id}` : search ? `/biblioteca?${search}` : "/biblioteca";
  const go = () => {
    if (fromLibrary) navigate(-1);
    else navigate(href);
  };
  return { href, fromLibrary, go, label: list ? list.name : "Biblioteca" };
}
