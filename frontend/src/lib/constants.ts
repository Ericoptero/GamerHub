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

export const PRIO: Record<Priority, number> = { Alta: 0, Media: 1, Baixa: 2 };

export const PRIORITY_LABEL: Record<Priority, string> = { Alta: "Alta", Media: "Média", Baixa: "Baixa" };

export const PRIORITIES: Priority[] = ["Alta", "Media", "Baixa"];

export const KINDS = ["Console", "Portátil", "PC", "Emulador / retro", "Celular", "Outro"];

export const ACCENTS = ["#5AA8FF", "#9BE15D", "#FFB454", "#C792FF"];

export const PROVIDER_LABEL: Record<string, string> = {
  igdb: "IGDB",
  rawg: "RAWG",
  hltb: "HowLongToBeat",
  metacritic: "Metacritic",
};

export const LINK_STATUS_LABEL: Record<string, string> = {
  matched: "Encontrado",
  confirmed: "Confirmado",
  ambiguous: "Precisa confirmar",
  not_found: "Sem correspondência",
  error: "Erro",
  ignored: "Ignorado",
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
