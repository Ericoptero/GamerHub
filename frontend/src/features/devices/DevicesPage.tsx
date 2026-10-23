import { useState, type CSSProperties, type FormEvent } from "react";

import { errorMessage } from "../../api/client";
import { useDeviceMutations, useDevices, useGames, usePlatformMutations, usePlatforms } from "../../api/queries";
import type { Device, Platform } from "../../api/types";
import { useConfirm } from "../../components/Confirm";
import { Icon } from "../../components/Icon";
import { ErrorState, LoadingState } from "../../components/NotFound";
import { useToast } from "../../components/Toast";
import { KINDS } from "../../lib/constants";
import { playableInQueue } from "../library/selectors";
import styles from "./DevicesPage.module.css";

function PlatformToggles({
  platforms,
  selected,
  onToggle,
}: {
  platforms: Platform[];
  selected: number[];
  onToggle: (id: number) => void;
}) {
  return (
    <div className={styles.toggles}>
      {platforms.map((p) => (
        <button key={p.id} type="button" className="pill" aria-pressed={selected.includes(p.id)} onClick={() => onToggle(p.id)}>
          {p.name}
        </button>
      ))}
    </div>
  );
}

const toggle = (list: number[], id: number) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

export function DevicesPage() {
  const devices = useDevices();
  const platforms = usePlatforms();
  const games = useGames();

  if (devices.isError) return <ErrorState error={devices.error} onRetry={() => devices.refetch()} />;
  if (devices.isPending || platforms.isPending) return <LoadingState />;

  const plats = platforms.data ?? [];
  return (
    <main className="page page-wide">
      <div className="page-head">
        <h1 className="page-title">Meus consoles</h1>
        <p className="lead">
          Plataforma é o sistema do jogo (GBA, PS1, PC). Aparelho é onde você joga (Steam Deck, Miyoo Mini Plus). Cada aparelho
          roda uma ou mais plataformas.
        </p>
      </div>

      <section aria-labelledby="h-aps" className={styles.section}>
        <h2 id="h-aps" className="section-title" style={{ fontSize: 24 }}>
          Aparelhos <span className="count">{devices.data.length}</span>
        </h2>
        <div className={styles.grid}>
          {devices.data.map((d) => (
            <DeviceCard key={d.id} device={d} platforms={plats} playable={playableInQueue(games.data ?? [], d)} />
          ))}
        </div>
        <NewDeviceForm platforms={plats} />
      </section>

      <PlatformsSection platforms={plats} />
    </main>
  );
}

function DeviceCard({ device, platforms, playable }: { device: Device; platforms: Platform[]; playable: number }) {
  const { update, remove } = useDeviceMutations();
  const toast = useToast();
  const [dialog, confirm] = useConfirm();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: device.name, kind: device.kind, platform_ids: device.platform_ids });
  const names = platforms.filter((p) => device.platform_ids.includes(p.id)).map((p) => p.name);

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.name.trim()) return;
    update.mutate(
      { id: device.id, patch: { ...draft, name: draft.name.trim() } },
      { onSuccess: () => setEditing(false), onError: (err) => toast.error(errorMessage(err)) },
    );
  };

  const del = async () => {
    if (await confirm({ title: "Remover aparelho", message: `Remover ${device.name}? Os jogos não são afetados.`, confirmLabel: "Remover", danger: true })) {
      remove.mutate(device.id, { onError: (err) => toast.error(errorMessage(err)) });
    }
  };

  if (editing) {
    return (
      <form className={styles.card} onSubmit={save} aria-label={`Editar ${device.name}`}>
        <label className="field">
          Nome
          <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
        </label>
        <label className="field">
          Tipo
          <select className="select" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <div role="group" aria-label="Plataformas que ele roda" className="field">
          Plataformas que ele roda
          <PlatformToggles
            platforms={platforms}
            selected={draft.platform_ids}
            onToggle={(id) => setDraft({ ...draft, platform_ids: toggle(draft.platform_ids, id) })}
          />
        </div>
        <div className="row-end">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={update.isPending}>
            Salvar
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.icon} aria-hidden="true">
          <Icon name="device" size={20} strokeWidth={2} />
        </span>
        <span className={styles.cardTitle}>
          <span className={styles.name}>{device.name}</span>
          <span className={styles.kind}>{device.kind}</span>
        </span>
        <button
          type="button"
          className="btn btn-icon"
          aria-label={`Editar ${device.name}`}
          onClick={() => {
            setDraft({ name: device.name, kind: device.kind, platform_ids: device.platform_ids });
            setEditing(true);
          }}
        >
          <Icon name="edit" />
        </button>
        <button type="button" className="btn btn-icon" aria-label={`Remover ${device.name}`} onClick={del}>
          <Icon name="close" />
        </button>
      </div>
      <div className={styles.chips}>
        {names.length ? names.map((n) => <span key={n} className={styles.chip}>{n}</span>) : <span className="muted">Nenhuma plataforma</span>}
      </div>
      <span className={styles.playable}>
        {playable} {playable === 1 ? "jogo da fila jogável" : "jogos da fila jogáveis"} aqui
      </span>
      {dialog}
    </div>
  );
}

function NewDeviceForm({ platforms }: { platforms: Platform[] }) {
  const { create } = useDeviceMutations();
  const toast = useToast();
  const [nd, setNd] = useState({ name: "", kind: "Portátil", platform_ids: [] as number[] });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!nd.name.trim()) return;
    create.mutate(
      { ...nd, name: nd.name.trim() },
      {
        onSuccess: (d) => {
          toast.show(`${d.name} cadastrado.`, "ok");
          setNd({ name: "", kind: "Portátil", platform_ids: [] });
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  return (
    <form aria-label="Novo aparelho" onSubmit={submit} className={styles.newForm}>
      <span style={{ fontWeight: 700, fontSize: 15 }}>Novo aparelho</span>
      <div className="row" style={{ gap: 12, alignItems: "flex-end" }}>
        <label className="field" style={{ flex: "2 1 240px" }}>
          Nome
          <input className="input" required value={nd.name} onChange={(e) => setNd({ ...nd, name: e.target.value })} placeholder="Ex.: Anbernic RG35XX" />
        </label>
        <label className="field" style={{ flex: "1 1 160px" }}>
          Tipo
          <select className="select" value={nd.kind} onChange={(e) => setNd({ ...nd, kind: e.target.value })}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div role="group" aria-label="Plataformas que ele roda" className="field" style={{ gap: 8 }}>
        Plataformas que ele roda
        <PlatformToggles
          platforms={platforms}
          selected={nd.platform_ids}
          onToggle={(id) => setNd({ ...nd, platform_ids: toggle(nd.platform_ids, id) })}
        />
      </div>
      <div className="row-end">
        <button type="submit" className="btn btn-primary" disabled={create.isPending}>
          Adicionar aparelho
        </button>
      </div>
    </form>
  );
}

function PlatformsSection({ platforms }: { platforms: Platform[] }) {
  const { create, remove } = usePlatformMutations();
  const toast = useToast();
  const [np, setNp] = useState("");

  const add = (e: FormEvent) => {
    e.preventDefault();
    const name = np.trim();
    if (!name) return;
    create.mutate({ name }, { onSuccess: () => setNp(""), onError: (err) => toast.error(errorMessage(err)) });
  };

  return (
    <section aria-labelledby="h-plats" className="card">
      <h2 id="h-plats" className="section-title" style={{ fontSize: 24 }}>
        Plataformas <span className="count">{platforms.length}</span>
      </h2>
      <div className={styles.platChips}>
        {platforms.map((p) => (
          <span key={p.id} className={styles.platChip}>
            {p.name} <span className="muted" style={{ fontWeight: 500 }}>{p.game_count}</span>
            <button
              type="button"
              className={styles.platRemove}
              aria-label={`Remover ${p.name}`}
              onClick={() => remove.mutate(p.id, { onError: (err) => toast.error(errorMessage(err)) })}
            >
              <Icon name="close" size={14} strokeWidth={2.4} />
            </button>
          </span>
        ))}
      </div>
      <form onSubmit={add} className="row" style={{ alignItems: "flex-end" }}>
        <label className="field" style={{ flex: "0 1 280px" }}>
          Nova plataforma
          <input className="input" value={np} onChange={(e) => setNp(e.target.value)} placeholder="Ex.: PC Engine" />
        </label>
        <button type="submit" className="btn" disabled={create.isPending || !np.trim()}>
          Adicionar
        </button>
      </form>
      <details className={styles.advanced}>
        <summary>Avançado: como cada plataforma se chama nas integrações</summary>
        <p className="muted" style={{ fontSize: 12, margin: "8px 0 12px", lineHeight: 1.5 }}>
          Esses ids e nomes ajudam a achar a versão certa do jogo (ex.: Resident Evil 3 de PS1 e não o remake de PC). Os ids
          ficam nas URLs da API do IGDB e da RAWG; os nomes são os exibidos no Metacritic e no HowLongToBeat.
        </p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Plataforma</th>
                <th scope="col">IGDB id</th>
                <th scope="col">RAWG id</th>
                <th scope="col">Metacritic</th>
                <th scope="col">HLTB</th>
                <th scope="col">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {platforms.map((p) => (
                <MappingRow key={p.id} platform={p} />
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function MappingRow({ platform: p }: { platform: Platform }) {
  const { update } = usePlatformMutations();
  const toast = useToast();
  const init = {
    igdb: p.igdb_platform_id?.toString() ?? "",
    rawg: p.rawg_platform_id?.toString() ?? "",
    mc: p.metacritic_name ?? "",
    hltb: p.hltb_name ?? "",
  };
  const [v, setV] = useState(init);
  const dirty = JSON.stringify(v) !== JSON.stringify(init);
  const cell: CSSProperties = { height: 36, fontSize: 12 };
  const int = (s: string) => (s.trim() && Number.isFinite(Number(s)) ? Number(s) : null);

  const save = () =>
    update.mutate(
      {
        id: p.id,
        patch: { igdb_platform_id: int(v.igdb), rawg_platform_id: int(v.rawg), metacritic_name: v.mc.trim() || null, hltb_name: v.hltb.trim() || null },
      },
      { onSuccess: () => toast.show(`Mapeamento de ${p.name} salvo.`, "ok"), onError: (err) => toast.error(errorMessage(err)) },
    );

  return (
    <tr>
      <th scope="row" style={{ color: "var(--text)" }}>
        {p.name}
      </th>
      <td>
        <input className="input" style={{ ...cell, width: 80 }} inputMode="numeric" aria-label={`IGDB id de ${p.name}`} value={v.igdb} onChange={(e) => setV({ ...v, igdb: e.target.value })} />
      </td>
      <td>
        <input className="input" style={{ ...cell, width: 80 }} inputMode="numeric" aria-label={`RAWG id de ${p.name}`} value={v.rawg} onChange={(e) => setV({ ...v, rawg: e.target.value })} />
      </td>
      <td>
        <input className="input" style={{ ...cell, width: 160 }} aria-label={`Nome no Metacritic de ${p.name}`} value={v.mc} onChange={(e) => setV({ ...v, mc: e.target.value })} />
      </td>
      <td>
        <input className="input" style={{ ...cell, width: 180 }} aria-label={`Nome no HLTB de ${p.name}`} value={v.hltb} onChange={(e) => setV({ ...v, hltb: e.target.value })} />
      </td>
      <td>
        <button type="button" className="btn btn-sm" disabled={!dirty || update.isPending} onClick={save}>
          Salvar
        </button>
      </td>
    </tr>
  );
}
