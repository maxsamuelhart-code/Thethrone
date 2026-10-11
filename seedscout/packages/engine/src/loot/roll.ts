/**
 * Rolls a vanilla loot table (the JSON format shipped in the game jar under
 * data/minecraft/loot_table/chests/) with a given loot seed, consuming the RNG
 * exactly as LootTable.getRandomItems does.
 *
 * Anything that consumes randomness and is not modelled here (enchantments,
 * suspicious stew, goat horns...) marks the result `exact: false`, because every
 * item rolled after it may be out of sync with the game.
 */
import { JavaRandom, type RandomSource } from "../random";

export interface NumberProvider {
  type?: string;
  value?: number;
  min?: number | NumberProvider;
  max?: number | NumberProvider;
  n?: number | NumberProvider;
  p?: number | NumberProvider;
}
type NumberLike = number | NumberProvider;

export interface LootCondition {
  condition: string;
  chance?: number;
}

export interface LootFunction {
  function: string;
  count?: NumberLike;
  damage?: NumberLike;
  add?: boolean;
  conditions?: LootCondition[];
  [k: string]: unknown;
}

export interface LootEntry {
  type: string; // minecraft:item | minecraft:empty | minecraft:loot_table | ...
  name?: string;
  weight?: number;
  quality?: number;
  functions?: LootFunction[];
  conditions?: LootCondition[];
}

export interface LootPool {
  rolls: NumberLike;
  bonus_rolls?: NumberLike;
  entries: LootEntry[];
  functions?: LootFunction[];
  conditions?: LootCondition[];
}

export interface LootTable {
  pools?: LootPool[];
  functions?: LootFunction[];
}

export interface ItemStack {
  item: string;
  count: number;
  damage?: number;
  /** Enchantments etc. we know were applied but can't yet predict precisely. */
  unpredicted?: string[];
}

export interface LootResult {
  items: ItemStack[];
  /** False once any un-modelled RNG consumer ran: later items may differ from the game. */
  exact: boolean;
  warnings: string[];
}

const strip = (s: string) => s.replace(/^minecraft:/, "");

class Ctx {
  exact = true;
  warnings = new Set<string>();
  constructor(readonly random: RandomSource) {}
  unsupported(what: string) {
    this.exact = false;
    this.warnings.add(what);
  }
}

// Mth.nextInt / Mth.nextFloat
const nextIntBetween = (r: RandomSource, a: number, b: number) => (a >= b ? a : r.nextInt(b - a + 1) + a);
const nextFloatBetween = (r: RandomSource, a: number, b: number) => (a >= b ? a : r.nextFloat() * (b - a) + a);

function getFloat(n: NumberLike, ctx: Ctx): number {
  if (typeof n === "number") return n;
  const type = strip(n.type ?? (n.min !== undefined ? "uniform" : "constant"));
  switch (type) {
    case "constant":
      return n.value ?? 0;
    case "uniform":
      return nextFloatBetween(ctx.random, getFloat(n.min ?? 0, ctx), getFloat(n.max ?? 0, ctx));
    case "binomial":
      return getInt(n, ctx);
    default:
      ctx.unsupported(`number provider ${type}`);
      return 0;
  }
}

function getInt(n: NumberLike, ctx: Ctx): number {
  if (typeof n === "number") return Math.round(n);
  const type = strip(n.type ?? (n.min !== undefined ? "uniform" : "constant"));
  switch (type) {
    case "constant":
      return Math.round(n.value ?? 0);
    case "uniform":
      return nextIntBetween(ctx.random, getInt(n.min ?? 0, ctx), getInt(n.max ?? 0, ctx));
    case "binomial": {
      const trials = getInt(n.n ?? 0, ctx);
      const p = getFloat(n.p ?? 0, ctx);
      let k = 0;
      for (let i = 0; i < trials; i++) if (ctx.random.nextFloat() < p) k++;
      return k;
    }
    default:
      ctx.unsupported(`number provider ${type}`);
      return 0;
  }
}

function conditionsPass(conds: LootCondition[] | undefined, ctx: Ctx): boolean {
  for (const c of conds ?? []) {
    switch (strip(c.condition)) {
      case "random_chance":
        if (!(ctx.random.nextFloat() < (c.chance ?? 0))) return false;
        break;
      case "killed_by_player":
        return false; // never true for chests
      default:
        break; // context-only conditions; no RNG consumed
    }
  }
  return true;
}

// Functions that change the item but consume no randomness.
const PURE_FUNCTIONS = new Set([
  "set_name", "set_lore", "set_potion", "set_components", "set_custom_data", "set_nbt",
  "exploration_map", "set_item", "copy_components", "set_banner_pattern", "set_book_cover",
  "set_written_book_pages", "set_firework_explosion", "set_fireworks", "toggle_tooltips",
  "set_custom_model_data", "furnace_smelt", "limit_count",
]);

function applyFunctions(stack: ItemStack, fns: LootFunction[] | undefined, ctx: Ctx): void {
  for (const f of fns ?? []) {
    if (!conditionsPass(f.conditions, ctx)) continue;
    const name = strip(f.function);
    if (name === "set_count" && f.count !== undefined) {
      const c = getInt(f.count, ctx);
      stack.count = f.add ? stack.count + c : c;
    } else if (name === "set_damage" && f.damage !== undefined) {
      stack.damage = getFloat(f.damage, ctx);
    } else if (!PURE_FUNCTIONS.has(name)) {
      (stack.unpredicted ??= []).push(name);
      ctx.unsupported(`function ${name}`);
    }
  }
}

type Sink = (stack: ItemStack) => void;

/** Mirrors LootItemFunction.decorate: functions run as each item is created, innermost first. */
const decorate = (fns: LootFunction[] | undefined, sink: Sink, ctx: Ctx): Sink =>
  fns?.length ? (s) => (applyFunctions(s, fns, ctx), sink(s)) : sink;

function rollTable(table: LootTable, tables: TableResolver, sink: Sink, ctx: Ctx): void {
  const tableSink = decorate(table.functions, sink, ctx);
  for (const pool of table.pools ?? []) rollPool(pool, tables, tableSink, ctx);
}

function rollPool(pool: LootPool, tables: TableResolver, sink: Sink, ctx: Ctx): void {
  if (!conditionsPass(pool.conditions, ctx)) return;
  const poolSink = decorate(pool.functions, sink, ctx);
  // bonus_rolls scale with luck, which is 0 for naturally opened chests (still evaluated for RNG parity).
  const rolls = getInt(pool.rolls, ctx) + Math.floor(getFloat(pool.bonus_rolls ?? 0, ctx) * 0);
  for (let r = 0; r < rolls; r++) {
    // LootPool.addRandomItem: entries are re-expanded (conditions re-checked) every roll.
    const live = pool.entries.filter((e) => conditionsPass(e.conditions, ctx));
    const total = live.reduce((s, e) => s + Math.max(e.weight ?? 1, 0), 0);
    if (total === 0 || live.length === 0) continue;
    let chosen: LootEntry;
    if (live.length === 1) {
      chosen = live[0]!; // no RNG consumed for single-entry pools
    } else {
      let pick = ctx.random.nextInt(total);
      chosen = live.find((e) => (pick -= Math.max(e.weight ?? 1, 0)) < 0)!;
    }
    expandEntry(chosen, tables, poolSink, ctx);
  }
}

function expandEntry(e: LootEntry, tables: TableResolver, sink: Sink, ctx: Ctx): void {
  const entrySink = decorate(e.functions, sink, ctx);
  switch (strip(e.type)) {
    case "item":
      return entrySink({ item: strip(e.name ?? "air"), count: 1 });
    case "empty":
      return;
    case "loot_table": {
      const sub = e.name ? tables(strip(e.name)) : undefined;
      if (!sub) return ctx.unsupported(`missing table ${e.name}`);
      return rollTable(sub, tables, entrySink, ctx);
    }
    default:
      ctx.unsupported(`entry ${e.type}`);
  }
}

export type TableResolver = (name: string) => LootTable | undefined;

/** Rolls `table` exactly as a chest with this loot seed would. */
export function rollLootTable(table: LootTable, lootSeed: bigint, tables: TableResolver = () => undefined): LootResult {
  const ctx = new Ctx(new JavaRandom(lootSeed)); // RandomSource.create(seed) == LegacyRandomSource
  const items: ItemStack[] = [];
  rollTable(table, tables, (s) => items.push(s), ctx);
  return { items: mergeStacks(items.filter((s) => s.count > 0)), exact: ctx.exact, warnings: [...ctx.warnings] };
}

/** Combine identical stacks for display (the game spreads them over slots, but players care about totals). */
function mergeStacks(items: ItemStack[]): ItemStack[] {
  const out: ItemStack[] = [];
  for (const it of items) {
    const same = !it.unpredicted && it.damage === undefined && out.find((o) => o.item === it.item && !o.unpredicted && o.damage === undefined);
    if (same) same.count += it.count;
    else out.push({ ...it });
  }
  return out;
}
