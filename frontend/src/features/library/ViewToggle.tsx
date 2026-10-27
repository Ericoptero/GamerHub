import { Icon } from "../../components/Icon";
import { usePrefs } from "../../lib/prefs";
import styles from "./LibraryPage.module.css";

/** Grade de capas ou linhas; a escolha fica no navegador e vale para a biblioteca e as listas. */
export function ViewToggle() {
  const [prefs, update] = usePrefs();
  return (
    <div role="group" aria-label="Visão" className={`seg ${styles.viewSeg}`}>
      <button
        type="button"
        aria-pressed={prefs.view === "grid"}
        aria-label="Grade de capas"
        title="Grade de capas"
        onClick={() => update({ view: "grid" })}
      >
        <Icon name="grid" />
      </button>
      <button
        type="button"
        aria-pressed={prefs.view === "list"}
        aria-label="Lista"
        title="Lista"
        onClick={() => update({ view: "list" })}
      >
        <Icon name="rows" />
      </button>
    </div>
  );
}
