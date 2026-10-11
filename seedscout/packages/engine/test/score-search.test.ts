import { beforeAll, describe, expect, it } from "vitest";
import { Biome, type Engine, matchSeed, scoreSeed, searchBatch } from "../src";
import { loadEngine } from "./helpers";

let engine: Engine;
beforeAll(async () => {
  engine = await loadEngine();
});

describe("scoreSeed", () => {
  it("produces a bounded score with a breakdown", () => {
    const s = scoreSeed(engine, { seed: 12345n, version: "1.21" });
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(s.score).toBeLessThanOrEqual(100);
    expect(s.breakdown.length).toBeGreaterThan(5);
    expect(["S", "A", "B", "C", "D"]).toContain(s.grade);
  });
});

describe("search", () => {
  it("finds a seed with a village near spawn and verifies the match", () => {
    const query = { version: "1.21" as const, clauses: [{ kind: "structure" as const, structure: "village" as const, within: 400 }] };
    const batch = searchBatch(engine, query, 1n, 0, 200);
    expect(batch.scanned).toBe(200);
    expect(batch.matches.length).toBeGreaterThan(0);
    const m = batch.matches[0]!;
    expect(matchSeed(engine, query, BigInt(m.seed))).not.toBeNull();
  });

  it("rejects impossible queries", () => {
    const query = {
      version: "1.21" as const,
      clauses: [{ kind: "structure" as const, structure: "village" as const, within: 64, near: { biome: Biome.mushroom_fields, within: 16 } }],
    };
    expect(searchBatch(engine, query, 1n, 0, 50).matches).toEqual([]);
  });
});

describe("searchBatch", () => {
  it("stops at maxMatches and reports a resumable cursor", () => {
    const query = { version: "1.21" as const, clauses: [{ kind: "structure" as const, structure: "village" as const, within: 1500 }] };
    const b = searchBatch(engine, query, 1n, 0, 500, { maxMatches: 2 });
    expect(b.matches.length).toBe(2);
    expect(b.nextCursor).toBe(b.scanned);
    expect(b.scanned).toBeLessThan(500);
  });
});
