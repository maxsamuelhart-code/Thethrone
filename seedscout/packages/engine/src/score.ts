/**
 * Seed evaluation: turns raw worldgen facts around spawn into a 0-100 score,
 * a letter grade and human-readable highlights. Weights live in PROFILES so the
 * product can offer "survival", "speedrun", etc. without code changes.
 */
import type { Engine, Pos, WorldParams } from "./engine";
import { STRUCTURE_BY_KEY, type StructureKey } from "./structures";
import { RARE_BIOMES } from "./biomes";

export type ProfileKey = "survival" | "speedrun";

interface StructureWeight {
  key: StructureKey;
  points: number;
  /** Full points at or under `ideal` blocks from spawn, falling to 0 at `max`. */
  ideal: number;
  max: number;
}

interface Profile {
  label: string;
  structures: StructureWeight[];
  rareBiomePoints: number;
  diversityPoints: number;
  landPoints: number;
}

export const PROFILES: Record<ProfileKey, Profile> = {
  survival: {
    label: "Survival",
    structures: [
      { key: "village", points: 20, ideal: 200, max: 1000 },
      { key: "ruined_portal", points: 6, ideal: 150, max: 800 },
      { key: "desert_pyramid", points: 5, ideal: 300, max: 1500 },
      { key: "shipwreck", points: 4, ideal: 300, max: 1200 },
      { key: "buried_treasure", points: 4, ideal: 300, max: 1200 },
      { key: "outpost", points: 3, ideal: 300, max: 1500 },
      { key: "trial_chambers", points: 6, ideal: 400, max: 2000 },
      { key: "ancient_city", points: 4, ideal: 600, max: 2500 },
      { key: "mansion", points: 3, ideal: 2000, max: 8000 },
    ],
    rareBiomePoints: 20,
    diversityPoints: 15,
    landPoints: 10,
  },
  speedrun: {
    label: "Speedrun",
    structures: [
      { key: "ruined_portal", points: 25, ideal: 50, max: 400 },
      { key: "village", points: 15, ideal: 50, max: 400 },
      { key: "shipwreck", points: 10, ideal: 50, max: 400 },
      { key: "buried_treasure", points: 10, ideal: 50, max: 400 },
      { key: "desert_pyramid", points: 10, ideal: 50, max: 500 },
    ],
    rareBiomePoints: 0,
    diversityPoints: 5,
    landPoints: 25,
  },
};

export interface ScoreItem {
  label: string;
  points: number;
  max: number;
  detail: string;
}

export interface SeedScore {
  score: number; // 0-100
  grade: "S" | "A" | "B" | "C" | "D";
  verdict: string;
  profile: ProfileKey;
  spawn: Pos;
  highlights: string[];
  breakdown: ScoreItem[];
  nearest: Partial<Record<StructureKey, (Pos & { dist: number }) | null>>;
}

const falloff = (d: number, ideal: number, max: number) => (d <= ideal ? 1 : d >= max ? 0 : 1 - (d - ideal) / (max - ideal));

/** Biome statistics in a square around a point, sampled at 1:16. */
export function biomeStats(engine: Engine, center: Pos, radius: number) {
  const cells = Math.ceil((radius * 2) / 16);
  const ids = engine.genBiomes(16, Math.floor((center.x - radius) / 16), Math.floor((center.z - radius) / 16), cells, cells);
  const counts = new Map<number, number>();
  let ocean = 0;
  for (const id of ids) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
    if (engine.isOceanic(id)) ocean++;
  }
  return { counts, unique: counts.size, oceanFraction: ocean / ids.length };
}

export function scoreSeed(engine: Engine, world: WorldParams, profileKey: ProfileKey = "survival"): SeedScore {
  const profile = PROFILES[profileKey];
  engine.setWorld(world);
  const spawn = engine.spawn(false);
  const breakdown: ScoreItem[] = [];
  const highlights: string[] = [];
  const nearest: SeedScore["nearest"] = {};

  for (const w of profile.structures) {
    const info = STRUCTURE_BY_KEY[w.key];
    const hit = engine.nearestStructure(info.type, spawn, w.max);
    nearest[w.key] = hit;
    const pts = hit ? w.points * falloff(hit.dist, w.ideal, w.max) : 0;
    breakdown.push({
      label: info.label,
      points: pts,
      max: w.points,
      detail: hit ? `${Math.round(hit.dist)} blocks from spawn` : `none within ${w.max} blocks`,
    });
    if (hit && hit.dist <= w.ideal) highlights.push(`${info.label} ${Math.round(hit.dist)} blocks from spawn`);
  }

  const stats = biomeStats(engine, spawn, 512);
  const rare = RARE_BIOMES.filter((id) => stats.counts.has(id));
  if (profile.rareBiomePoints) {
    const pts = Math.min(1, rare.length / 2) * profile.rareBiomePoints;
    breakdown.push({
      label: "Rare biomes",
      points: pts,
      max: profile.rareBiomePoints,
      detail: rare.length ? rare.map((id) => engine.biomeName(id)).join(", ") : "none within 512 blocks",
    });
    for (const id of rare) highlights.push(`${engine.biomeName(id).replace(/_/g, " ")} near spawn`);
  }
  const diversity = Math.min(1, Math.max(0, (stats.unique - 3) / 9));
  breakdown.push({
    label: "Biome variety",
    points: diversity * profile.diversityPoints,
    max: profile.diversityPoints,
    detail: `${stats.unique} biomes within 512 blocks`,
  });
  const land = 1 - Math.min(1, Math.max(0, (stats.oceanFraction - 0.2) / 0.5));
  breakdown.push({
    label: "Usable land",
    points: land * profile.landPoints,
    max: profile.landPoints,
    detail: `${Math.round((1 - stats.oceanFraction) * 100)}% land near spawn`,
  });

  const max = breakdown.reduce((s, b) => s + b.max, 0);
  const score = Math.round((breakdown.reduce((s, b) => s + b.points, 0) / max) * 100);
  const grade = score >= 80 ? "S" : score >= 65 ? "A" : score >= 50 ? "B" : score >= 35 ? "C" : "D";
  const verdict = {
    S: "Exceptional seed. Rare finds right next to spawn.",
    A: "Great seed with plenty close to spawn.",
    B: "Solid seed. Some travel needed.",
    C: "Average seed. Key structures are a trek.",
    D: "Sparse start. Better for a challenge run.",
  }[grade];

  return { score, grade, verdict, profile: profileKey, spawn, highlights: highlights.slice(0, 5), breakdown, nearest };
}
