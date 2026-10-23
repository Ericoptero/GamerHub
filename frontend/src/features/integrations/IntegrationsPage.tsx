import { useEffect, useState } from "react";

import { errorMessage } from "../../api/client";
import { isJobActive, useEnrich, useJobs, useMeta } from "../../api/queries";
import type { EnrichIn } from "../../api/types";
import { Icon } from "../../components/Icon";
import { useToast } from "../../components/Toast";
import { useJobWatcher } from "../../components/useJobWatcher";
import { ACCENTS, JOB_KIND_SHORT, PROVIDER_LABEL } from "../../lib/constants";
import { fmtLocalDateTime } from "../../lib/format";
import { usePrefs } from "../../lib/prefs";
import { CardDisplayOptions } from "../library/CardDisplayMenu";
import { AccountsCard } from "./AccountsCard";
import { ImportPanel } from "./ImportPanel";
import { JobProgress } from "./JobProgress";
import { PendingCard } from "./PendingCard";
import styles from "./IntegrationsPage.module.css";

export function IntegrationsPage() {
  return (
    <main className="page page-wide">
      <div className="page-head">
        <h1 className="page-title">Integrações</h1>
        <p className="lead">
          Suas contas da Steam, Epic e GOG, de onde vêm capas, descrições, tempos do HowLongToBeat e notas do Metacritic,
          além de importação, backup e preferências.
        </p>
      </div>
      <AccountsCard />
      <ProvidersCard />
      <EnrichCard />
      <PendingCard />
      <ImportPanel />
      <ExportCard />
      <PrefsCard />
    </main>
  );
}

// ---------- status das chaves ----------

const PROVIDER_HELP: Record<string, string> = {
  igdb: "Fonte principal: capa, descrição, história, screenshots e trailer. Precisa de IGDB_CLIENT_ID e IGDB_CLIENT_SECRET (app na Twitch).",
  rawg: "Fallback de metadados e nota do Metacritic. Precisa de RAWG_API_KEY.",
  hltb: "Tempos de jogo, por scraping do howlongtobeat.com. Não precisa de chave.",
  metacritic: "Metascore e reviews da crítica, pelo backend público do metacritic.com. Não precisa de chave.",
  steam: "Contas Steam pela URL do perfil (lista de jogos e horas). Precisa de STEAM_API_KEY.",
};

function ProvidersCard() {
  const meta = useMeta();
  const providers = meta.data?.providers;
  return (
    <section aria-labelledby="h-prov" className="card">
      <h2 id="h-prov" className="section-title">
        Fontes de dados
      </h2>
      <div className={styles.providers}>
        {(["igdb", "rawg", "hltb", "metacritic", "steam"] as const).map((p) => {
          const on = p === "steam" ? meta.data?.stores.steam : providers?.[p];
          return (
            <div key={p} className={styles.provider}>
              <div className={styles.providerHead}>
                <span className={styles.providerName}>{PROVIDER_LABEL[p]}</span>
                <span className={on ? styles.on : styles.off}>{providers ? (on ? "Ativo" : "Sem chave") : "…"}</span>
              </div>
              <p className={styles.providerHelp}>{PROVIDER_HELP[p]}</p>
            </div>
          );
        })}
      </div>
      {providers && (!providers.igdb || !providers.rawg || !meta.data?.stores.steam) && (
        <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
          Para ativar, preencha as chaves no arquivo <code>.env</code> ao lado do <code>docker-compose.yml</code> (veja o{" "}
          <code>.env.example</code>) e rode <code>docker compose up -d</code> de novo.
        </p>
      )}
    </section>
  );
}

// ---------- enriquecimento em lote ----------

const SCOPES: { value: NonNullable<EnrichIn["scope"]>; label: string; help: string }[] = [
  { value: "missing", label: "Nunca buscados", help: "Só os jogos que ainda não passaram pelas integrações." },
  { value: "stale", label: "Desatualizados", help: "Nunca buscados ou atualizados há mais de 30 dias." },
  { value: "all", label: "Todos", help: "A biblioteca inteira. Na primeira vez leva uns 15 minutos para 240 jogos." },
];

function EnrichCard() {
  const [scope, setScope] = useState<NonNullable<EnrichIn["scope"]>>("missing");
  const [force, setForce] = useState(false);
  const jobs = useJobs(3000);
  const enrich = useEnrich();
  const toast = useToast();
  const list = jobs.data ?? [];
  const current = list.find((j) => j.kind === "enrich" && isJobActive(j)) ?? null;
  // Acompanha o lote em andamento (também se ele começou antes de abrir a página).
  const watcher = useJobWatcher();
  const { start: watch, job: watched } = watcher;
  useEffect(() => {
    if (current && watched?.id !== current.id) watch(current);
  }, [current, watched?.id, watch]);
  const shown = (watched?.kind === "enrich" ? watched : null) ?? current ?? list.find((j) => j.kind === "enrich") ?? null;

  const start = () =>
    enrich.mutate(
      { scope, force },
      {
        onSuccess: (job) => {
          if (!job.total) return toast.show("Nenhum jogo para atualizar nesse escopo.");
          watch(job);
          toast.show(`Enriquecimento iniciado: ${job.total} jogos.`, "ok");
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  return (
    <section aria-labelledby="h-enrich" className="card">
      <h2 id="h-enrich" className="section-title">
        Buscar dados para a biblioteca
      </h2>
      <p className="lead">
        Para cada jogo: acha o item certo no IGDB, depois RAWG, HowLongToBeat e Metacritic. Campos que você editou à mão
        não são sobrescritos. Jogos com mais de um candidato vão para “Precisa confirmar”, logo abaixo.
      </p>
      <div role="radiogroup" aria-label="Quais jogos" className={styles.scopes}>
        {SCOPES.map((s) => (
          <label key={s.value} className={styles.scope} data-on={scope === s.value}>
            <input type="radio" name="scope" value={s.value} checked={scope === s.value} onChange={() => setScope(s.value)} />
            <span>
              <strong>{s.label}</strong>
              <span className="muted">{s.help}</span>
            </span>
          </label>
        ))}
      </div>
      <label className="check">
        <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
        Ignorar o cache (busca tudo de novo nas fontes)
      </label>
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={start} disabled={enrich.isPending || !!current}>
          <Icon name="refresh" />
          {current ? "Já tem um enriquecimento rodando" : "Iniciar"}
        </button>
      </div>
      {shown && <JobProgress job={shown} />}
      {list.length > 1 && (
        <details>
          <summary className={styles.summary}>Execuções recentes</summary>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Status</th>
                  <th scope="col">Itens</th>
                  <th scope="col">Início</th>
                </tr>
              </thead>
              <tbody>
                {list.map((j) => (
                  <tr key={j.id}>
                    <td>{j.id}</td>
                    <td>{JOB_KIND_SHORT[j.kind] ?? j.kind}</td>
                    <td>{j.status}</td>
                    <td>
                      {j.processed}/{j.total}
                      {j.failed ? ` (${j.failed} erro)` : ""}
                    </td>
                    <td>{fmtLocalDateTime(j.started_at ?? j.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}

// ---------- exportar ----------

function ExportCard() {
  return (
    <section aria-labelledby="h-exp" className="card">
      <h2 id="h-exp" className="section-title">
        Exportar e backup
      </h2>
      <p className="lead">
        O JSON completo pode ser reimportado aqui (modo substituir). O CSV abre no Excel/Sheets no formato da planilha. O
        servidor também guarda um backup automático por dia (os últimos 7) na pasta <code>data/backups</code>.
      </p>
      <div className="row">
        <a className="btn" href="/api/export.json" download>
          <Icon name="download" /> JSON completo
        </a>
        <a className="btn" href="/api/export.csv" download>
          <Icon name="download" /> CSV (planilha)
        </a>
        <a className="btn" href="/api/backup.sqlite" download>
          <Icon name="download" /> Banco SQLite
        </a>
      </div>
    </section>
  );
}

// ---------- preferências ----------

function PrefsCard() {
  const [prefs, setPrefs] = usePrefs();
  return (
    <section aria-labelledby="h-prefs" className="card">
      <h2 id="h-prefs" className="section-title">
        Preferências
      </h2>
      <div role="radiogroup" aria-label="Cor de destaque" className="row" style={{ gap: 10 }}>
        <span className="muted" style={{ fontSize: 12, marginRight: 4 }}>
          Cor de destaque
        </span>
        {ACCENTS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={prefs.accent === c}
            aria-label={`Destaque ${c}`}
            className={styles.swatch}
            style={{ background: c }}
            onClick={() => setPrefs({ accent: c })}
          />
        ))}
      </div>
      <label className="field" style={{ maxWidth: 360 }}>
        Tamanho da capa na biblioteca: {prefs.coverSize}px
        <input
          type="range"
          min={110}
          max={220}
          step={10}
          value={prefs.coverSize}
          onChange={(e) => setPrefs({ coverSize: Number(e.target.value) })}
          style={{ accentColor: "var(--accent)", height: 44 }}
        />
      </label>
      <div className="field">
        No card de cada jogo da biblioteca
        <CardDisplayOptions />
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        Fica salvo neste navegador.
      </p>
    </section>
  );
}
