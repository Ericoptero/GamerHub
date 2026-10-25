import type { Priority, Status } from "../api/types";

export const STATUS_ORDER: Status[] = ["backlog", "playing", "done", "dropped", "hype", "owned"];

export const STATUS: Record<Status, string> = {
  backlog: "Lista de espera",
  playing: "Jogando",
  done: "Finalizados",
  dropped: "Dropados",
  hype: "Hype",
  owned: "Biblioteca",
};

export const STATUS1: Record<Status, string> = {
  backlog: "Na fila",
  playing: "Jogando",
  done: "Finalizado",
  dropped: "Dropado",
  hype: "Hype",
  owned: "Na biblioteca",
};

export const STATUS_DOT: Record<Status, string> = {
  backlog: "#5AA8FF",
  playing: "#9BE15D",
  done: "#C792FF",
  dropped: "#FF8A8A",
  hype: "#FFB454",
  owned: "#7FD1C7",
};

/** O que cada lista quer dizer, para o seletor de lista da página do jogo. */
export const STATUS_HINT: Record<Status, string> = {
  backlog: "Quero jogar: o jogo entra na fila, com prioridade.",
  playing: "Estou jogando agora.",
  done: "Terminei: zerei ou cheguei aonde queria.",
  dropped: "Parei no meio e não pretendo voltar tão cedo.",
  hype: "Ainda não saiu ou estou de olho para comprar.",
  owned: "Tenho o jogo, mas ainda sem planos de jogar. É onde caem os jogos das contas de loja.",
};

export const PRIO: Record<Priority, number> = { Alta: 0, Media: 1, Baixa: 2 };

export const PRIORITY_LABEL: Record<Priority, string> = { Alta: "Alta", Media: "Média", Baixa: "Baixa" };

export const PRIORITIES: Priority[] = ["Alta", "Media", "Baixa"];

export const KINDS = ["Console", "Portátil", "PC", "Emulador / retro", "Celular", "Outro"];

export const ACCENTS = ["#5AA8FF", "#9BE15D", "#FFB454", "#C792FF"];

export const STORE_LABEL: Record<string, string> = { steam: "Steam", epic: "Epic", gog: "GOG" };

export const PROVIDER_LABEL: Record<string, string> = {
  igdb: "IGDB",
  rawg: "RAWG",
  hltb: "HowLongToBeat",
  metacritic: "Metacritic",
  steam: "Steam",
};

export const JOB_KIND_LABEL: Record<string, string> = {
  refresh: "Atualização de jogo",
  enrich: "Enriquecimento",
  library_sync: "Sincronização das contas",
};

export const JOB_STATUS_LABEL: Record<string, string> = {
  queued: "na fila",
  running: "rodando",
  done: "concluído",
  cancelled: "cancelado",
  failed: "falhou",
};

export const ORIGIN_LABEL: Record<string, string> = {
  planilha: "Planilha",
  manual: "Manual",
  igdb: "Integração · IGDB",
  rawg: "Integração · RAWG",
  steam: "Conta Steam",
  epic: "Conta Epic",
  gog: "Conta GOG",
};

export function mcColor(mc: number | null | undefined): string {
  return mc == null ? "#8B94A7" : mc >= 75 ? "#5CD68A" : mc >= 50 ? "#FFC857" : "#FF8A8A";
}

export function mcWord(mc: number | null | undefined): string {
  return mc == null
    ? "Sem nota ainda"
    : mc >= 75
      ? "Aclamado pela crítica"
      : mc >= 50
        ? "Recepção mista"
        : "Recepção fraca";
}
