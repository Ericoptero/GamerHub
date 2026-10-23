import { useState } from "react";

import type { GameDetail, MediaItem } from "../../api/types";
import { Dialog } from "../../components/Dialog";
import { PlayIcon } from "../../components/Icon";
import { youtubeId } from "../../lib/text";
import styles from "./GameDetail.module.css";

function isDirectVideo(url: string): boolean {
  return /\.(mp4|webm|m4v|mov)(\?|$)/i.test(url);
}

function VideoBlock({ video }: { video: MediaItem | undefined }) {
  const [playing, setPlaying] = useState(false);
  if (!video) {
    return (
      <div className={styles.video}>
        <span className={styles.videoShade} aria-hidden="true" />
        <span className={`${styles.play} ${styles.playOff}`} aria-hidden="true">
          <PlayIcon />
        </span>
        <span className={styles.videoLabel}>Trailer · importado pela integração</span>
      </div>
    );
  }
  if (isDirectVideo(video.url) && !youtubeId(video.url)) {
    return (
      <div className={styles.video}>
        {playing ? (
          <video className={styles.videoPlayer} src={video.url} poster={video.thumb !== video.src ? video.thumb : undefined} controls autoPlay />
        ) : (
          <>
            {video.thumb && video.thumb !== video.src && <img className={styles.videoThumb} src={video.thumb} alt="" />}
            <span className={styles.videoShade} aria-hidden="true" />
            <button type="button" className={styles.play} style={{ border: 0, cursor: "pointer" }} onClick={() => setPlaying(true)} aria-label="Assistir trailer">
              <PlayIcon />
            </button>
            <span className={styles.videoLabel}>{video.title || "Trailer"}</span>
          </>
        )}
      </div>
    );
  }
  const hasThumb = video.thumb && video.thumb !== video.url;
  return (
    <div className={styles.video}>
      {hasThumb && <img className={styles.videoThumb} src={video.thumb} alt="" loading="lazy" />}
      <span className={styles.videoShade} aria-hidden="true" />
      <a href={video.url} target="_blank" rel="noopener noreferrer" className={styles.play} aria-label="Assistir trailer (abre em nova aba)">
        <PlayIcon />
      </a>
      <span className={styles.videoLabel}>{video.title ? `${video.title} · abre em nova aba` : "Trailer · abre em nova aba"}</span>
    </div>
  );
}

export function MediaSection({ game }: { game: GameDetail }) {
  const videos = game.media.filter((m) => m.kind === "video");
  const shots = game.media.filter((m) => m.kind === "screenshot" || m.kind === "artwork");
  const [videoIdx, setVideoIdx] = useState(0);
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section aria-labelledby="h-media" className="card">
      <h2 id="h-media" className="section-title">
        Vídeo e imagens
      </h2>
      <VideoBlock key={videos[videoIdx]?.id ?? "none"} video={videos[videoIdx]} />
      {videos.length > 1 && (
        <div className={styles.videoTabs} role="group" aria-label="Vídeos">
          {videos.map((v, i) => (
            <button key={v.id} type="button" className="pill" aria-pressed={i === videoIdx} onClick={() => setVideoIdx(i)}>
              {v.title || `Vídeo ${i + 1}`}
            </button>
          ))}
        </div>
      )}
      <div className={styles.shots}>
        {shots.length
          ? shots.map((s, i) => (
              <button key={s.id} type="button" className={styles.shot} onClick={() => setOpen(i)} aria-label={`Ampliar screenshot ${i + 1}`}>
                <img src={s.thumb} alt="" loading="lazy" decoding="async" />
              </button>
            ))
          : [1, 2, 3, 4].map((i) => (
              <span key={i} className={styles.shot} style={{ cursor: "default" }}>
                <span className={styles.shotLabel}>Screenshot {i}</span>
              </span>
            ))}
      </div>
      <Dialog open={open !== null} onClose={() => setOpen(null)} title={`Screenshot ${(open ?? 0) + 1} de ${shots.length}`} wide>
        {open !== null && shots[open] && (
          <div className={styles.lightbox}>
            <img src={shots[open].src} alt={`Screenshot ${open + 1} de ${game.name}`} />
            <div className="row">
              <button type="button" className="btn btn-ghost" disabled={open === 0} onClick={() => setOpen(open - 1)}>
                Anterior
              </button>
              <button type="button" className="btn btn-ghost" disabled={open === shots.length - 1} onClick={() => setOpen(open + 1)}>
                Próxima
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </section>
  );
}
