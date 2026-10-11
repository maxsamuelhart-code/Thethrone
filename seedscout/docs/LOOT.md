# Loot prediction: how it works and how we verify it

Predicting a chest is two independent problems.

## 1. Rolling a loot table (done)

`packages/engine/src/loot/roll.ts` rolls vanilla loot-table JSON with a loot seed,
consuming `java.util.Random` in the same order as `LootTable.getRandomItems`:
pool rolls, weighted entry picks (single-entry pools consume nothing), conditions,
and item functions applied innermost-first as each item is created.

Modelled: `set_count`, `set_damage`, uniform/constant/binomial numbers,
`random_chance`, nested `loot_table` entries, and the RNG-free functions.

Not modelled yet: `enchant_randomly`, `enchant_with_levels`, `set_stew_effect`,
`set_instrument`, `set_ominous_bottle_amplifier`. When one of these runs, the
result is flagged `exact: false`, because every item after it may be out of sync.
Enchantment RNG is the next thing to port.

Tables are not hand-typed. `node packages/engine/scripts/extract-loot-tables.mjs 1.21=1.21.4`
pulls them out of Mojang's server jar into `src/loot/tables.generated.ts`.
Check your distribution rights before you commit that file.

## 2. Deriving the chest's loot seed (in progress)

In 1.18+, `ChunkGenerator.applyBiomeDecoration` seeds a Xoroshiro RNG per chunk
(`setDecorationSeed`), then per structure (`setFeatureSeed(deco, index, step)`).
The structure's pieces draw from that RNG while placing blocks. A chest's loot
seed is the RNG's next `nextLong()` when the chest is placed.

So each structure, in each version, needs a **recipe** (`loot/predict.ts`):

| field          | meaning |
|----------------|---------|
| `step`         | generation step the structure decorates in |
| `index`        | position of the structure in that step, in registry order |
| `callsBefore`  | RNG draws made by piece placement before this chest |
| `chunkOffset`  | which chunk holds the chest relative to the structure start |

Recipes start `verified: false`, and the API refuses to serve them unless
`LOOT_ALLOW_UNVERIFIED=1` (on by default in dev only). The Xoroshiro port in
`random.ts` has only been tested for internal consistency so far. The harness
below is what proves it bit-exact.

## Ground-truth harness (the next build step)

1. Run a headless Fabric server for the target version, with a small mod that, on
   `RandomizableContainer.setLootTable`, logs `(worldSeed, pos, table, lootSeed)`.
2. Generate a few hundred chunks around structures for ~50 seeds.
3. A test fixture asserts that `chestLootSeed()` matches every logged loot seed and that
   `rollLootTable()` matches the items the server rolled.
4. Flip `verified: true` per structure/version only when the fixture passes.

Priority order is set by what players search for: buried treasure, desert pyramid,
shipwreck, ruined portal, village chests, then trial chambers and ancient cities.
Multi-piece structures (villages, ancient cities) have piece-dependent call counts.
They need jigsaw piece generation ported, not a constant `callsBefore`.
