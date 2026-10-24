import { useEffect, useRef } from "react";

import { Icon } from "../../components/Icon";
import { usePrefs, type CardPrefs } from "../../lib/prefs";
import styles from "./LibraryPage.module.css";

const OPTIONS: [keyof CardPrefs, string][] = [
  ["platform", "Plataforma"],
  ["devices", "Jogável em (seus aparelhos)"],
  ["accounts", "Contas das lojas"],
  ["score", "Sua nota"],
  ["auto", "Esconder o que for igual em todos os cards (automático)"],
];

/** Checkboxes do que aparece nos cards; salvo no navegador. Usado no menu "Exibir" e nas preferências. */
export function CardDisplayOptions() {
  const [prefs, update] = usePrefs();
  return (
    <div role="group" aria-label="Exibir nos cards" className={styles.displayOptions}>
      {OPTIONS.map(([key, label]) => (
        <label key={key} className="check">
          <input
            type="checkbox"
            checked={prefs.card[key]}
            onChange={(e) => update({ card: { ...prefs.card, [key]: e.target.checked } })}
          />
          {label}
        </label>
      ))}
    </div>
  );
}

export function CardDisplayMenu() {
  const ref = useRef<HTMLDetailsElement>(null);

  // Fecha ao clicar fora, como o menu da conta.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.removeAttribute("open");
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return (
    <details ref={ref} className={styles.display}>
      <summary
        className={`btn btn-icon ${styles.displayBtn}`}
        aria-label="O que mostrar nos cards"
        title="O que mostrar nos cards"
      >
        <Icon name="eye" />
      </summary>
      <div className={styles.displayMenu}>
        <span className="eyebrow">No card de cada jogo</span>
        <CardDisplayOptions />
      </div>
    </details>
  );
}
