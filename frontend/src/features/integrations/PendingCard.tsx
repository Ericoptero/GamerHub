import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";

import { errorMessage } from "../../api/client";
import { keys, useGame, useMeta, usePending, usePlatforms, useRefreshGame, useUpdateGame } from "../../api/queries";
import type { GamePatch, PendingGame, ProviderName } from "../../api/types";
import { Icon } from "../../components/Icon";
import { useToast } from "../../components/Toast";
import { useJobWatcher } from "../../components/useJobWatcher";
import { PROVIDER_LABEL } from "../../lib/constants";
import { initials, palette } from "../../lib/cover";
import { fold } from "../../lib/text";
import { EditGameDialog } from "../game-detail/EditGameDialog";
import styles from "./PendingCard.module.css";
import { PROVIDERS, ProviderBadges, ProviderRows, needsHelp, type Watcher } from "./ProviderSearch";

const PAGE = 20;

export function PendingCard() {
  const [provider, setProvider] = useState<"" | ProviderName>("");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const pending = usePending(provider || undefined);
  const meta = useMeta();
  const watcher = useJobWatcher();
  const needle = fold(q);
  const items = (pending.data ?? []).filter((g) => !needle || fold(g.name).includes(needle));
  const enabled = (p: ProviderName) => meta.data?.providers[p] ?? true;

  return (
    <section aria-labelledby="h-pend" className="card">
      <h2 id="h-pend" className="section-title">
        Precisa da sua ajuda <span className="count">{pending.data ? items.length : ""}</span>
      </h2>
      <p className="lead">
        Jogos em que alguma integração ficou em dúvida, não achou nada ou deu erro, cada um num card só. Escolha o
        resultado certo, procure por outro nome (ex.: o título em inglês) ou pelo link da página do jogo no site da
        integração, ou corrija as informações do jogo e busque de novo.
      </p>
      <div className={styles.filters}>
        <div role="group" aria-label="Filtrar por integração" className="row" style={{ gap: 6 }}>
          {(["", ...PROVIDERS] as const).map((p) => (
            <button
              key={p || "all"}
              type="button"
              className="pill"
              aria-pressed={provider === p}
              onClick={() => {
                setProvider(p);
                setShown(PAGE);
              }}
            >
              {p ? PROVIDER_LABEL[p] : "Todas"}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="input"
          aria-label="Filtrar jogos pelo nome"
          placeholder="Filtrar pelo nome"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {pending.isError && <p className="error-text">{errorMessage(pending.error)}</p>}
      {pending.data && items.length === 0 && <div className="notice">Nada pendente.</div>}
      <div className={styles.list}>
        {items.slice(0, shown).map((g) => (
          <PendingGameCard key={g.game_id} game={g} watcher={watcher} enabled={enabled} />
        ))}
      </div>
      {items.length > shown && (
        <button type="button" className="btn" style={{ alignSelf: "center" }} onClick={() => setShown((n) => n + PAGE)}>
          Mostrar mais ({items.length - shown} restantes)
        </button>
      )}
    </section>
  );
}

function PendingGameCard({
  game,
  watcher,
  enabled,
}: {
  game: PendingGame;
  watcher: Watcher;
  enabled: (p: ProviderName) => boolean;
}) {
  const [editing, setEditing] = useState(false);
  const refresh = useRefreshGame(game.game_id);
  const toast = useToast();
  const byProvider = new Map(game.links.map((l) => [l.provider, l]));
  // Integração sem chave só aparece se já tiver algo registrado para o jogo.
  const providers = PROVIDERS.filter((p) => enabled(p) || byProvider.has(p));
  const open = providers.filter((p) => needsHelp(byProvider.get(p)));
  const year = game.release_date?.slice(0, 4);
  const [bg, band] = palette(game.name, game.platform);

  const searchAgain = (which: ProviderName[]) =>
    refresh.mutate(
      { providers: which, rematch: true, force: false },
      {
        onSuccess: (job) => {
          watcher.start(job);
          toast.show(`Buscando ${game.name} de novo…`);
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  return (
    <article className={styles.game} aria-labelledby={`pg-${game.game_id}`}>
      <div className={styles.head}>
        {game.cover ? (
          <img className={styles.thumb} src={game.cover} alt="" loading="lazy" />
        ) : (
          <span className={styles.thumb} style={{ background: bg, borderTop: `3px solid ${band}` }} aria-hidden="true">
            {initials(game.name)}
          </span>
        )}
        <div className={styles.title}>
          <Link id={`pg-${game.game_id}`} to={`/jogos/${game.game_id}`} className={styles.name}>
            {game.name}
          </Link>
          <span className="muted">{[game.platform, year].filter(Boolean).join(" · ")}</span>
          <ProviderBadges providers={providers} links={game.links} />
        </div>
        <div className={styles.actions}>
          <button type="button" className="btn btn-sm" aria-expanded={editing} onClick={() => setEditing((e) => !e)}>
            <Icon name="edit" size={14} /> Editar informações
          </button>
          {open.length > 0 && (
            <button
              type="button"
              className="btn btn-sm"
              disabled={refresh.isPending || watcher.active}
              onClick={() => searchAgain(open)}
            >
              <Icon name="refresh" size={14} /> Buscar de novo
            </button>
          )}
        </div>
      </div>

      {editing && (
        <QuickEdit
          game={game}
          onClose={() => setEditing(false)}
          onSearchAgain={() => searchAgain(open.length ? open : providers)}
        />
      )}

      <ProviderRows
        gameId={game.game_id}
        gameName={game.name}
        providers={providers}
        links={game.links}
        watcher={watcher}
        onRetry={(p) => searchAgain([p])}
        retrying={refresh.isPending}
      />
    </article>
  );
}

/** Nome, plataforma e lançamento: o que a busca usa. "Mais campos…" abre o editor completo. */
function QuickEdit({
  game,
  onClose,
  onSearchAgain,
}: {
  game: PendingGame;
  onClose: () => void;
  onSearchAgain: () => void;
}) {
  const qc = useQueryClient();
  const platforms = usePlatforms();
  const update = useUpdateGame(game.game_id);
  const toast = useToast();
  const [name, setName] = useState(game.name);
  const [platformId, setPlatformId] = useState(game.platform_id);
  const [release, setRelease] = useState(game.release_date ?? "");
  const [full, setFull] = useState(false);
  const detail = useGame(full ? game.game_id : Number.NaN);

  const save = (thenSearch: boolean) => {
    const patch: GamePatch = {};
    if (name.trim() && name.trim() !== game.name) patch.name = name.trim();
    if (platformId !== game.platform_id) patch.platform_id = platformId;
    if ((release || null) !== game.release_date) patch.release_date = release || null;
    const done = () => {
      qc.invalidateQueries({ queryKey: keys.pending });
      if (thenSearch) onSearchAgain();
      onClose();
    };
    if (!Object.keys(patch).length) return done();
    update.mutate(patch, {
      onSuccess: () => {
        toast.show(`${patch.name ?? game.name}: informações salvas.`, "ok");
        done();
      },
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  return (
    <form
      className={styles.edit}
      onSubmit={(e) => {
        e.preventDefault();
        save(true);
      }}
      aria-label={`Editar ${game.name}`}
    >
      <div className="field-grid">
        <label className="field">
          Nome
          <input className="input" required maxLength={300} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          Plataforma
          <select className="select" value={platformId} onChange={(e) => setPlatformId(Number(e.target.value))}>
            {(platforms.data ?? [{ id: game.platform_id, name: game.platform }]).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Lançamento
          <input className="input" type="date" value={release} onChange={(e) => setRelease(e.target.value)} />
        </label>
      </div>
      <div className="row">
        <button
          type="button"
          className="btn btn-link"
          onClick={() => setFull(true)}
          disabled={full && detail.isPending}
        >
          Mais campos…
        </button>
        <span style={{ marginLeft: "auto" }} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Cancelar
        </button>
        <button type="button" className="btn btn-sm" onClick={() => save(false)} disabled={update.isPending}>
          Salvar
        </button>
        <button type="submit" className="btn btn-sm btn-primary" disabled={update.isPending}>
          Salvar e buscar de novo
        </button>
      </div>
      {full && detail.data && (
        <EditGameDialog
          game={detail.data}
          open
          onClose={() => {
            setFull(false);
            qc.invalidateQueries({ queryKey: keys.pending });
            onClose();
          }}
        />
      )}
    </form>
  );
}
