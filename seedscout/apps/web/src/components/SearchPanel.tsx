import { useEffect, useRef, useState } from "react";
import { Biome, STRUCTURES, type Clause, type StructureKey } from "@seedscout/engine";
import type { SearchJob } from "@seedscout/shared";
import type { World } from "../engine/protocol";
import { pool } from "../engine/pool";
import { api, ApiError } from "../api";

interface Props {
  world: World;
  isPro: boolean;
  onUpgrade(): void;
  onAuthError(e: ApiError): void;
  onOpenSeed(seed: string): void;
}

type Row =
  | { kind: "structure"; structure: StructureKey; within: number; nearOn: boolean; nearBiome: number; nearWithin: number }
  | { kind: "biome"; biome: number; within: number }
  | { kind: "minScore"; score: number };

const toClause = (r: Row): Clause =>
  r.kind === "structure"
    ? { kind: "structure", structure: r.structure, within: r.within, ...(r.nearOn && { near: { biome: r.nearBiome, within: r.nearWithin } }) }
    : r.kind === "biome"
      ? { kind: "biome", biome: r.biome, within: r.within }
      : { kind: "minScore", score: r.score };

const pretty = (s: string) => s.replace(/_/g, " ");

export function SearchPanel({ world, isPro, onUpgrade, onAuthError, onOpenSeed }: Props) {
  const [biomes, setBiomes] = useState<Array<[number, string]>>([]);
  const [rows, setRows] = useState<Row[]>([
    { kind: "structure", structure: "village", within: 500, nearOn: true, nearBiome: Biome.mushroom_fields, nearWithin: 96 },
  ]);
  const [job, setJob] = useState<SearchJob | null>(null);
  const [error, setError] = useState("");
  const timer = useRef<number>(0);

  useEffect(() => {
    pool.request("biomeList", { version: world.version }).then(setBiomes).catch(() => {});
  }, [world.version]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const update = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? ({ ...r, ...patch } as Row) : r)));

  function poll(id: string) {
    api<SearchJob>(`/search/${id}`).then((j) => {
      setJob(j);
      if (j.status === "queued" || j.status === "running") timer.current = window.setTimeout(() => poll(id), 2000);
    });
  }

  async function run() {
    if (!isPro) return onUpgrade();
    setError("");
    try {
      const { id } = await api<{ id: string }>("/search", { body: { version: world.version, clauses: rows.map(toClause) } });
      poll(id);
    } catch (e) {
      if (e instanceof ApiError) e.status === 429 ? setError(e.message) : onAuthError(e);
    }
  }

  const biomeSelect = (value: number, onChange: (v: number) => void) => (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {biomes.map(([id, name]) => <option key={id} value={id}>{pretty(name)}</option>)}
    </select>
  );

  return (
    <div className="panel">
      {!isPro && <p className="upsell">Find seeds that match exactly what you want. <button className="link" onClick={onUpgrade}>Go Pro</button></p>}
      {rows.map((r, i) => (
        <div className="clause" key={i}>
          {r.kind === "structure" && (
            <>
              <label>
                <select value={r.structure} onChange={(e) => update(i, { structure: e.target.value as StructureKey })}>
                  {STRUCTURES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
                within <input type="number" inputMode="numeric" value={r.within} onChange={(e) => update(i, { within: +e.target.value })} /> blocks of spawn
              </label>
              <label className="check">
                <input type="checkbox" checked={r.nearOn} onChange={(e) => update(i, { nearOn: e.target.checked })} /> next to
                {biomeSelect(r.nearBiome, (v) => update(i, { nearBiome: v }))}
              </label>
            </>
          )}
          {r.kind === "biome" && (
            <label>
              {biomeSelect(r.biome, (v) => update(i, { biome: v }))} within{" "}
              <input type="number" inputMode="numeric" value={r.within} onChange={(e) => update(i, { within: +e.target.value })} /> blocks
            </label>
          )}
          {r.kind === "minScore" && (
            <label>
              Seed score at least <input type="number" inputMode="numeric" value={r.score} onChange={(e) => update(i, { score: +e.target.value })} />
            </label>
          )}
          <button className="icon-btn" aria-label="Remove condition" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <div className="btn-row">
        <button className="btn ghost" onClick={() => setRows([...rows, { kind: "structure", structure: "village", within: 500, nearOn: false, nearBiome: Biome.plains, nearWithin: 96 }])}>+ Structure</button>
        <button className="btn ghost" onClick={() => setRows([...rows, { kind: "biome", biome: Biome.cherry_grove, within: 1000 }])}>+ Biome</button>
        <button className="btn ghost" onClick={() => setRows([...rows, { kind: "minScore", score: 70 }])}>+ Score</button>
      </div>
      <button className="btn primary block" disabled={!rows.length || job?.status === "running"} onClick={run}>
        {isPro ? "Search seeds" : "Unlock advanced search"}
      </button>
      {error && <p className="error">{error}</p>}
      {job && (
        <div className="card">
          <div className="row">
            <b>{job.status === "done" ? "Done" : job.status === "failed" ? "Failed" : "Searching…"}</b>
            <span className="muted">{job.scanned.toLocaleString()} / {job.maxSeeds.toLocaleString()} seeds</span>
          </div>
          <div className="bar"><span style={{ width: `${(job.scanned / job.maxSeeds) * 100}%` }} /></div>
          <ul className="results">
            {job.matches.map((m) => (
              <li key={m.seed}>
                <button className="link" onClick={() => onOpenSeed(m.seed)}>{m.seed}</button>
                <span className="muted small">{m.evidence.map((e) => e.note).join(" · ")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
