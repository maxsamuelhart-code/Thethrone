import { describe, expect, it } from "vitest";
import { JavaRandom, Xoroshiro } from "../src/random";

describe("JavaRandom matches java.util.Random", () => {
  it("nextInt / nextLong / nextDouble for seed 0", () => {
    const r = new JavaRandom(0n);
    expect(r.nextInt()).toBe(-1155484576);
    expect(r.nextInt()).toBe(-723955400);
    expect(new JavaRandom(0n).nextLong()).toBe(-4962768465676381896n);
    expect(new JavaRandom(0n).nextDouble()).toBeCloseTo(0.730967787376657, 15);
  });

  it("bounded nextInt stays in range", () => {
    const r = new JavaRandom(12345n);
    for (let i = 0; i < 1000; i++) {
      const v = r.nextInt(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
  });
});

describe("Xoroshiro", () => {
  // Self-consistency only. Bit-exactness against the game is established by the
  // ground-truth harness in docs/LOOT.md, not by this test.
  it("is deterministic and reseedable", () => {
    const a = new Xoroshiro(42n), b = new Xoroshiro(42n);
    const xs = Array.from({ length: 5 }, () => a.nextLong());
    expect(Array.from({ length: 5 }, () => b.nextLong())).toEqual(xs);
    a.setSeed(42n);
    expect(a.nextLong()).toBe(xs[0]);
    for (let i = 0; i < 100; i++) expect(a.nextInt(10)).toBeLessThan(10);
  });
});
