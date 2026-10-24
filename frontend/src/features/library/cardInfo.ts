// O que cada card da biblioteca mostra embaixo da capa: plataforma, onde jogar, contas e sua nota.
// Cada item liga/desliga nas preferências; no modo automático, o que é igual em todos os
// cards da lista sai do card e aparece uma vez no subtítulo.
import type { Account, Device, GameCard } from "../../api/types";
import type { CardPrefs } from "../../lib/prefs";
import { accountLabel } from "./filters";

/** platform_id -> nomes dos aparelhos que rodam a plataforma (a regra do "Onde jogar"). */
export function devicesByPlatform(devices: Device[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const d of devices) {
    for (const pid of d.platform_ids) out.set(pid, [...(out.get(pid) ?? []), d.name]);
  }
  return out;
}

export interface CardDisplay {
  platform: boolean;
  devices: boolean;
  accounts: boolean;
  score: boolean;
  /** O que é igual em todos os cards e foi para o subtítulo. */
  shared: { platform?: string; devices?: string[]; accountIds?: number[] };
}

const accountKey = (g: GameCard) => [...g.account_ids].sort((a, b) => a - b).join(",");

export function cardDisplay(list: GameCard[], prefs: CardPrefs, devicesOf: Map<number, string[]>): CardDisplay {
  const out: CardDisplay = {
    platform: prefs.platform,
    devices: prefs.devices,
    accounts: prefs.accounts,
    score: prefs.score,
    shared: {},
  };
  if (!prefs.auto || list.length < 2) return out;
  const [first] = list;
  if (list.every((g) => g.platform_id === first.platform_id)) {
    if (out.platform) {
      out.platform = false;
      out.shared.platform = first.platform;
    }
    if (out.devices) {
      out.devices = false;
      out.shared.devices = devicesOf.get(first.platform_id) ?? [];
    }
  }
  if (out.accounts && list.every((g) => accountKey(g) === accountKey(first))) {
    out.accounts = false;
    if (first.account_ids.length) out.shared.accountIds = [...first.account_ids];
  }
  return out;
}

/** Texto do subtítulo com o que saiu dos cards ("todos em PC · jogáveis em PC, Steam Deck"). */
export function sharedSummary(shared: CardDisplay["shared"], accounts: Map<number, Account>): string[] {
  const parts: string[] = [];
  if (shared.platform) parts.push(`todos em ${shared.platform}`);
  if (shared.devices) {
    parts.push(shared.devices.length ? `jogáveis em ${shared.devices.join(", ")}` : "nenhum aparelho seu roda");
  }
  if (shared.accountIds?.length) {
    const labels = shared.accountIds.map((id) => accounts.get(id)).filter((a): a is Account => !!a);
    if (labels.length) parts.push(`nas contas ${labels.map(accountLabel).join(", ")}`);
  }
  return parts;
}

/** Linha de meta do card: "PC · PC, Steam Deck" (ou só uma das partes). */
export function metaLine(g: GameCard, show: CardDisplay, devicesOf: Map<number, string[]>): string {
  const parts: string[] = [];
  if (show.platform) parts.push(g.platform);
  if (show.devices) {
    const where = devicesOf.get(g.platform_id) ?? [];
    parts.push(where.length ? where.join(", ") : "nenhum aparelho seu");
  }
  return parts.join(" · ");
}
