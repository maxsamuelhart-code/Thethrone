/**
 * Chest loot prediction = (1) derive the chest's loot seed from the world seed,
 * then (2) roll the vanilla loot table with it (roll.ts).
 *
 * Step (1) reproduces ChunkGenerator.applyBiomeDecoration (1.18+): the chunk's
 * decoration seed, then the feature seed for the structure's (step, index), then
 * however many RNG calls the structure's pieces make before the chest calls
 * random.nextLong() for its loot seed. Those per-structure, per-version numbers
 * are the hard part. Every recipe starts `verified: false` and only flips once it
 * matches chests dumped from a real server (see docs/LOOT.md).
 */
import type { StructureKey } from "../structures";
import { decorationSeed, featureSeed, Xoroshiro } from "../random";
import { rollLootTable, type LootResult, type LootTable } from "./roll";
import { LOOT_TABLES } from "./tables.generated";
import type { McVersion } from "../versions";

/** GenerationStep.Decoration ordinals. */
export enum DecorationStep {
  RawGeneration = 0,
  Lakes = 1,
  LocalModifications = 2,
  UndergroundStructures = 3,
  SurfaceStructures = 4,
  Strongholds = 5,
}

export interface ChestRecipe {
  structure: StructureKey;
  /** Loot table path, e.g. "chests/buried_treasure". */
  table: string;
  step: DecorationStep;
  /** Index of the structure within its step, in the version's structure registry order. */
  index: number;
  /** Xoroshiro nextLong()-equivalents consumed by piece placement before this chest's loot seed. */
  callsBefore: number;
  /** Chest's chunk relative to the structure's start chunk. */
  chunkOffset: { x: number; z: number };
  verified: boolean;
}

/**
 * Candidate recipes. Unverified values are starting points for the ground-truth
 * harness, not facts; the API refuses to serve them unless explicitly allowed.
 */
export const RECIPES: Partial<Record<McVersion, ChestRecipe[]>> = {
  "1.21": [
    {
      structure: "buried_treasure",
      table: "chests/buried_treasure",
      step: DecorationStep.UndergroundStructures,
      index: 1,
      callsBefore: 0,
      chunkOffset: { x: 0, z: 0 },
      verified: false,
    },
  ],
};

export function chestLootSeed(worldSeed: bigint, chunkX: number, chunkZ: number, r: ChestRecipe): bigint {
  const rng = new Xoroshiro(0n);
  const deco = decorationSeed(rng, worldSeed, chunkX * 16, chunkZ * 16);
  featureSeed(rng, deco, r.index, r.step);
  for (let i = 0; i < r.callsBefore; i++) rng.nextLong();
  return rng.nextLong();
}

export interface ChestPrediction extends LootResult {
  table: string;
  lootSeed: string;
  verified: boolean;
}

export class LootUnavailableError extends Error {}

export function predictStructureLoot(
  version: McVersion,
  worldSeed: bigint,
  structure: StructureKey,
  blockX: number,
  blockZ: number,
  opts: { allowUnverified?: boolean; tables?: Record<string, LootTable> } = {},
): ChestPrediction[] {
  const tables = opts.tables ?? LOOT_TABLES[version];
  const recipes = (RECIPES[version] ?? []).filter((r) => r.structure === structure);
  if (!recipes.length) throw new LootUnavailableError(`no loot recipe for ${structure} in ${version}`);
  if (!tables) throw new LootUnavailableError(`loot tables for ${version} not extracted (run scripts/extract-loot-tables.mjs)`);

  const usable = recipes.filter((r) => r.verified || opts.allowUnverified);
  if (!usable.length) throw new LootUnavailableError(`loot for ${structure} in ${version} is not verified yet`);

  const cx = Math.floor(blockX / 16), cz = Math.floor(blockZ / 16);
  return usable.map((r) => {
    const table = tables[r.table];
    if (!table) throw new LootUnavailableError(`missing loot table ${r.table}`);
    const seed = chestLootSeed(worldSeed, cx + r.chunkOffset.x, cz + r.chunkOffset.z, r);
    return {
      ...rollLootTable(table, seed, (name) => tables[name]),
      table: r.table,
      lootSeed: seed.toString(),
      verified: r.verified,
    };
  });
}
