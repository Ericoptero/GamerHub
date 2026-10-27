import { useMemo, useState } from "react";
import { Link } from "react-router";

import { errorMessage } from "../../api/client";
import {
  useCreateGame,
  useExternalSearch,
  useGames,
  useGenres,
  useListMutations,
  useMeta,
  usePlatforms,
} from "../../api/queries";
import type { Candidate, GameList, SearchProvider, Status } from "../../api/types";
import { Dialog } from "../../components/Dialog";
import { GameCover } from "../../components/GameCover";
import { Icon } from "../../components/Icon";
import { useToast } from "../../components/Toast";
import { STATUS1, STATUS_ORDER } from "../../lib/constants";
import { initials } from "../../lib/cover";
import { summarizePlatforms } from "../../lib/platforms";
import { fold } from "../../lib/text";
import { useDebounced } from "../../lib/useDebounced";
import add from "../add-game/AddGamePage.module.css";
import { suggestFromCandidate } from "../add-game/suggest";
import styles from "./Lists.module.css";

const MAX_LOCAL = 30;
const SOURCE_LABEL: Record<SearchProvider, string> = { igdb: "IGDB", rawg: "RAWG" };

export function AddGamesDialog({ open, onClose, list }: { open: boolean; onClose: () => void; list: GameList }) {
  return (
    <Dialog open={open} onClose={onClose} title={`Adicionar a “${list.name}”`}>
      <AddGames list={list} onClose={onClose} />
    </Dialog>
  );
}

/** Uma busca só: primeiro na sua biblioteca; o que não estiver lá vem do IGDB/RAWG e entra nas duas. */
function AddGames({ list, onClose }: { list: GameList; onClose: () => void }) {
  const games = useGames();
  const meta = useMeta();
  const { add: addGame, removeGame } = useListMutations();
  const [q, setQ] = useState("");
  const needle = fold(q.trim());
  const inList = new Set(list.game_ids);

  const local = useMemo(
    () =>
      needle.length < 2
        ? []
        : (games.data ?? [])
            .filter((g) => fold(g.name).includes(needle))
            .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
            .slice(0, MAX_LOCAL),
    [games.data, needle],
  );

  const providers = meta.data?.providers;
  const source: SearchProvider | null = providers?.igdb ? "igdb" : providers?.rawg ? "rawg" : null;
  const toggle = (gameId: number) =>
    (inList.has(gameId) ? removeGame : addGame).mutate({ listId: list.id, gameId });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <label className="field">
        Nome do jogo
        <input
          type="search"
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ex.: Hollow Knight"
          autoFocus
        />
      </label>

      {needle.length < 2 ? (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Digite pelo menos duas letras. Os jogos da sua biblioteca aparecem primeiro; o que não estiver nela dá para
          buscar {source ? `no ${SOURCE_LABEL[source]}` : "numa integração"} e já entra na biblioteca.
        </p>
      ) : (
        <>
          <section aria-label="Na sua biblioteca" className={styles.addSection}>
            <span className="eyebrow">Na sua biblioteca</span>
            {local.length === 0 && (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                Nenhum jogo seu com esse nome.
              </p>
            )}
            {local.map((g) => {
              const on = inList.has(g.id);
              return (
                <div key={g.id} className={styles.addRow}>
                  <span className={styles.addCover}>
                    <GameCover name={g.name} platform={g.platform} cover={g.cover} size="thumb" />
                  </span>
                  <span className={styles.addInfo}>
                    <span className={styles.addName}>{g.name}</span>
                    <span className={styles.addMeta}>
                      {g.platform} · {STATUS1[g.status]}
                      {g.hidden ? " · oculto" : ""}
                    </span>
                  </span>
                  <button
                    type="button"
                    className={`btn btn-sm ${on ? "" : "btn-primary"}`}
                    aria-pressed={on}
                    aria-label={on ? `Tirar ${g.name} da lista` : `Adicionar ${g.name} à lista`}
                    onClick={() => toggle(g.id)}
                  >
                    {on ? (
                      <>
                        <Icon name="check" size={14} strokeWidth={3} /> Na lista
                      </>
                    ) : (
                      <>
                        <Icon name="plus" size={14} strokeWidth={2.6} /> Adicionar
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </section>
          {source ? (
            <ExternalResults source={source} q={q} list={list} inList={inList} />
          ) : (
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Para buscar jogos que não estão na biblioteca, cadastre a chave do IGDB ou da RAWG em{" "}
              <Link to="/configuracoes#chaves">Configurações</Link>.
            </p>
          )}
        </>
      )}

      <div className="row-end">
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Pronto
        </button>
      </div>
    </div>
  );
}

function ExternalResults({
  source,
  q,
  list,
  inList,
}: {
  source: SearchProvider;
  q: string;
  list: GameList;
  inList: Set<number>;
}) {
  const debounced = useDebounced(q.trim(), 400);
  const search = useExternalSearch(source, debounced, null);
  const [picked, setPicked] = useState<Candidate | null>(null);
  const results = search.data ?? [];
  return (
    <section aria-label={`Buscar no ${SOURCE_LABEL[source]}`} className={styles.addSection} aria-live="polite">
      <span className="eyebrow">
        {search.isFetching ? "Buscando…" : `Fora da biblioteca · ${SOURCE_LABEL[source]}`}
      </span>
      {search.isError && <p className="error-text">{errorMessage(search.error)}</p>}
      {!search.isFetching && !search.isError && debounced.length >= 2 && results.length === 0 && (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Nada encontrado. Tente outro nome (o título em inglês costuma funcionar melhor).
        </p>
      )}
      {results.map((c) => {
        const key = `${c.provider}-${c.external_id}`;
        const on = picked !== null && `${picked.provider}-${picked.external_id}` === key;
        const owned = c.in_library.find((id) => inList.has(id)) ?? c.in_library[0];
        return (
          <div key={key} className={styles.addCandidate}>
            <div className={styles.addRow}>
              {c.cover_thumb ? (
                <img className={`${add.thumb} ${styles.addThumb}`} src={c.cover_thumb} alt="" loading="lazy" />
              ) : (
                <span className={`${add.thumb} ${styles.addThumb}`} aria-hidden="true">
                  {initials(c.name)}
                </span>
              )}
              <span className={styles.addInfo}>
                <span className={styles.addName}>
                  {c.name}
                  {c.year ? <span className="muted"> ({c.year})</span> : null}
                </span>
                <span className={styles.addMeta}>{summarizePlatforms(c.platforms)}</span>
                {owned !== undefined && <span className={add.owned}>Já na biblioteca</span>}
              </span>
              {owned !== undefined ? (
                <OwnedButton listId={list.id} gameId={owned} name={c.name} inList={inList.has(owned)} />
              ) : (
                <button
                  type="button"
                  className="btn btn-sm"
                  aria-expanded={on}
                  onClick={() => setPicked(on ? null : c)}
                >
                  {on ? "Fechar" : "Escolher"}
                </button>
              )}
            </div>
            {on && <NewGameForm candidate={c} list={list} onDone={() => setPicked(null)} />}
          </div>
        );
      })}
    </section>
  );
}

/** Resultado que você já tem: entra na lista o jogo da biblioteca, sem criar outro. */
function OwnedButton({ listId, gameId, name, inList }: { listId: number; gameId: number; name: string; inList: boolean }) {
  const { add: addGame, removeGame } = useListMutations();
  return (
    <button
      type="button"
      className={`btn btn-sm ${inList ? "" : "btn-primary"}`}
      aria-pressed={inList}
      aria-label={inList ? `Tirar ${name} da lista` : `Adicionar ${name} à lista`}
      onClick={() => (inList ? removeGame : addGame).mutate({ listId, gameId })}
    >
      {inList ? "Na lista" : "Adicionar"}
    </button>
  );
}

/** Plataforma e status do jogo novo; ele entra na biblioteca (buscando os dados) e na lista. */
function NewGameForm({ candidate: c, list, onDone }: { candidate: Candidate; list: GameList; onDone: () => void }) {
  const platforms = usePlatforms();
  const genres = useGenres();
  const create = useCreateGame();
  const { add: addGame } = useListMutations();
  const toast = useToast();
  const allPlatforms = platforms.data ?? [];
  const [suggested] = useState(() => suggestFromCandidate(c, allPlatforms, genres.data ?? []));
  const [platform, setPlatform] = useState(suggested.platform);
  const [status, setStatus] = useState<Status>("backlog");
  const chosen = platform || suggested.platform || String(allPlatforms[0]?.id ?? "");

  const submit = () => {
    if (!chosen) return;
    create.mutate(
      {
        name: c.name,
        platform_id: Number(chosen),
        status,
        priority: status === "backlog" ? "Media" : null,
        genre_id: suggested.genre ? Number(suggested.genre) : null,
        link: { provider: c.provider as SearchProvider, external_id: c.external_id },
      },
      {
        onSuccess: (g) => {
          addGame.mutate(
            { listId: list.id, gameId: g.id },
            {
              onSuccess: () => toast.show(`${g.name} entrou na biblioteca e na lista. Buscando os dados…`, "ok"),
              onError: (e) => toast.error(`${g.name} entrou na biblioteca, mas não na lista: ${errorMessage(e)}`),
            },
          );
          onDone();
        },
        onError: (e) => toast.error(`Não consegui adicionar: ${errorMessage(e)}`),
      },
    );
  };

  return (
    <div className={styles.newGame}>
      <label className="field">
        Plataforma
        <select className="select" value={chosen} onChange={(e) => setPlatform(e.target.value)}>
          {allPlatforms.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Status
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {STATUS1[s]}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="btn btn-primary"
        onClick={submit}
        disabled={create.isPending || !chosen}
        style={{ alignSelf: "flex-end" }}
      >
        {create.isPending ? "Adicionando…" : "Adicionar à biblioteca e à lista"}
      </button>
    </div>
  );
}
