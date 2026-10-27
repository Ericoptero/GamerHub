import { useState, type FormEvent } from "react";

import { errorMessage } from "../../api/client";
import { useGenres, usePlatforms, useUpdateGame } from "../../api/queries";
import type { GameDetail, GamePatch, Priority, Status } from "../../api/types";
import { Dialog } from "../../components/Dialog";
import { Icon } from "../../components/Icon";
import { PRIORITIES, PRIORITY_LABEL, STATUS1, STATUS_ORDER } from "../../lib/constants";
import { numToInput, parseNum } from "../../lib/format";
import { fold, splitList } from "../../lib/text";

interface FormState {
  name: string;
  platform_id: string;
  genre_id: string;
  status: Status;
  priority: string;
  hltb_main_hours: string;
  played_hours: string;
  finished_at: string;
  finished_label: string;
  release_date: string;
  times_completed: string;
  stores: string;
  metacritic_score: string;
  cover_url: string;
  description: string;
}

function initial(g: GameDetail): FormState {
  return {
    name: g.name,
    platform_id: String(g.platform_id),
    genre_id: g.genre_id ? String(g.genre_id) : "",
    status: g.status,
    priority: g.priority ?? "",
    hltb_main_hours: numToInput(g.hltb_main_hours),
    played_hours: numToInput(g.played_hours),
    finished_at: g.finished_at ?? "",
    finished_label: g.finished_label ?? "",
    release_date: g.release_date ?? "",
    times_completed: numToInput(g.times_completed),
    stores: g.stores.join(", "),
    metacritic_score: numToInput(g.metacritic_score),
    cover_url: g.cover_url ?? "",
    description: g.description ?? "",
  };
}

/** Só os campos que mudaram (editar um metadado o trava contra a integração). */
function diff(g: GameDetail, f: FormState, tags: string[]): GamePatch {
  const p: GamePatch = {};
  const str = (v: string) => v.trim() || null;
  if (f.name.trim() && f.name.trim() !== g.name) p.name = f.name.trim();
  if (Number(f.platform_id) !== g.platform_id) p.platform_id = Number(f.platform_id);
  const genre = f.genre_id ? Number(f.genre_id) : null;
  if (genre !== g.genre_id) p.genre_id = genre;
  if (f.status !== g.status) p.status = f.status;
  const prio = (f.priority || null) as Priority | null;
  if (prio !== g.priority) p.priority = prio;
  const nums: [keyof FormState & keyof GamePatch, number | null][] = [
    ["hltb_main_hours", g.hltb_main_hours],
    ["played_hours", g.played_hours],
    ["times_completed", g.times_completed],
    ["metacritic_score", g.metacritic_score],
  ];
  for (const [k, old] of nums) {
    const v = parseNum(f[k] as string);
    if (v !== old) (p as Record<string, unknown>)[k] = k === "times_completed" || k === "metacritic_score" ? (v === null ? null : Math.round(v)) : v;
  }
  if (str(f.finished_at) !== g.finished_at) p.finished_at = str(f.finished_at);
  if (str(f.finished_label) !== g.finished_label) p.finished_label = str(f.finished_label);
  if (str(f.release_date) !== g.release_date) p.release_date = str(f.release_date);
  if (str(f.cover_url) !== g.cover_url) p.cover_url = str(f.cover_url);
  if (str(f.description) !== g.description) p.description = str(f.description);
  const stores = splitList(f.stores);
  if (stores.join("|") !== g.stores.join("|")) p.stores = stores;
  if (tags.join("\n") !== g.tags.join("\n")) p.tags = tags;
  return p;
}

export function EditGameDialog({ game, open, onClose }: { game: GameDetail; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Editar jogo">
      {open && <EditForm game={game} onClose={onClose} />}
    </Dialog>
  );
}

function EditForm({ game, onClose }: { game: GameDetail; onClose: () => void }) {
  const platforms = usePlatforms();
  const genres = useGenres();
  const update = useUpdateGame(game.id);
  const [f, setF] = useState<FormState>(() => initial(game));
  const [tags, setTags] = useState<string[]>(game.tags);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((prev) => ({ ...prev, [k]: v }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const patch = diff(game, f, tags);
    if (!Object.keys(patch).length) return onClose();
    setError(null);
    update.mutate(patch, { onSuccess: onClose, onError: (err) => setError(errorMessage(err)) });
  };

  const text = (k: keyof FormState, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="field">
      {label}
      <input className="input" value={f[k]} onChange={(e) => set(k, e.target.value as never)} {...props} />
    </label>
  );

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {text("name", "Nome do jogo", { required: true })}
      <div className="field-grid">
        <label className="field">
          Plataforma
          <select className="select" value={f.platform_id} onChange={(e) => set("platform_id", e.target.value)}>
            {(platforms.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Gênero
          <select className="select" value={f.genre_id} onChange={(e) => set("genre_id", e.target.value)}>
            <option value="">Sem gênero</option>
            {(genres.data ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Status
          <select className="select" value={f.status} onChange={(e) => set("status", e.target.value as Status)}>
            {STATUS_ORDER.map((s) => (
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
        {text("hltb_main_hours", "HLTB (horas)", { inputMode: "decimal" })}
        {text("played_hours", "Horas jogadas", { inputMode: "decimal" })}
        {text("metacritic_score", "Nota Metacritic", { inputMode: "numeric", placeholder: "0–100" })}
        {text("times_completed", "Vezes zerado", { inputMode: "numeric" })}
        {text("finished_at", "Finalizado em", { type: "date" })}
        {text("finished_label", "…ou texto livre", { placeholder: "Ex.: Antes de 2022" })}
        {text("release_date", "Lançamento", { type: "date" })}
      </div>
      {text("stores", "Lojas (separadas por vírgula)", { placeholder: "Steam, Epic" })}
      <TagsField tags={tags} onChange={setTags} />
      {text("cover_url", "URL da capa", { type: "url", placeholder: "https://…" })}
      <label className="field">
        Descrição
        <textarea className="textarea" rows={4} value={f.description} onChange={(e) => set("description", e.target.value)} />
      </label>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        Campos de metadado (HLTB, Metacritic, capa, descrição, lançamento, tags) editados aqui ficam travados: a
        integração não os sobrescreve até você destravar.
      </p>
      {error && <p className="error-text">{error}</p>}
      <div className="row-end">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primary" disabled={update.isPending}>
          {update.isPending ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </form>
  );
}

/** Tags como chips: algumas do IGDB têm vírgula no nome ("4X (explore, expand…)"), então não dá para separar
 * por vírgula como as lojas. */
function TagsField({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (t && !tags.some((x) => fold(x) === fold(t))) onChange([...tags, t]);
    setDraft("");
  };
  return (
    <div className="field">
      <span id="edit-tags-label">Tags</span>
      {tags.length > 0 && (
        <div className="row" style={{ gap: 6 }}>
          {tags.map((t) => (
            <button
              key={t}
              type="button"
              className="chip"
              style={{ gap: 6, border: 0, cursor: "pointer" }}
              aria-label={`Tirar a tag ${t}`}
              onClick={() => onChange(tags.filter((x) => x !== t))}
            >
              {t} <Icon name="close" size={11} />
            </button>
          ))}
        </div>
      )}
      <div className="row">
        <input
          className="input"
          style={{ flex: "1 1 200px", width: "auto" }}
          aria-labelledby="edit-tags-label"
          placeholder="Nova tag (Enter para pôr)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="btn btn-sm" disabled={!draft.trim()} onClick={add}>
          Adicionar
        </button>
      </div>
    </div>
  );
}
