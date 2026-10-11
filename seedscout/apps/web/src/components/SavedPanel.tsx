import { useEffect, useState } from "react";
import type { SavedSeed } from "@seedscout/shared";
import type { World } from "../engine/protocol";
import { api, ApiError } from "../api";

interface Props {
  world: World;
  isPro: boolean;
  onUpgrade(): void;
  onAuthError(e: ApiError): void;
  onOpen(s: SavedSeed): void;
}

export function SavedPanel({ world, isPro, onUpgrade, onAuthError, onOpen }: Props) {
  const [items, setItems] = useState<SavedSeed[]>([]);
  const [label, setLabel] = useState("");

  const load = () => isPro && api<SavedSeed[]>("/saved").then(setItems).catch((e) => e instanceof ApiError && onAuthError(e));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPro]);

  async function save() {
    if (!isPro) return onUpgrade();
    await api("/saved", { body: { seed: world.seed.toString(), version: world.version, label: label || undefined } });
    setLabel("");
    load();
  }

  async function exportSeed(format: "json" | "csv") {
    if (!isPro) return onUpgrade();
    window.location.href = `/api/export?seed=${world.seed}&version=${world.version}&format=${format}`;
  }

  return (
    <div className="panel">
      <div className="save-row">
        <input placeholder="Label (optional)" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />
        <button className="btn primary" onClick={save}>★ Save seed</button>
      </div>
      <div className="btn-row">
        <button className="btn ghost" onClick={() => exportSeed("json")}>Export JSON</button>
        <button className="btn ghost" onClick={() => exportSeed("csv")}>Export CSV</button>
        {!isPro && <span className="pro-badge">PRO</span>}
      </div>
      {isPro && !items.length && <p className="muted">No saved seeds yet.</p>}
      <ul className="results">
        {items.map((s) => (
          <li key={s.id}>
            <button className="link" onClick={() => onOpen(s)}>{s.label || s.seed}</button>
            <span className="muted small">{s.version}{s.label && ` · ${s.seed}`}</span>
            <button
              className="icon-btn"
              aria-label="Delete"
              onClick={() => api(`/saved/${s.id}`, { method: "DELETE" }).then(load)}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
