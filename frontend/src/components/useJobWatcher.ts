import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { invalidateAfterJob, isJobActive, keys, useJob } from "../api/queries";
import type { Job } from "../api/types";
import { useToast } from "./Toast";

/**
 * Acompanha um job (refresh/enriquecimento/sincronização): polling até terminar, depois recarrega os dados
 * dos jogos afetados e mostra a última linha do log num aviso.
 */
export function useJobWatcher(gameIds: number[] = [], opts: { toast?: boolean } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [jobId, setJobId] = useState<number | null>(null);
  const query = useJob(jobId);
  const job = query.data;
  const notified = useRef<number | null>(null);
  const idsKey = gameIds.join(",");

  const start = useCallback(
    (j: Job) => {
      qc.setQueryData(keys.job(j.id), j);
      notified.current = null;
      setJobId(j.id);
    },
    [qc],
  );

  useEffect(() => {
    if (!job || isJobActive(job) || notified.current === job.id) return;
    notified.current = job.id;
    invalidateAfterJob(qc, idsKey ? idsKey.split(",").map(Number) : []);
    if (opts.toast === false) return;
    const last = job.log[job.log.length - 1];
    const summary =
      job.kind === "enrich"
        ? `Enriquecimento concluído: ${job.succeeded} ok, ${job.failed} com erro.`
        : job.kind === "library_sync" && job.total > 1
          ? `Contas sincronizadas: ${job.succeeded} ok, ${job.failed} com erro.`
          : (last ?? "Atualização concluída.");
    if (job.status === "done") toast.show(summary, job.failed ? "info" : "ok");
    else if (job.status === "cancelled") toast.show("Atualização cancelada.");
    else toast.error(job.error ?? last ?? "A atualização falhou.");
  }, [job, qc, toast, idsKey, opts.toast]);

  return { job, start, active: isJobActive(job), reset: () => setJobId(null) };
}
