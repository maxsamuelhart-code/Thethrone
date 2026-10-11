import { useEffect, useState } from "react";
import { STRUCTURE_BY_KEY } from "@seedscout/engine";
import type { LootResponse } from "@seedscout/shared";
import type { MapMarker } from "../map/MapView";
import type { World } from "../engine/protocol";
import { api, ApiError } from "../api";
import { pool } from "../engine/pool";

interface Props {
  world: World;
  marker: MapMarker;
  isPro: boolean;
  onUpgrade(): void;
  onAuthError(e: ApiError): void;
}

const label = (m: MapMarker) => (m.key === "spawn" ? "World spawn" : m.key === "stronghold" ? "Stronghold" : STRUCTURE_BY_KEY[m.key].label);

export function DetailPanel({ world, marker, isPro, onUpgrade, onAuthError }: Props) {
  const [biome, setBiome] = useState("");
  const [loot, setLoot] = useState<LootResponse | "loading" | null>(null);
  const [copied, setCopied] = useState(false);
  const info = marker.key !== "spawn" && marker.key !== "stronghold" ? STRUCTURE_BY_KEY[marker.key] : null;
  const tp = `/tp @s ${marker.x} ~ ${marker.z}`;

  useEffect(() => {
    setLoot(null);
    pool.request("biomeAt", { world, x: marker.x, z: marker.z }).then(setBiome).catch(() => {});
  }, [world, marker]);

  async function predict() {
    if (!isPro) return onUpgrade();
    setLoot("loading");
    try {
      setLoot(await api<LootResponse>("/loot", { body: { version: world.version, seed: world.seed.toString(), structure: info!.key, x: marker.x, z: marker.z } }));
    } catch (e) {
      setLoot(null);
      if (e instanceof ApiError) onAuthError(e);
    }
  }

  return (
    <div className="panel">
      <h2>{info?.icon} {label(marker)}</h2>
      <p className="coords">X {marker.x} · Z {marker.z} <span className="muted">· {biome.replace(/_/g, " ")}</span></p>
      <div className="btn-row">
        <button className="btn" onClick={() => navigator.clipboard?.writeText(tp).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}>
          {copied ? "Copied!" : "Copy /tp"}
        </button>
      </div>

      {info?.hasLoot && (
        <div className="card">
          <div className="row">
            <h3>Chest loot</h3>
            {!isPro && <span className="pro-badge">PRO</span>}
          </div>
          {loot === null && (
            <button className="btn primary" onClick={predict}>{isPro ? "Predict chest contents" : "Unlock loot prediction"}</button>
          )}
          {loot === "loading" && <p className="muted">Rolling loot tables…</p>}
          {loot && loot !== "loading" && "unavailable" in loot && <p className="muted">Not available yet: {loot.unavailable}</p>}
          {loot && loot !== "loading" && "chests" in loot &&
            loot.chests.map((c, i) => (
              <div key={i} className="chest">
                <div className="muted small">
                  {c.table.replace("chests/", "")}
                  {!c.verified && " · experimental"}
                  {!c.exact && " · partially predicted"}
                </div>
                <ul className="items">
                  {c.items.map((it, j) => (
                    <li key={j}>
                      <span>{it.item.replace(/_/g, " ")}</span>
                      <b>×{it.count}</b>
                      {it.unpredicted && <em className="muted small"> ({it.unpredicted.join(", ")})</em>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
