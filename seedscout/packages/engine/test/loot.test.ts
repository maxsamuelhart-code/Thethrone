import { describe, expect, it } from "vitest";
import { JavaRandom, rollLootTable, type LootTable } from "../src";

// A hand-written fixture in vanilla format. Not a real game table.
const table: LootTable = {
  pools: [
    { rolls: 1, entries: [{ type: "minecraft:item", name: "minecraft:heart_of_the_sea" }] },
    {
      rolls: { type: "minecraft:uniform", min: 2, max: 4 },
      entries: [
        { type: "minecraft:item", name: "minecraft:iron_ingot", weight: 3, functions: [{ function: "minecraft:set_count", count: { min: 1, max: 4 } }] },
        { type: "minecraft:item", name: "minecraft:diamond", weight: 1 },
        { type: "minecraft:empty", weight: 1 },
      ],
    },
  ],
};

describe("rollLootTable", () => {
  it("is deterministic per seed", () => {
    expect(rollLootTable(table, 99n)).toEqual(rollLootTable(table, 99n));
  });

  it("consumes the RNG exactly as LootTable.getRandomItems", () => {
    // Replay the expected call sequence by hand with java.util.Random.
    const r = new JavaRandom(7n);
    const expected: Record<string, number> = { heart_of_the_sea: 1 }; // single entry: no RNG
    const rolls = r.nextInt(3) + 2;
    for (let i = 0; i < rolls; i++) {
      const pick = r.nextInt(5);
      if (pick < 3) expected.iron_ingot = (expected.iron_ingot ?? 0) + r.nextInt(4) + 1;
      else if (pick < 4) expected.diamond = (expected.diamond ?? 0) + 1;
    }
    const got = Object.fromEntries(rollLootTable(table, 7n).items.map((s) => [s.item, s.count]));
    expect(got).toEqual(expected);
  });

  it("flags un-modelled RNG consumers as inexact", () => {
    const t: LootTable = { pools: [{ rolls: 1, entries: [{ type: "item", name: "book", functions: [{ function: "enchant_randomly" }] }] }] };
    const res = rollLootTable(t, 1n);
    expect(res.exact).toBe(false);
    expect(res.items[0]!.unpredicted).toEqual(["enchant_randomly"]);
  });
});
