import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";

import { api, errorMessage } from "../../api/client";
import { keys } from "../../api/queries";
import type { ImportMode, ImportReport, SheetChoice, SheetPreview, Status } from "../../api/types";
import { Icon } from "../../components/Icon";
import { useToast } from "../../components/Toast";
import { STATUS1, STATUS_ORDER } from "../../lib/constants";
import styles from "./IntegrationsPage.module.css";

const MODES: { value: ImportMode; label: string; help: string }[] = [
  { value: "novos", label: "Só novos", help: "Ignora jogos que já existem (mesmo nome, plataforma e lista)." },
  { value: "atualizar", label: "Atualizar", help: "Atualiza os existentes com os campos preenchidos e cria os que faltam." },
  { value: "substituir", label: "Substituir tudo", help: "Apaga a biblioteca e importa do zero. Um backup é feito antes." },
];

function useInvalidateLibrary() {
  const qc = useQueryClient();
  return () => {
    for (const k of [keys.games, keys.platforms, keys.genres, keys.stores, keys.devices]) qc.invalidateQueries({ queryKey: k });
    qc.removeQueries({ queryKey: ["game"] });
  };
}

function reportText(r: ImportReport): string {
  return `${r.created} criados · ${r.updated} atualizados · ${r.skipped} ignorados`;
}

function ModePicker({ mode, setMode, name }: { mode: ImportMode; setMode: (m: ImportMode) => void; name: string }) {
  return (
    <div role="radiogroup" aria-label="Modo de importação" className={styles.scopes}>
      {MODES.map((m) => (
        <label key={m.value} className={styles.scope} data-on={mode === m.value}>
          <input type="radio" name={name} value={m.value} checked={mode === m.value} onChange={() => setMode(m.value)} />
          <span>
            <strong>{m.label}</strong>
            <span className="muted">{m.help}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function Warnings({ report }: { report: ImportReport }) {
  if (!report.warnings.length) return null;
  return (
    <details>
      <summary className={styles.summary}>{report.warnings.length} avisos</summary>
      <ul className={styles.warnings}>
        {report.warnings.slice(0, 100).map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </details>
  );
}

export function ImportPanel() {
  return (
    <section aria-labelledby="h-imp" className="card">
      <h2 id="h-imp" className="section-title">
        Importar
      </h2>
      <JsonImport />
      <hr className={styles.hr} />
      <SheetImport />
    </section>
  );
}

// ---------- JSON ----------

function JsonImport() {
  const toast = useToast();
  const invalidate = useInvalidateLibrary();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<ImportMode>("novos");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return toast.error("Escolha um arquivo .json.");
    const body = new FormData();
    body.append("file", file);
    setBusy(true);
    try {
      const r = await api.post<ImportReport>(`/api/import/json?mode=${mode}`, body);
      setReport(r);
      invalidate();
      toast.show(`Importação concluída: ${reportText(r)}.`, "ok");
    } catch (err) {
      toast.error(`Importação falhou: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className={styles.importBlock}>
      <h3 className={styles.h3}>JSON</h3>
      <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
        O JSON exportado da planilha (lista de jogos) ou um <code>export.json</code> completo do GamerHub (este só no modo
        “Substituir tudo”).
      </p>
      <label className="field">
        Arquivo
        <input ref={fileRef} type="file" accept=".json,application/json" className="input" style={{ paddingTop: 10 }} />
      </label>
      <ModePicker mode={mode} setMode={setMode} name="json-mode" />
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          <Icon name="upload" /> {busy ? "Importando…" : "Importar JSON"}
        </button>
      </div>
      {report && (
        <div className={styles.report}>
          <strong>{reportText(report)}</strong>
          {report.new_genres.length > 0 && <span className="muted">Gêneros novos: {report.new_genres.join(", ")}</span>}
          <Warnings report={report} />
        </div>
      )}
    </form>
  );
}

// ---------- planilha ----------

function SheetImport() {
  const toast = useToast();
  const invalidate = useInvalidateLibrary();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<SheetPreview | null>(null);
  const [choices, setChoices] = useState<SheetChoice[]>([]);
  const [mode, setMode] = useState<ImportMode>("novos");
  const [busy, setBusy] = useState<"preview" | "simulate" | "import" | null>(null);
  const [simulation, setSimulation] = useState<ImportReport | null>(null);
  const [done, setDone] = useState<ImportReport | null>(null);

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return toast.error("Escolha um arquivo .xlsx ou .csv.");
    const body = new FormData();
    body.append("file", file);
    setBusy("preview");
    setSimulation(null);
    setDone(null);
    try {
      const p = await api.post<SheetPreview>("/api/import/sheet/preview", body);
      setPreview(p);
      setChoices(
        p.sheets.map((s) => ({ name: s.name, include: s.row_count > 0, mapping: { ...s.mapping }, status_override: s.status_hint })),
      );
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const update = (i: number, patch: Partial<SheetChoice>) => {
    setChoices((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
    setSimulation(null);
  };

  const commit = async (dryRun: boolean) => {
    if (!preview) return;
    setBusy(dryRun ? "simulate" : "import");
    try {
      const r = await api.post<ImportReport>("/api/import/sheet/commit", {
        token: preview.token,
        sheets: choices,
        mode,
        dry_run: dryRun,
      });
      if (dryRun) {
        setSimulation(r);
      } else {
        setDone(r);
        setPreview(null);
        setSimulation(null);
        invalidate();
        toast.show(`Planilha importada: ${reportText(r)}.`, "ok");
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={styles.importBlock}>
      <h3 className={styles.h3}>Planilha (XLSX ou CSV)</h3>
      <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
        Cada aba vira uma lista (o nome da aba sugere o status: “Lista de espera”, “Finalizados”…). Você confere qual coluna
        é qual, simula e só então importa.
      </p>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <label className="field" style={{ flex: "1 1 260px" }}>
          Arquivo
          <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.csv" className="input" style={{ paddingTop: 10 }} />
        </label>
        <button type="button" className="btn" onClick={upload} disabled={busy !== null}>
          <Icon name="upload" /> {busy === "preview" ? "Lendo…" : "Ler planilha"}
        </button>
      </div>

      {preview && (
        <>
          {preview.sheets.map((sheet, i) => {
            const choice = choices[i];
            if (!choice) return null;
            return (
              <fieldset key={sheet.name} className={styles.sheet}>
                <legend className={styles.sheetLegend}>
                  Aba “{sheet.name}” <span className="muted">· {sheet.row_count} linhas</span>
                </legend>
                <div className="row" style={{ gap: 16 }}>
                  <label className="check">
                    <input type="checkbox" checked={choice.include} onChange={(e) => update(i, { include: e.target.checked })} />
                    Importar esta aba
                  </label>
                  <label className="field" style={{ flex: "0 1 240px" }}>
                    Lista quando a linha não diz
                    <select
                      className="select"
                      value={choice.status_override ?? ""}
                      onChange={(e) => update(i, { status_override: (e.target.value || null) as Status | null })}
                    >
                      <option value="">Na fila (padrão)</option>
                      {STATUS_ORDER.map((s) => (
                        <option key={s} value={s}>
                          {STATUS1[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {choice.include && (
                  <>
                    <div className={styles.mapping}>
                      {Object.entries(preview.fields).map(([field, label]) => (
                        <label key={field} className="field">
                          {label}
                          {field === "name" ? " *" : ""}
                          <select
                            className="select"
                            value={choice.mapping[field] ?? ""}
                            onChange={(e) => {
                              const m = { ...choice.mapping };
                              if (e.target.value === "") delete m[field];
                              else m[field] = Number(e.target.value);
                              update(i, { mapping: m });
                            }}
                          >
                            <option value="">— não importar —</option>
                            {sheet.headers.map((h, idx) => (
                              <option key={idx} value={idx}>
                                {h || `Coluna ${idx + 1}`}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                    {sheet.sample.length > 0 && (
                      <details>
                        <summary className={styles.summary}>Amostra das primeiras linhas</summary>
                        <div className="table-wrap" style={{ marginTop: 8 }}>
                          <table className="table">
                            <thead>
                              <tr>
                                {sheet.headers.map((h, idx) => (
                                  <th key={idx} scope="col">
                                    {h || `Coluna ${idx + 1}`}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {sheet.sample.map((row, r) => (
                                <tr key={r}>
                                  {sheet.headers.map((_h, c) => (
                                    <td key={c} title={row[c]}>
                                      {row[c]}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    )}
                  </>
                )}
              </fieldset>
            );
          })}
          <ModePicker mode={mode} setMode={(m) => {
              setMode(m);
              setSimulation(null);
            }} name="sheet-mode" />
          <div className="row">
            <button type="button" className="btn" onClick={() => commit(true)} disabled={busy !== null}>
              {busy === "simulate" ? "Simulando…" : "Simular"}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => commit(false)} disabled={busy !== null || !simulation}>
              {busy === "import" ? "Importando…" : "Importar"}
            </button>
            {!simulation && <span className="muted" style={{ fontSize: 12 }}>Simule antes de importar.</span>}
          </div>
        </>
      )}

      {simulation && (
        <div className={styles.report}>
          <strong>Simulação: {reportText(simulation)}</strong>
          {simulation.new_genres.length > 0 && <span className="muted">Gêneros novos: {simulation.new_genres.join(", ")}</span>}
          <Warnings report={simulation} />
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Ação</th>
                  <th scope="col">Nome</th>
                  <th scope="col">Plataforma</th>
                  <th scope="col">Lista</th>
                  <th scope="col">Prioridade</th>
                  <th scope="col">HLTB</th>
                  <th scope="col">Jogado</th>
                  <th scope="col">Nota</th>
                  <th scope="col">Data</th>
                  <th scope="col">Lojas</th>
                </tr>
              </thead>
              <tbody>
                {simulation.rows.slice(0, 200).map((r, i) => (
                  <tr key={i}>
                    <td className={styles[`act_${r.action}`]}>{r.action}</td>
                    <td title={r.name}>{r.name}</td>
                    <td>{r.platform}</td>
                    <td>{STATUS1[r.status] ?? r.status}</td>
                    <td>{r.priority ?? ""}</td>
                    <td>{r.hltb_hours ?? ""}</td>
                    <td>{r.played_hours ?? ""}</td>
                    <td>{r.user_score ?? ""}</td>
                    <td>{r.date ?? ""}</td>
                    <td>{r.stores.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {simulation.rows.length > 200 && <span className="muted">Mostrando 200 de {simulation.rows.length} linhas.</span>}
        </div>
      )}

      {done && (
        <div className={styles.report}>
          <strong>Importado: {reportText(done)}</strong>
          <Warnings report={done} />
        </div>
      )}
    </div>
  );
}
