import type { Access } from "../api/types";
import { ACCESS_LABEL } from "../lib/constants";
import { fmtDate } from "../lib/format";
import styles from "./AccessBadge.module.css";
import { Icon } from "./Icon";

/** Texto da posse para leitor de tela e dica: "Aguardando lançamento · 12/05/2027". */
export function accessText(access: Access, releaseDate?: string | null): string {
  return access === "unreleased" && releaseDate ? `${ACCESS_LABEL[access]} · ${fmtDate(releaseDate)}` : ACCESS_LABEL[access];
}

/**
 * Ícone da posse: ampulheta (aguardando lançamento), carrinho (ainda não comprei) e "GP" (Game Pass).
 * "Tenho" é o normal e fica sem ícone. "cover": bolinha sobre a capa; "inline": ao lado do nome.
 */
export function AccessBadge({
  access,
  releaseDate,
  variant = "cover",
}: {
  access: Access;
  releaseDate?: string | null;
  variant?: "cover" | "inline";
}) {
  if (access === "owned") return null;
  const label = accessText(access, releaseDate);
  return (
    <span
      className={`${styles.badge} ${styles[access]} ${variant === "inline" ? styles.inline : ""}`}
      role="img"
      aria-label={label}
      title={label}
    >
      {access === "gamepass" ? (
        "GP"
      ) : (
        <Icon name={access === "unreleased" ? "hourglass" : "cart"} size={variant === "inline" ? 11 : 14} strokeWidth={2.4} />
      )}
    </span>
  );
}
