import { isJobActive, useCancelJob } from "../../api/queries";
import type { Job } from "../../api/types";
import { JOB_KIND_LABEL, JOB_STATUS_LABEL } from "../../lib/constants";
import styles from "./IntegrationsPage.module.css";

export function JobProgress({ job }: { job: Job }) {
  const cancel = useCancelJob();
  const pct = job.total ? Math.round((job.processed / job.total) * 100) : 0;
  const active = isJobActive(job);
  return (
    <div className={styles.job}>
      <div className={styles.jobHead}>
        <span>
          {JOB_KIND_LABEL[job.kind] ?? job.kind} #{job.id} · {JOB_STATUS_LABEL[job.status] ?? job.status}
        </span>
        <span className="muted">
          {job.processed}/{job.total} · {job.succeeded} ok · {job.failed} com erro
        </span>
      </div>
      <div
        className="progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Progresso"
      >
        <span style={{ width: `${pct}%` }} />
      </div>
      {job.log.length > 0 && (
        <ol className={styles.log} aria-label="Últimos itens processados">
          {job.log
            .slice(-8)
            .reverse()
            .map((line, i) => (
              <li key={`${job.id}-${job.log.length - i}`}>{line}</li>
            ))}
        </ol>
      )}
      {job.error && <p className="error-text">{job.error}</p>}
      {active && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ alignSelf: "flex-start" }}
          disabled={cancel.isPending}
          onClick={() => cancel.mutate(job.id)}
        >
          Cancelar
        </button>
      )}
    </div>
  );
}
