import { beforeAll, describe, expect, it } from "vitest";
import { type Engine, parseSeed, StructureType } from "../src";
import { loadEngine } from "./helpers";

// Reference values produced by the same cubiomes commit compiled natively
// (gcc, x86-64), so these tests prove the WASM build is bit-identical.
const SEED = -4172144997902289642n;

let engine: Engine;
beforeAll(async () => {
  engine = await loadEngine();
});

describe("Engine (cubiomes WASM)", () => {
  it("matches native biome output", () => {
    engine.setWorld({ seed: SEED, version: "1.21" });
    let h = 0n;
    for (let i = 0; i < 200; i++) {
      const id = engine.genBiomes(4, i * 37 - 3000, i * 53 - 4000, 1, 1, 64)[0]!;
      h = BigInt.asIntN(64, h * 31n + BigInt(id));
    }
    expect(h).toBe(-1291636012436449996n);
  });

  it("matches native spawn", () => {
    engine.setWorld({ seed: SEED, version: "1.21" });
    expect(engine.spawn(true)).toEqual({ x: -448, z: -432 });
  });

  it("finds structures and renders tiles", () => {
    engine.setWorld({ seed: SEED, version: "1.21" });
    const villages = engine.structuresInBox(StructureType.Village, -3000, -3000, 3000, 3000);
    expect(villages.length).toBeGreaterThan(5);
    const rgba = engine.biomeRgba(4, 0, 0, 64, 64);
    expect(rgba.length).toBe(64 * 64 * 4);
    expect(engine.biomeName(14)).toBe("mushroom_fields");
  });

  it("parses seeds like Minecraft", () => {
    expect(parseSeed("12345")).toBe(12345n);
    expect(parseSeed("a")).toBe(97n); // "a".hashCode()
  });
});
