import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { errorMessage } from "../../api/client";
import {
  useCreateGame,
  useCreateGames,
  useDevices,
  useExternalSearch,
  useGenres,
  useMeta,
  usePlatforms,
} from "../../api/queries";
import type { Access, Candidate, Device, Genre, Platform, Priority, SearchProvider, Status } from "../../api/types";
import { Icon } from "../../components/Icon";
import { useToast } from "../../components/Toast";
import { ACCESS_LABEL, ACCESS_ORDER, PRIORITIES, PRIORITY_LABEL, STATUS1, STATUS_ORDER } from "../../lib/constants";
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
          Na busca dá para selecionar vários jogos e adicionar todos de uma vez.
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

/** Um resultado escolhido e como ele entra na biblioteca (os selects guardam ids em texto). */
interface Picked {
  candidate: Candidate;
  platform: string;
  status: Status;
  priority: Priority | "";
  access: Access;
  genre: string;
}

const keyOf = (c: Candidate) => `${c.provider}-${c.external_id}`;

/** Padrão de quem entra pela busca: na biblioteca, prioridade baixa, e você tem o jogo. */
const PICK_DEFAULTS = { status: "owned", priority: "Baixa", access: "owned" } as const;

function IntegrationSearch({ onManual }: { onManual: () => void }) {
  const meta = useMeta();
  const platforms = usePlatforms();
  const genres = useGenres();
  const devices = useDevices();
  const create = useCreateGames();
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
  // Na ordem em que foram escolhidos. Trocar a busca não limpa: dá para juntar jogos de buscas diferentes.
  const [selected, setSelected] = useState<Picked[]>([]);

  const allPlatforms = platforms.data ?? [];
  const chosen = new Set(selected.map((p) => keyOf(p.candidate)));

  // Ao escolher um resultado, sugere plataforma e gênero.
  const toggle = (c: Candidate) => {
    const key = keyOf(c);
    if (chosen.has(key)) {
      setSelected((prev) => prev.filter((p) => keyOf(p.candidate) !== key));
      return;
    }
    const suggested = suggestFromCandidate(c, allPlatforms, genres.data ?? [], platformFilter);
    setSelected((prev) => [...prev, { candidate: c, ...PICK_DEFAULTS, ...suggested }]);
  };
  const change = (key: string, patch: Partial<Picked>) =>
    setSelected((prev) => prev.map((p) => (keyOf(p.candidate) === key ? { ...p, ...patch } : p)));
  const changeAll = (patch: Partial<Picked>) => setSelected((prev) => prev.map((p) => ({ ...p, ...patch })));

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
  const n = selected.length;
  const ready = n > 0 && selected.every((p) => p.platform);
  const submit = () => {
    if (!ready) return;
    create.mutate(
      selected.map((p) => ({
        name: p.candidate.name,
        platform_id: Number(p.platform),
        status: p.status,
        priority: p.priority || null,
        access: p.access,
        genre_id: p.genre ? Number(p.genre) : null,
        link: { provider: p.candidate.provider as SearchProvider, external_id: p.candidate.external_id },
      })),
      {
        onSuccess: (games) => {
          if (games.length === 1) {
            toast.show(`${games[0].name} entrou na biblioteca. Buscando os dados nas integrações…`, "ok");
            navigate(`/jogos/${games[0].id}`);
            return;
          }
          toast.show(`${games.length} jogos entraram na biblioteca. Buscando os dados nas integrações…`, "ok", {
            label: "Ver na biblioteca",
            onClick: () => navigate("/biblioteca?lista=todos"),
          });
          setSelected([]);
        },
        onError: (e) => toast.error(`Não consegui adicionar: ${errorMessage(e)}`),
      },
    );
  };

  return (
    <>
      <section aria-label="Buscar na integração" className="card" style={{ gap: 16 }}>
        <div className={styles.searchRow}>
          <label className="field" style={{ flex: "0 1 160px" }}>
            Fonte
            <select className="select" value={activeSource ?? ""} onChange={(e) => setSource(e.target.value as SearchProvider)}>
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
              onChange={(e) => setQ(e.target.value)}
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
              const on = chosen.has(keyOf(c));
              return (
                <button key={keyOf(c)} type="button" className={styles.result} aria-pressed={on} onClick={() => toggle(c)}>
                  <CandidateThumb candidate={c} />
                  <span className={styles.resultInfo}>
                    <span className={styles.resultName}>
                      {c.name}
                      {c.year ? <span className="muted"> ({c.year})</span> : null}
                    </span>
                    <span className={styles.resultMeta}>{summarizePlatforms(c.platforms)}</span>
                    {c.in_library.length > 0 && <span className={styles.owned}>Já na biblioteca</span>}
                  </span>
                  <span className={styles.pickLabel}>
                    {on ? (
                      <>
                        <Icon name="check" size={14} strokeWidth={3} /> Selecionado
                      </>
                    ) : (
                      "Selecionar"
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {n > 0 && (
        <section id="selecionados" aria-labelledby="h-selecionados" className="card" style={{ gap: 14 }}>
          <div className={styles.selHead}>
            <h2 id="h-selecionados" className="section-title">
              Selecionados <span className="count">{n}</span>
            </h2>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelected([])}>
              Limpar seleção
            </button>
          </div>
          {n > 1 && <ChangeAll onChange={changeAll} />}
          <ul className={styles.picks}>
            {selected.map((p) => (
              <PickRow
                key={keyOf(p.candidate)}
                pick={p}
                platforms={allPlatforms}
                genres={genres.data ?? []}
                devices={devices.data ?? []}
                onChange={(patch) => change(keyOf(p.candidate), patch)}
                onRemove={() => toggle(p.candidate)}
              />
            ))}
          </ul>
        </section>
      )}

      {n > 0 && (
        <div className={styles.confirmBar}>
          <a href="#selecionados" className={styles.confirmCount}>
            {n} {n === 1 ? "selecionado" : "selecionados"}
          </a>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={create.isPending || !ready}>
            {create.isPending ? "Adicionando…" : n === 1 ? "Adicionar à biblioteca" : `Adicionar ${n} jogos`}
          </button>
        </div>
      )}
    </>
  );
}

function CandidateThumb({ candidate: c }: { candidate: Candidate }) {
  return c.cover_thumb ? (
    <img className={styles.thumb} src={c.cover_thumb} alt="" loading="lazy" />
  ) : (
    <span className={styles.thumb} aria-hidden="true">
      {initials(c.name)}
    </span>
  );
}

/** Status, prioridade e posse para todos os selecionados de uma vez (o select volta ao rótulo). */
function ChangeAll({ onChange }: { onChange: (patch: Partial<Picked>) => void }) {
  return (
    <div className={styles.changeAll} role="group" aria-label="Mudar todos os selecionados">
      <span className="eyebrow">Para todos</span>
      <select
        className="select"
        aria-label="Status de todos"
        value=""
        onChange={(e) => onChange({ status: e.target.value as Status })}
      >
        <option value="" disabled>
          Status…
        </option>
        {LIST_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {STATUS1[s]}
          </option>
        ))}
      </select>
      <select
        className="select"
        aria-label="Prioridade de todos"
        value=""
        onChange={(e) => onChange({ priority: e.target.value === "none" ? "" : (e.target.value as Priority) })}
      >
        <option value="" disabled>
          Prioridade…
        </option>
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {PRIORITY_LABEL[p]}
          </option>
        ))}
        <option value="none">Nenhuma</option>
      </select>
      <select
        className="select"
        aria-label="Posse de todos"
        value=""
        onChange={(e) => onChange({ access: e.target.value as Access })}
      >
        <option value="" disabled>
          Posse…
        </option>
        {ACCESS_ORDER.map((a) => (
          <option key={a} value={a}>
            {ACCESS_LABEL[a]}
          </option>
        ))}
      </select>
    </div>
  );
}

function PickRow({
  pick: p,
  platforms,
  genres,
  devices,
  onChange,
  onRemove,
}: {
  pick: Picked;
  platforms: Platform[];
  genres: Genre[];
  devices: Device[];
  onChange: (patch: Partial<Picked>) => void;
  onRemove: () => void;
}) {
  const c = p.candidate;
  return (
    <li className={styles.pick}>
      <div className={styles.pickHead}>
        <CandidateThumb candidate={c} />
        <span className={styles.resultInfo}>
          <span className={styles.resultName}>
            {c.name}
            {c.year ? <span className="muted"> ({c.year})</span> : null}
          </span>
          <span className={styles.resultMeta}>
            Jogável em: {availability(p.platform ? Number(p.platform) : null, devices)}
          </span>
          {c.in_library.length > 0 && (
            <span className={styles.already}>
              Você já tem esse jogo:{" "}
              {c.in_library.map((id, i) => (
                <span key={id}>
                  {i > 0 && ", "}
                  <Link to={`/jogos/${id}`}>abrir</Link>
                </span>
              ))}
              . Adicionar de novo cria outra entrada (útil para rejogar ou outra plataforma).
            </span>
          )}
        </span>
        <button type="button" className="btn btn-icon" aria-label={`Tirar ${c.name} da seleção`} onClick={onRemove}>
          <Icon name="close" />
        </button>
      </div>
      <div className={styles.pickFields}>
        <label className="field">
          Plataforma
          <select className="select" value={p.platform} onChange={(e) => onChange({ platform: e.target.value })}>
            {platforms.map((pl) => (
              <option key={pl.id} value={pl.id}>
                {pl.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Status
          <select className="select" value={p.status} onChange={(e) => onChange({ status: e.target.value as Status })}>
            {LIST_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STATUS1[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Prioridade
          <select
            className="select"
            value={p.priority}
            onChange={(e) => onChange({ priority: e.target.value as Priority | "" })}
          >
            <option value="">—</option>
            {PRIORITIES.map((pr) => (
              <option key={pr} value={pr}>
                {PRIORITY_LABEL[pr]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Posse
          <select className="select" value={p.access} onChange={(e) => onChange({ access: e.target.value as Access })}>
            {ACCESS_ORDER.map((a) => (
              <option key={a} value={a}>
                {ACCESS_LABEL[a]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Gênero
          <select className="select" value={p.genre} onChange={(e) => onChange({ genre: e.target.value })}>
            <option value="">Sem gênero</option>
            {genres.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </li>
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
    status: "owned" as Status,
    priority: "Baixa" as Priority | "",
    access: "owned" as Access,
    release: "",
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
        access: f.access,
        release_date: f.release || null,
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
          Posse
          <select className="select" value={f.access} onChange={(e) => set("access", e.target.value)}>
            {ACCESS_ORDER.map((a) => (
              <option key={a} value={a}>
                {ACCESS_LABEL[a]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Lançamento
          <input
            className="input"
            type="date"
            style={{ colorScheme: "dark" }}
            value={f.release}
            onChange={(e) => set("release", e.target.value)}
          />
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
