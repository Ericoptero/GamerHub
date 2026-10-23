import type { CSSProperties } from "react";

import { initials, palette } from "../lib/cover";
import styles from "./GameCover.module.css";

interface Props {
  name: string;
  platform: string;
  cover: string | null;
  size?: "card" | "hero";
  /** Faixa inferior com tempo e Metacritic (só no card da biblioteca). */
  footer?: { left: string; right: string; rightColor: string };
  alt?: string;
}

/** Capa 2:3: a imagem da integração quando existir; senão a capa gerada do protótipo. */
export function GameCover({ name, platform, cover, size = "card", footer, alt = "" }: Props) {
  const [bg, band] = palette(name, platform);
  const style = { "--c0": bg, "--c1": band } as CSSProperties;
  return (
    <span className={`${styles.cover} ${size === "hero" ? styles.hero : ""}`} style={style}>
      <span className={styles.initials} aria-hidden="true">
        {initials(name)}
      </span>
      <span className={styles.band} />
      <span className={styles.platform}>{platform}</span>
      <span className={styles.name}>{name}</span>
      {cover && <img className={styles.img} src={cover} alt={alt} loading="lazy" decoding="async" />}
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
