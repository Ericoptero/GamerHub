import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { errorMessage } from "../../api/client";
import { useCreateGame, useDevices, useExternalSearch, useGenres, useMeta, usePlatforms } from "../../api/queries";
import type { Candidate, Device, Priority, SearchProvider, Status } from "../../api/types";
import { useToast } from "../../components/Toast";
import { PRIORITIES, PRIORITY_LABEL, STATUS1, STATUS_ORDER } from "../../lib/constants";
import { initials } from "../../lib/cover";
import { parseNum } from "../../lib/format";
import { summarizePlatforms } from "../../lib/platforms";
import { splitList } from "../../lib/text";
import { useDebounced } from "../../lib/useDebounced";
import styles from "./AddGamePage.module.css";
import { defaultPlatform, suggestFromCandidate } from "./suggest";

const SOURCES: { value: SearchProvider; label: string }[] = [
  { value: "igdb", label: "IGDB" },
  { value: "rawg", label: "RAWG" },
];

const LIST_OPTIONS: Status[] = STATUS_ORDER;

function availability(platformId: number | null, devices: Device[]): string {
  if (platformId === null) return "—";
  const ds = devices.filter((d) => d.platform_ids.includes(platformId));
  return ds.length ? ds.map((d) => d.name).join(", ") : "nenhum aparelho cadastrado";
}

export function AddGamePage() {
  const [sp, setSp] = useSearchParams();
  const manual = sp.get("modo") === "manual";
  const setMode = (m: "int" | "man") => setSp(m === "man" ? { modo: "manual" } : {}, { replace: true });

  return (
    <main className="page page-narrow">
      <div className="page-head">
        <h1 className="page-title">Adicionar jogo</h1>
        <p className="lead">
          Busque numa integração para trazer capa, descrição, imagens, trailer, Metacritic e HLTB, ou cadastre à mão.
        </p>
      </div>
      <div role="tablist" aria-label="Forma de adicionar" className="seg">
        <button type="button" role="tab" aria-selected={!manual} onClick={() => setMode("int")}>
          Buscar na integração
        </button>
        <button type="button" role="tab" aria-selected={manual} onClick={() => setMode("man")}>
          Manual
        </button>
      </div>
      {manual ? <ManualForm /> : <IntegrationSearch onManual={() => setMode("man")} />}
    </main>
  );
}

// ---------- busca na integração ----------

function IntegrationSearch({ onManual }: { onManual: () => void }) {
  const meta = useMeta();
  const platforms = usePlatforms();
  const genres = useGenres();
  const devices = useDevices();
  const create = useCreateGame();
  const navigate = useNavigate();
  const toast = useToast();

  const providers = meta.data?.providers;
  const enabled = SOURCES.filter((s) => providers?.[s.value]);
  const [source, setSource] = useState<SearchProvider | null>(null);
  const activeSource = source && providers?.[source] ? source : (enabled[0]?.value ?? null);
  const [platformFilter, setPlatformFilter] = useState("");
  const [q, setQ] = useState("");
  const debounced = useDebounced(q.trim(), 400);
  const search = useExternalSearch(activeSource ?? "igdb", activeSource ? debounced : "", platformFilter ? Number(platformFilter) : null);
  const [picked, setPicked] = useState<Candidate | null>(null);
  const [cfg, setCfg] = useState({ platform: "", status: "backlog" as Status, priority: "Media" as Priority | "", genre: "" });

  const allPlatforms = platforms.data ?? [];

  // Ao escolher um resultado, sugere plataforma e gênero.
  const choose = (c: Candidate | null) => {
    setPicked(c);
    if (!c) return;
    const { platform, genre } = suggestFromCandidate(c, allPlatforms, genres.data ?? [], platformFilter);
    setCfg((prev) => ({ ...prev, platform, genre }));
  };

  if (meta.isPending) return <p className="muted">Carregando…</p>;

  if (!enabled.length) {
    return (
      <section className="card">
        <h2 className="section-title">Nenhuma integração de busca configurada</h2>
        <p className="lead">
          Para buscar jogos, cadastre a chave do IGDB e/ou da RAWG em{" "}
          <Link to="/configuracoes#chaves">Configurações</Link>, com o passo a passo de onde conseguir cada uma.
        </p>
        <button type="button" className="btn" style={{ alignSelf: "flex-start" }} onClick={onManual}>
          Cadastrar à mão
        </button>
      </section>
    );
  }

  const results = search.data ?? [];
  const submit = () => {
    if (!picked || !cfg.platform) return;
    create.mutate(
      {
        name: picked.name,
        platform_id: Number(cfg.platform),
        status: cfg.status,
        priority: cfg.priority || null,
        genre_id: cfg.genre ? Number(cfg.genre) : null,
        link: { provider: picked.provider as SearchProvider, external_id: picked.external_id },
      },
      {
        onSuccess: (g) => {
          toast.show(`${g.name} entrou na biblioteca. Buscando os dados nas integrações…`, "ok");
          navigate(`/jogos/${g.id}`);
        },
        onError: (e) => toast.error(`Não consegui adicionar: ${errorMessage(e)}`),
      },
    );
  };

  return (
    <section aria-label="Buscar na integração" className="card" style={{ gap: 16 }}>
      <div className={styles.searchRow}>
        <label className="field" style={{ flex: "0 1 160px" }}>
          Fonte
          <select
            className="select"
            value={activeSource ?? ""}
            onChange={(e) => {
              setSource(e.target.value as SearchProvider);
              setPicked(null);
            }}
          >
            {SOURCES.map((s) => (
              <option key={s.value} value={s.value} disabled={!providers?.[s.value]}>
                {s.label}
                {providers?.[s.value] ? "" : " (sem chave)"}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ flex: "0 1 200px" }}>
          Plataforma (opcional)
          <select className="select" value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)}>
            <option value="">Qualquer</option>
            {allPlatforms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ flex: "1 1 260px" }}>
          Nome do jogo
          <input
            type="search"
            className="input"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPicked(null);
            }}
            placeholder="Ex.: Hollow Knight"
            autoFocus
          />
        </label>
      </div>

      {debounced.length >= 2 && (
        <div className={styles.results} aria-live="polite">
          <span className="eyebrow">
            {search.isFetching ? "Buscando…" : `Resultados em ${SOURCES.find((s) => s.value === activeSource)?.label}`}
          </span>
          {search.isError && <p className="error-text">{errorMessage(search.error)}</p>}
          {!search.isFetching && !search.isError && results.length === 0 && (
            <p className="muted" style={{ margin: 0 }}>
              Nada encontrado. Tente outro nome, a outra fonte, ou{" "}
              <button type="button" className="btn-link btn" style={{ height: "auto", padding: 0 }} onClick={onManual}>
                cadastre à mão
              </button>
              .
            </p>
          )}
          {results.map((c) => {
            const on = picked?.external_id === c.external_id && picked.provider === c.provider;
            return (
              <button
                key={`${c.provider}-${c.external_id}`}
                type="button"
                className={styles.result}
                aria-pressed={on}
                onClick={() => choose(on ? null : c)}
              >
                {c.cover_thumb ? (
                  <img className={styles.thumb} src={c.cover_thumb} alt="" loading="lazy" />
                ) : (
                  <span className={styles.thumb} aria-hidden="true">
                    {initials(c.name)}
                  </span>
                )}
                <span className={styles.resultInfo}>
                  <span className={styles.resultName}>
                    {c.name}
                    {c.year ? <span className="muted"> ({c.year})</span> : null}
                  </span>
                  <span className={styles.resultMeta}>{summarizePlatforms(c.platforms)}</span>
                  {c.in_library.length > 0 && <span className={styles.owned}>Já na biblioteca</span>}
                </span>
                <span className={styles.pickLabel}>{on ? "Selecionado" : "Selecionar"}</span>
              </button>
            );
          })}
        </div>
      )}

      {picked && (
        <>
          <div className={`field-grid ${styles.config}`}>
            <label className="field">
              Plataforma
              <select className="select" value={cfg.platform} onChange={(e) => setCfg({ ...cfg, platform: e.target.value })}>
                {allPlatforms.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Status
              <select className="select" value={cfg.status} onChange={(e) => setCfg({ ...cfg, status: e.target.value as Status })}>
                {LIST_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {STATUS1[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Prioridade
              <select className="select" value={cfg.priority} onChange={(e) => setCfg({ ...cfg, priority: e.target.value as Priority | "" })}>
                <option value="">—</option>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Gênero
              <select className="select" value={cfg.genre} onChange={(e) => setCfg({ ...cfg, genre: e.target.value })}>
                <option value="">Sem gênero</option>
                {(genres.data ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p style={{ margin: 0, color: "var(--text-3)", fontSize: 13 }}>
            Jogável em: {availability(cfg.platform ? Number(cfg.platform) : null, devices.data ?? [])}
          </p>
          {picked.in_library.length > 0 && (
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Você já tem esse jogo:{" "}
              {picked.in_library.map((id, i) => (
                <span key={id}>
                  {i > 0 && ", "}
                  <Link to={`/jogos/${id}`}>abrir</Link>
                </span>
              ))}
              . Adicionar de novo cria outra entrada (útil para rejogar ou outra plataforma).
            </p>
          )}
          <div className="row-end">
            <button type="button" className="btn btn-primary" onClick={submit} disabled={create.isPending || !cfg.platform}>
              {create.isPending ? "Adicionando…" : "Adicionar à biblioteca"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

// ---------- manual ----------

function ManualForm() {
  const platforms = usePlatforms();
  const genres = useGenres();
  const create = useCreateGame();
  const navigate = useNavigate();
  const toast = useToast();
  const allPlatforms = platforms.data ?? [];
  const [f, setF] = useState({
    name: "",
    platform: "",
    genre: "",
    status: "backlog" as Status,
    priority: "Media" as Priority | "",
    hltb: "",
    mc: "",
    description: "",
    cover: "",
    video: "",
    shots: "",
    stores: "",
  });
  const set = (k: keyof typeof f, v: string) => setF((prev) => ({ ...prev, [k]: v }));
  const platform = f.platform || defaultPlatform(allPlatforms);
  const genreDefault = useMemo(
    () => String(genres.data?.find((g) => g.name.startsWith("Ação e aventura"))?.id ?? ""),
    [genres.data],
  );
  const genre = f.genre === "" && genreDefault ? genreDefault : f.genre;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!f.name.trim() || !platform) return;
    const mc = parseNum(f.mc);
    create.mutate(
      {
        name: f.name.trim(),
        platform_id: Number(platform),
        genre_id: genre && genre !== "none" ? Number(genre) : null,
        status: f.status,
        priority: f.priority || null,
        hltb_main_hours: parseNum(f.hltb),
        metacritic_score: mc === null ? null : Math.round(mc),
        description: f.description.trim() || null,
        cover_url: f.cover.trim() || null,
        video_url: f.video.trim() || null,
        screenshots: f.shots.split("\n").map((x) => x.trim()).filter(Boolean),
        stores: splitList(f.stores),
      },
      {
        onSuccess: (g) => {
          toast.show(`${g.name} entrou na biblioteca.`, "ok");
          navigate(`/jogos/${g.id}`);
        },
        onError: (err) => toast.error(`Não consegui salvar: ${errorMessage(err)}`),
      },
    );
  };

  return (
    <form aria-label="Cadastro manual" onSubmit={submit} className="card" style={{ gap: 16 }}>
      <label className="field">
        Nome do jogo
        <input className="input" required value={f.name} onChange={(e) => set("name", e.target.value)} />
      </label>
      <div className="field-grid">
        <label className="field">
          Plataforma
          <select className="select" value={platform} onChange={(e) => set("platform", e.target.value)}>
            {allPlatforms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Gênero
          <select className="select" value={genre} onChange={(e) => set("genre", e.target.value)}>
            <option value="none">Sem gênero</option>
            {(genres.data ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Status
          <select className="select" value={f.status} onChange={(e) => set("status", e.target.value)}>
            {LIST_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STATUS1[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Prioridade
          <select className="select" value={f.priority} onChange={(e) => set("priority", e.target.value)}>
            <option value="">—</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          HLTB (horas)
          <input className="input" inputMode="decimal" value={f.hltb} onChange={(e) => set("hltb", e.target.value)} />
        </label>
        <label className="field">
          Nota Metacritic
          <input className="input" inputMode="numeric" placeholder="0–100" value={f.mc} onChange={(e) => set("mc", e.target.value)} />
        </label>
      </div>
      <label className="field">
        Descrição
        <textarea className="textarea" rows={4} value={f.description} onChange={(e) => set("description", e.target.value)} />
      </label>
      <div className="field-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        <label className="field">
          URL da capa
          <input className="input" type="url" placeholder="https://…" value={f.cover} onChange={(e) => set("cover", e.target.value)} />
        </label>
        <label className="field">
          URL do trailer
          <input className="input" type="url" placeholder="https://youtube.com/…" value={f.video} onChange={(e) => set("video", e.target.value)} />
        </label>
      </div>
      <label className="field">
        Screenshots (uma URL por linha)
        <textarea className="textarea" rows={3} value={f.shots} onChange={(e) => set("shots", e.target.value)} />
      </label>
      <label className="field">
        Lojas (separadas por vírgula)
        <input className="input" placeholder="Steam, Epic" value={f.stores} onChange={(e) => set("stores", e.target.value)} />
      </label>
      <div className="row-end">
        <Link to="/biblioteca" className="btn btn-ghost">
          Cancelar
        </Link>
        <button type="submit" className="btn btn-primary" disabled={create.isPending}>
          {create.isPending ? "Salvando…" : "Salvar jogo"}
        </button>
      </div>
    </form>
  );
}
