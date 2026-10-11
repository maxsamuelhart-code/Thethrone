/**
 * Advanced seed search. A query is a list of clauses that must all hold; the
 * evaluator runs the cheapest checks first and bails on the first failure, so
 * most candidate seeds are rejected after a handful of structure lookups.
 *
 * Example: "a village within 500 blocks of spawn that touches a mushroom biome"
 *   { clauses: [{ kind: "structure", structure: "village", within: 500,
 *                 near: { biome: 14, within: 96 } }] }
 */
import type { Engine, Pos, WorldParams } from "./engine";
import { STRUCTURE_BY_KEY, type StructureKey } from "./structures";
import { scoreSeed, type ProfileKey } from "./score";
import type { McVersion } from "./versions";

export type Clause =
  | {
      kind: "structure";
      structure: StructureKey;
      /** Max distance from spawn in blocks. */
      within: number;
      /** Optionally require a biome within `within` blocks of the structure itself. */
      near?: { biome: number; within: number };
      /** Require at least this many matching structures (default 1). */
      count?: number;
    }
  | { kind: "biome"; biome: number; within: number }
  | { kind: "spawnBiome"; biomes: number[] }
  | { kind: "minScore"; score: number; profile?: ProfileKey };

export interface SearchQuery {
  version: McVersion;
  clauses: Clause[];
}

export interface SearchMatch {
  seed: string;
  spawn: Pos;
  /** Supporting evidence per clause, e.g. where the matching village is. */
  evidence: Array<{ clause: number; at?: Pos; note: string }>;
}

// Lower runs first. Structure positions are cheap; biome scans and scoring are not.
const COST: Record<Clause["kind"], number> = { spawnBiome: 0, structure: 1, biome: 2, minScore: 3 };

/**
 * Nearest sample of `biome` within `radius` blocks of `p`. Cost is (2r/scale)^2
 * samples, so the default scale grows with the radius: patches smaller than one
 * sample can be missed, which is acceptable for search (a miss only skips a seed).
 */
export function biomeNear(engine: Engine, p: Pos, biome: number, radius: number, scale?: 4 | 16 | 64): Pos | null {
  scale ??= radius >= 1024 ? 64 : radius >= 48 ? 16 : 4;
  const cells = Math.ceil((radius * 2) / scale) + 1;
  const x0 = Math.floor((p.x - radius) / scale), z0 = Math.floor((p.z - radius) / scale);
  const ids = engine.genBiomes(scale, x0, z0, cells, cells);
  let best: Pos | null = null, bestD = Infinity;
  for (let i = 0; i < ids.length; i++) {
    if (ids[i] !== biome) continue;
    const x = (x0 + (i % cells)) * scale + scale / 2, z = (z0 + Math.floor(i / cells)) * scale + scale / 2;
    const d = Math.hypot(x - p.x, z - p.z);
    if (d <= radius && d < bestD) (best = { x, z }), (bestD = d);
  }
  return best;
}

/** Evaluates one seed. Returns null on the first failed clause. */
export function matchSeed(engine: Engine, query: SearchQuery, seed: bigint): SearchMatch | null {
  const world: WorldParams = { seed, version: query.version };
  engine.setWorld(world);
  const spawn = engine.spawn(false);
  const evidence: SearchMatch["evidence"] = [];
  const order = query.clauses.map((c, i) => [c, i] as const).sort((a, b) => COST[a[0].kind] - COST[b[0].kind]);

  for (const [c, i] of order) {
    switch (c.kind) {
      case "spawnBiome": {
        const b = engine.biomeAt(spawn.x, spawn.z);
        if (!c.biomes.includes(b)) return null;
        evidence.push({ clause: i, at: spawn, note: `spawn in ${engine.biomeName(b)}` });
        break;
      }
      case "structure": {
        const info = STRUCTURE_BY_KEY[c.structure];
        const r = c.within;
        // Coarse prefilter: if the biome isn't anywhere in reach at 1:64, no structure can be next to it.
        if (c.near && !biomeNear(engine, spawn, c.near.biome, r + c.near.within + 64, 64)) return null;
        const hits = engine
          .structuresInBox(info.type, spawn.x - r, spawn.z - r, spawn.x + r, spawn.z + r)
          .filter((p) => Math.hypot(p.x - spawn.x, p.z - spawn.z) <= r);
        const ok = c.near ? hits.filter((p) => biomeNear(engine, p, c.near!.biome, c.near!.within)) : hits;
        if (ok.length < (c.count ?? 1)) return null;
        for (const p of ok.slice(0, c.count ?? 1)) evidence.push({ clause: i, at: p, note: info.label });
        break;
      }
      case "biome": {
        const at = biomeNear(engine, spawn, c.biome, c.within);
        if (!at) return null;
        evidence.push({ clause: i, at, note: engine.biomeName(c.biome) });
        break;
      }
      case "minScore": {
        const s = scoreSeed(engine, world, c.profile);
        if (s.score < c.score) return null;
        evidence.push({ clause: i, note: `score ${s.score} (${s.grade})` });
        break;
      }
    }
  }
  return { seed: seed.toString(), spawn, evidence };
}

/** Deterministic seed stream so a job can resume from a cursor: SplitMix64 over (start + i). */
export function candidateSeed(start: bigint, i: number): bigint {
  let z = BigInt.asUintN(64, start + BigInt(i) * 0x9e3779b97f4a7c15n);
  z = BigInt.asUintN(64, (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n);
  z = BigInt.asUintN(64, (z ^ (z >> 27n)) * 0x94d049bb133111ebn);
  return BigInt.asIntN(64, z ^ (z >> 31n));
}

export interface SearchBatch {
  matches: SearchMatch[];
  scanned: number;
  nextCursor: number;
}

/** Scans candidates [cursor, cursor+limit), stopping early at `maxMatches` or `deadline` (ms timestamp). */
export function searchBatch(
  engine: Engine,
  query: SearchQuery,
  start: bigint,
  cursor: number,
  limit: number,
  { maxMatches = Infinity, deadline = Infinity }: { maxMatches?: number; deadline?: number } = {},
): SearchBatch {
  const matches: SearchMatch[] = [];
  let i = cursor;
  for (; i < cursor + limit; i++) {
    if ((i & 63) === 0 && Date.now() > deadline) break;
    const m = matchSeed(engine, query, candidateSeed(start, i));
    if (m && matches.push(m) >= maxMatches) {
      i++;
      break;
    }
  }
  return { matches, scanned: i - cursor, nextCursor: i };
}
