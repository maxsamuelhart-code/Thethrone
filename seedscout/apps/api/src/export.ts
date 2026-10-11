import { STRUCTURES, scoreSeed, type Engine, type McVersion } from "@seedscout/engine";

export interface ExportRow {
  type: string;
  label: string;
  x: number;
  z: number;
  distance: number;
}

/** Every structure within `radius` blocks of spawn, nearest first, plus the seed's score. */
export function buildExport(engine: Engine, seed: bigint, version: McVersion, radius: number) {
  const score = scoreSeed(engine, { seed, version });
  const { spawn } = score;
  const rows: ExportRow[] = [];
  for (const s of STRUCTURES) {
    for (const p of engine.structuresInBox(s.type, spawn.x - radius, spawn.z - radius, spawn.x + radius, spawn.z + radius, 2048)) {
      const distance = Math.round(Math.hypot(p.x - spawn.x, p.z - spawn.z));
      if (distance <= radius) rows.push({ type: s.key, label: s.label, x: p.x, z: p.z, distance });
    }
  }
  engine.strongholds(3).forEach((p) =>
    rows.push({ type: "stronghold", label: "Stronghold", ...p, distance: Math.round(Math.hypot(p.x - spawn.x, p.z - spawn.z)) }),
  );
  rows.sort((a, b) => a.distance - b.distance);
  return { seed: seed.toString(), version, spawn, score: { score: score.score, grade: score.grade, verdict: score.verdict }, structures: rows };
}

export function toCsv(rows: ExportRow[]): string {
  return ["type,label,x,z,distance", ...rows.map((r) => `${r.type},${r.label},${r.x},${r.z},${r.distance}`)].join("\n");
}
