import { useState, type CSSProperties } from "react";
import { Link, useParams } from "react-router";

import { ApiError, errorMessage } from "../../api/client";
import { useDeleteGame, useDevices, useGame, useUpdateGame } from "../../api/queries";
import type { GameDetail, GamePatch, Priority, Status } from "../../api/types";
import { useConfirm } from "../../components/Confirm";
import { ErrorState, LoadingState, NotFound } from "../../components/NotFound";
import { useToast } from "../../components/Toast";
import { useJobWatcher } from "../../components/useJobWatcher";
import { PRIORITY_LABEL, STATUS, STATUS1 } from "../../lib/constants";
import { palette } from "../../lib/cover";
import { parseUtc, todayIso } from "../../lib/format";
import { useBackToLibrary } from "../library/returnTo";
import { InfoCard, ScoresCard, WhereCard } from "./Aside";
import { CommentsSection } from "./CommentsSection";
import { EditGameDialog } from "./EditGameDialog";
import styles from "./GameDetail.module.css";
import { Hero } from "./Hero";
import { IntegrationsSection, MatchReview, StoreReviewsSection } from "./IntegrationSection";
import { MediaSection } from "./MediaSection";
import { MergeDialog } from "./MergeDialog";
import { ReviewSection } from "./ReviewSection";
import { StorySection } from "./StorySection";

const ENRICH_POLL_MS = 2000;
const ENRICH_POLL_WINDOW_MS = 2 * 60_000;

/** Recém-adicionado pela integração: o job de refresh roda em segundo plano; recarrega até ele terminar. */
function enrichPoll(game: GameDetail | undefined): number | false {
  if (!game || game.last_enriched_at) return false;
  if (!game.links.some((l) => l.status === "confirmed")) return false;
  return Date.now() - parseUtc(game.created_at).getTime() < ENRICH_POLL_WINDOW_MS ? ENRICH_POLL_MS : false;
}

export function GameDetailPage() {
  const id = Number(useParams().id);
  const game = useGame(id, enrichPoll);
  const devices = useDevices();

  if (!Number.isFinite(id)) return <NotFound message="Jogo inválido." />;
  if (game.isError) {
    if (game.error instanceof ApiError && game.error.status === 404) return <NotFound message="Esse jogo não está na biblioteca." />;
    return <ErrorState error={game.error} onRetry={() => game.refetch()} />;
  }
  if (game.isPending) return <LoadingState text="Carregando o jogo…" />;
  return <Detail key={game.data.id} game={game.data} devices={devices.data ?? []} />;
}

function Detail({ game, devices }: { game: GameDetail; devices: NonNullable<ReturnType<typeof useDevices>["data"]> }) {
  const update = useUpdateGame(game.id);
  const del = useDeleteGame();
  const toast = useToast();
  const back = useBackToLibrary();
  const [dialog, confirm] = useConfirm();
  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState(false);
  const watcher = useJobWatcher([game.id]);
  const [c0, c1] = palette(game.name, game.platform);
  const ambiguous = game.links.filter((l) => l.status === "ambiguous" && l.candidates.length > 0);
  const enriching = enrichPoll(game) !== false;

  const move = (status: Status) => {
    const patch: GamePatch = { status };
    // Desfazer volta à lista anterior e apaga a data de término que a mudança tenha posto.
    const undo: GamePatch = { status: game.status };
    if (status === "done" && !game.finished_at) {
      patch.finished_at = todayIso();
      undo.finished_at = null;
    }
    update.mutate(patch, {
      onSuccess: () =>
        toast.show(`${game.name} agora está em ${STATUS[status]}${undo.finished_at === null ? ", terminado hoje" : ""}.`, "ok", {
          label: "Desfazer",
          onClick: () => update.mutate(undo, { onError: (e) => toast.error(`Não consegui desfazer: ${errorMessage(e)}`) }),
        }),
      onError: (e) => toast.error(`Não consegui mover: ${errorMessage(e)}`),
    });
  };

  const setPriority = (priority: Priority | null) =>
    update.mutate(
      { priority },
      {
        onError: (e) =>
          toast.error(
            `Não consegui mudar a prioridade${priority ? ` para ${PRIORITY_LABEL[priority].toLowerCase()}` : ""}: ${errorMessage(e)}`,
          ),
      },
    );

  const toggleHidden = () => {
    const hidden = !game.hidden;
    update.mutate(
      { hidden },
      {
        onSuccess: () =>
          toast.show(hidden ? `${game.name} foi para Ocultos.` : `${game.name} voltou para as listas.`, "ok"),
        onError: (e) => toast.error(`Não consegui ${hidden ? "ocultar" : "mostrar"}: ${errorMessage(e)}`),
      },
    );
  };

  const remove = async () => {
    const ok = await confirm({
      title: "Excluir jogo",
      message: (
        <>
          <strong>{game.name}</strong> ({game.platform}) sai da biblioteca junto com review, comentários e mídia. Os backups
          diários continuam com ele.
          {game.ownerships.length > 0 && " A sincronização das contas de loja não vai trazê-lo de volta."}
        </>
      ),
      confirmLabel: "Excluir",
      danger: true,
    });
    if (!ok) return;
    del.mutate(game.id, {
      onSuccess: () => {
        toast.show(`${game.name} foi excluído.`);
        back.go();
      },
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  return (
    <div style={{ "--c0": c0, "--c1": c1 } as CSSProperties}>
      <Hero game={game} onMove={move} onPriority={setPriority} busy={update.isPending} />
      <div className={styles.body}>
        <div className={styles.mainCol}>
          {enriching && (
            <p className="muted" role="status" style={{ margin: 0 }}>
              Buscando capa, descrição, HLTB e Metacritic nas integrações…
            </p>
          )}
          {game.duplicates.length > 0 && (
            <div className={styles.dupes} role="note">
              <span>
                Parece o mesmo jogo que{" "}
                {game.duplicates.map((d, i) => (
                  <span key={d.id}>
                    {i > 0 && ", "}
                    <Link to={`/jogos/${d.id}`}>{d.name}</Link>{" "}
                    <span className="muted">({STATUS1[d.status].toLowerCase()})</span>
                  </span>
                ))}
                .
              </span>
              <button type="button" className="btn btn-sm" onClick={() => setMerging(true)}>
                Mesclar aqui
              </button>
            </div>
          )}
          <MatchReview game={game} links={ambiguous} watcher={watcher} />
          <section aria-labelledby="h-desc" className="card" style={{ gap: 12 }}>
            <h2 id="h-desc" className="section-title">
              Descrição
            </h2>
            <p className={`${styles.desc} ${game.description ? "" : styles.descEmpty}`}>
              {game.description || "Sem descrição ainda. Ao importar pela integração, a sinopse oficial aparece aqui."}
            </p>
          </section>
          <MediaSection game={game} />
          <ReviewSection game={game} />
          <CommentsSection game={game} />
          <StorySection game={game} />
          <StoreReviewsSection game={game} />
          <IntegrationsSection game={game} watcher={watcher} />
        </div>
        <aside aria-label="Resumo do jogo" className={styles.aside}>
          <ScoresCard game={game} />
          <WhereCard game={game} devices={devices} />
          <InfoCard
            game={game}
            onEdit={() => setEditing(true)}
            onMerge={() => setMerging(true)}
            onToggleHidden={toggleHidden}
            onDelete={remove}
          />
        </aside>
      </div>
      <p className={styles.footerNote}>
        Dados: <a href="https://www.igdb.com" target="_blank" rel="noopener noreferrer">IGDB</a> ·{" "}
        <a href="https://rawg.io" target="_blank" rel="noopener noreferrer">RAWG</a> ·{" "}
        <a href="https://howlongtobeat.com" target="_blank" rel="noopener noreferrer">HowLongToBeat</a> ·{" "}
        <a href="https://www.metacritic.com" target="_blank" rel="noopener noreferrer">Metacritic</a>
      </p>
      <EditGameDialog game={game} open={editing} onClose={() => setEditing(false)} />
      <MergeDialog game={game} open={merging} onClose={() => setMerging(false)} />
      {dialog}
    </div>
  );
}
