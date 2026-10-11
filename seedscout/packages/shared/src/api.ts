/** Request/response contracts shared by apps/web and apps/api. */
import { z } from "zod";
import { STRUCTURES, VERSION_LIST, type McVersion, type SearchMatch, type ChestPrediction, type StructureKey } from "@seedscout/engine";
import type { Feature, Plan } from "./plans";

const version = z.enum(VERSION_LIST as [McVersion, ...McVersion[]]);
const structureKey = z.enum(STRUCTURES.map((s) => s.key) as [StructureKey, ...StructureKey[]]);
/** Seeds travel as decimal strings: JSON numbers can't hold 64-bit integers. */
const seed = z.string().regex(/^-?\d{1,20}$/);
const blocks = (max: number) => z.number().int().min(0).max(max);

export const ClauseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("structure"),
    structure: structureKey,
    within: blocks(10_000),
    near: z.object({ biome: z.number().int().min(0).max(255), within: blocks(512) }).optional(),
    count: z.number().int().min(1).max(10).optional(),
  }),
  z.object({ kind: z.literal("biome"), biome: z.number().int().min(0).max(255), within: blocks(5_000) }),
  z.object({ kind: z.literal("spawnBiome"), biomes: z.array(z.number().int().min(0).max(255)).min(1).max(20) }),
  z.object({ kind: z.literal("minScore"), score: z.number().min(0).max(100), profile: z.enum(["survival", "speedrun"]).optional() }),
]);

export const SearchRequestSchema = z.object({
  version,
  clauses: z.array(ClauseSchema).min(1).max(8),
  /** Stop after this many matches. */
  wantMatches: z.number().int().min(1).max(100).default(10),
  maxSeeds: z.number().int().min(1000).max(2_000_000).default(200_000),
});
export type SearchRequest = z.infer<typeof SearchRequestSchema>;

export const LootRequestSchema = z.object({ version, seed, structure: structureKey, x: z.number().int(), z: z.number().int() });
export type LootRequest = z.infer<typeof LootRequestSchema>;

export const SaveSeedSchema = z.object({
  version,
  seed,
  label: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type SaveSeedRequest = z.infer<typeof SaveSeedSchema>;

export const LoginSchema = z.object({ email: z.email().max(254) });
export const CheckoutSchema = z.object({ interval: z.enum(["month", "year"]) });

export interface Me {
  user: { id: string; email: string } | null;
  plan: Plan;
  features: Feature[];
  subscription: { status: string; currentPeriodEnd: number; cancelAtPeriodEnd: boolean } | null;
}

export interface SavedSeed {
  id: string;
  seed: string;
  version: McVersion;
  label: string | null;
  notes: string | null;
  createdAt: number;
}

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface SearchJob {
  id: string;
  status: JobStatus;
  scanned: number;
  maxSeeds: number;
  matches: SearchMatch[];
  error: string | null;
}

export type LootResponse = { chests: ChestPrediction[] } | { unavailable: string };
