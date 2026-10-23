import { STORE_LABEL } from "../lib/constants";
import styles from "./StoreMark.module.css";

/** Quadradinho com a inicial e a cor da loja (o nome vai ao lado, em texto). */
export function StoreMark({ store, size = 16 }: { store: string; size?: number }) {
  return (
    <span
      className={styles.mark}
      data-store={store}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.62) }}
      aria-hidden="true"
    >
      {(STORE_LABEL[store] ?? store)[0]}
    </span>
  );
}
