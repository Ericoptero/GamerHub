import { useState, type CSSProperties } from "react";

import { initials, palette } from "../lib/cover";
import styles from "./GameCover.module.css";

interface Props {
  name: string;
  platform: string;
  cover: string | null;
  /** "thumb": miniatura das linhas e do mosaico das listas (sem os textos da capa gerada). */
  size?: "card" | "hero" | "thumb";
  /** Faixa inferior com tempo e Metacritic (só no card da biblioteca). */
  footer?: { left: string; right: string; rightColor: string };
  alt?: string;
  /** Sem as iniciais da capa gerada (capas sobrepostas do mosaico, onde só aparece uma tira). */
  hideInitials?: boolean;
}

/** Capa 2:3: a imagem da integração quando existir; senão a capa gerada do protótipo. */
export function GameCover({ name, platform, cover, size = "card", footer, alt = "", hideInitials }: Props) {
  const [bg, band] = palette(name, platform);
  const style = { "--c0": bg, "--c1": band } as CSSProperties;
  // Capa que não carrega (ex.: arte da loja que mudou de endereço): fica a capa gerada.
  const [broken, setBroken] = useState<string | null>(null);
  return (
    <span className={`${styles.cover} ${size === "hero" ? styles.hero : size === "thumb" ? styles.thumb : ""}`} style={style}>
      {!hideInitials && (
        <span className={styles.initials} aria-hidden="true">
          {initials(name)}
        </span>
      )}
      <span className={styles.band} />
      <span className={styles.platform}>{platform}</span>
      <span className={styles.name}>{name}</span>
      {cover && cover !== broken && (
        <img
          className={styles.img}
          src={cover}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setBroken(cover)}
        />
      )}
      {footer && (
        <span className={styles.footer}>
          <span className={styles.footerLeft}>{footer.left}</span>
          <span className={styles.footerRight} style={{ color: footer.rightColor, fontWeight: 700 }}>
            {footer.right}
          </span>
        </span>
      )}
    </span>
  );
}
