import { useEffect, useState, type ReactNode } from "react";

import type { Access, Account, Device, Priority } from "../../api/types";
import { ACCESS_LABEL, ACCESS_ORDER, PRIORITIES, PRIORITY_LABEL } from "../../lib/constants";
import { parseNum } from "../../lib/format";
import { fold } from "../../lib/text";
import styles from "./FilterPanel.module.css";
import {
  PRESETS,
  RANGES,
  accountLabel,
  type Facet,
  type Facets,
  type Filters,
  type Range,
  type RangeKey,
} from "./filters";

interface Props {
  f: Filters;
  onChange: (next: Filters) => void;
  facets: Facets;
  devices: Device[];
  accounts: Account[];
}

const TAGS_SHOWN = 24;

function toggle<T>(xs: T[], x: T): T[] {
  return xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x];
}

export function FilterPanel({ f, onChange, facets, devices, accounts }: Props) {
  const set = (patch: Partial<Filters>) => onChange({ ...f, ...patch });
  const setRange = (k: RangeKey, r: Range) => set({ ranges: { ...f.ranges, [k]: r } });
  const range = (k: RangeKey) => <RangeField key={k} k={k} value={f.ranges[k]} onChange={(r) => setRange(k, r)} />;
  const accountFacets: Facet<number>[] = accounts.map((a) => ({
    key: a.id,
    label: accountLabel(a),
    count: facets.accounts.find((x) => x.key === a.id)?.count ?? 0,
  }));

  return (
    <div className={styles.panel}>
      <Section title="Atalhos" wide>
        <div className={styles.pills}>
          {PRESETS.map((p) => (
            <button key={p.id} type="button" className="pill" title={p.hint} onClick={() => onChange(p.apply(f))}>
              {p.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Onde">
        <Pills
          label="Plataforma"
          options={facets.platforms}
          selected={f.platforms}
          onToggle={(v) => set({ platforms: toggle(f.platforms, v) })}
        />
        <Pills
          label="Jogável em"
          options={devices.map((d) => ({ key: d.id, label: d.name, count: -1 }))}
          selected={f.devices}
          onToggle={(v) => set({ devices: toggle(f.devices, v) })}
        />
        <Pills
          label="Loja"
          options={facets.stores}
          selected={f.stores}
          onToggle={(v) => set({ stores: toggle(f.stores, v) })}
        />
        {accountFacets.length > 0 && (
          <Pills
            label="Conta"
            options={accountFacets}
            selected={f.accounts}
            onToggle={(v) => set({ accounts: toggle(f.accounts, v) })}
          />
        )}
      </Section>

      <Section title="Sobre o jogo">
        <Pills
          label="Gênero"
          options={facets.genres}
          selected={f.genres}
          onToggle={(v) => set({ genres: toggle(f.genres, v) })}
        />
        <TagPicker tags={facets.tags} selected={f.tags} onToggle={(t) => set({ tags: toggle(f.tags, t) })} />
        <TextField
          label="Desenvolvedora ou publicadora"
          value={f.company}
          placeholder="Ex.: Supergiant"
          onChange={(company) => set({ company })}
        />
        {range("year")}
      </Section>

      <Section title="Notas">
        {range("mc")}
        {range("mcu")}
        {range("score")}
      </Section>

      <Section title="Tempo">
        {range("hltb")}
        {range("played")}
        <label className="check">
          <input type="checkbox" checked={f.neverPlayed} onChange={(e) => set({ neverPlayed: e.target.checked })} />{" "}
          Nunca jogado (sem horas)
        </label>
      </Section>

      <Section title="Seu controle">
        <Pills
          label="Prioridade"
          options={PRIORITIES.map((p) => ({ key: p, label: PRIORITY_LABEL[p], count: -1 }))}
          selected={f.priorities}
          onToggle={(v: Priority) => set({ priorities: toggle(f.priorities, v) })}
        />
        <Pills
          label="Posse"
          options={ACCESS_ORDER.map((a) => ({ key: a, label: ACCESS_LABEL[a], count: -1 }))}
          selected={f.access}
          onToggle={(v: Access) => set({ access: toggle(f.access, v) })}
        />
        <label className="check">
          <input type="checkbox" checked={f.multi} onChange={(e) => set({ multi: e.target.checked })} /> Em 2 ou mais
          contas
        </label>
        <label className="check">
          <input type="checkbox" checked={f.noMeta} onChange={(e) => set({ noMeta: e.target.checked })} /> Sem metadados
          ainda
        </label>
        <label className="check">
          <input type="checkbox" checked={f.unknown} onChange={(e) => set({ unknown: e.target.checked })} /> Nas faixas,
          manter jogos sem o dado
        </label>
      </Section>
    </div>
  );
}

function Section({ title, wide, children }: { title: string; wide?: boolean; children: ReactNode }) {
  return (
    <fieldset className={`${styles.section} ${wide ? styles.wide : ""}`}>
      <legend className={styles.legend}>{title}</legend>
      {children}
    </fieldset>
  );
}

function Pills<K extends string | number>({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: Facet<K>[];
  selected: K[];
  onToggle: (v: K) => void;
}) {
  if (!options.length) return null;
  return (
    <div role="group" aria-label={label} className={styles.group}>
      <span className={styles.groupLabel}>{label}</span>
      <div className={styles.pills}>
        {options.map((o) => (
          <button
            key={String(o.key)}
            type="button"
            className={`pill ${styles.pill}`}
            aria-pressed={selected.includes(o.key)}
            onClick={() => onToggle(o.key)}
          >
            {o.label}
            {o.count >= 0 && <span className={styles.count}>{o.count}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function TagPicker({
  tags,
  selected,
  onToggle,
}: {
  tags: Facet<string>[];
  selected: string[];
  onToggle: (t: string) => void;
}) {
  const [q, setQ] = useState("");
  if (!tags.length) return null;
  const needle = fold(q);
  const matching = tags.filter((t) => !needle || fold(t.label).includes(needle));
  // As selecionadas ficam sempre visíveis, mesmo fora do top.
  const shown = [
    ...matching.slice(0, TAGS_SHOWN),
    ...matching.slice(TAGS_SHOWN).filter((t) => selected.includes(t.key)),
  ];
  return (
    <div className={styles.group}>
      <span className={styles.groupLabel}>Tags</span>
      <input
        type="search"
        className="input"
        aria-label="Procurar tag"
        placeholder={`Procurar entre ${tags.length} tags`}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className={styles.pills} role="group" aria-label="Tags">
        {shown.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`pill ${styles.pill}`}
            aria-pressed={selected.includes(t.key)}
            onClick={() => onToggle(t.key)}
          >
            {t.label}
            <span className={styles.count}>{t.count}</span>
          </button>
        ))}
        {!shown.length && <span className="muted">Nenhuma tag com esse nome.</span>}
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="field">
      {label}
      <input className="input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** Mín–máx. Guarda o que está sendo digitado ("7," ainda não é número) e só aplica valores válidos. */
function RangeField({ k, value, onChange }: { k: RangeKey; value: Range; onChange: (r: Range) => void }) {
  const spec = RANGES[k];
  const [min, setMin] = useState(fmt(value.min));
  const [max, setMax] = useState(fmt(value.max));

  // Chip removido ou atalho aplicado: acompanha o valor de fora.
  useEffect(() => setMin(fmt(value.min)), [value.min]);
  useEffect(() => setMax(fmt(value.max)), [value.max]);

  const commit = (nextMin: string, nextMax: string) => {
    const a = parseNum(nextMin);
    const b = parseNum(nextMax);
    if ((nextMin.trim() && a === null) || (nextMax.trim() && b === null)) return;
    if (a !== value.min || b !== value.max) onChange({ min: a, max: b });
  };

  return (
    <div role="group" aria-label={spec.label} className={styles.group}>
      <span className={styles.groupLabel}>
        {spec.label}
        {spec.unit ? ` (${spec.unit === "h" ? "horas" : spec.unit})` : ""}
      </span>
      <div className={styles.range}>
        <input
          className="input"
          inputMode="decimal"
          aria-label={`${spec.label}: mínimo`}
          placeholder="mín."
          value={min}
          onChange={(e) => {
            setMin(e.target.value);
            commit(e.target.value, max);
          }}
        />
        <span aria-hidden="true" className="muted">
          até
        </span>
        <input
          className="input"
          inputMode="decimal"
          aria-label={`${spec.label}: máximo`}
          placeholder="máx."
          value={max}
          onChange={(e) => {
            setMax(e.target.value);
            commit(min, e.target.value);
          }}
        />
      </div>
    </div>
  );
}

function fmt(n: number | null): string {
  return n === null ? "" : String(n).replace(".", ",");
}
