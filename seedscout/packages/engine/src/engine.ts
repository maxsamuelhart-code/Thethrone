import { Dimension, VERSIONS, type McVersion } from "./versions";
import { StructureType } from "./structures";

export interface WorldParams {
  seed: bigint;
  version: McVersion;
  dimension?: Dimension;
  largeBiomes?: boolean;
}

export interface Pos {
  x: number;
  z: number;
}

/** Biome sampling scales supported by cubiomes. 1 = per block, 4 = per "biome cell", etc. */
export type BiomeScale = 1 | 4 | 16 | 64 | 256;

interface Exports {
  memory: WebAssembly.Memory;
  _initialize(): void;
  ss_malloc(n: number): number;
  ss_free(p: number): void;
  ss_set_world(mc: number, seed: bigint, dim: number, large: number): void;
  ss_biome_at(scale: number, x: number, y: number, z: number): number;
  ss_gen_biomes(scale: number, x: number, z: number, w: number, h: number, y: number, out: number): number;
  ss_biomes_to_rgba(ids: number, n: number, rgba: number): void;
  ss_biome_rgb(id: number): number;
  ss_biome_name(id: number): number;
  ss_biome_exists(id: number): number;
  ss_is_oceanic(id: number): number;
  ss_structures_in_box(t: number, x0: number, z0: number, x1: number, z1: number, out: number, max: number): number;
  ss_spawn(exact: number, out: number): void;
  ss_strongholds(out: number, max: number): number;
}

// cubiomes is pure computation; the only WASI calls come from libc's stdio
// plumbing, which is linked but never exercised. Stub them out.
const wasiStub = new Proxy({}, { get: () => () => 52 /* ENOSYS */ });

/** Normalises a user-entered seed exactly like Minecraft does: numeric strings are parsed, anything else uses String.hashCode(). */
export function parseSeed(input: string): bigint {
  const s = input.trim();
  if (/^-?\d+$/.test(s)) {
    const n = BigInt(s);
    if (n >= -(1n << 63n) && n < 1n << 63n) return n;
  }
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return BigInt(h);
}

/**
 * Seed-accurate world generation backed by cubiomes compiled to WebAssembly.
 * One instance holds one generator; create one per Web Worker.
 */
export class Engine {
  private scratch = 0;
  private scratchSize = 0;

  private constructor(private readonly x: Exports) {}

  static async load(source: BufferSource | WebAssembly.Module): Promise<Engine> {
    const imports = { wasi_snapshot_preview1: wasiStub };
    // Browsers should pass a Module from WebAssembly.compileStreaming (sync compile of
    // raw bytes is fine in Web Workers and Node). Cloudflare Workers forbid runtime
    // compilation entirely and pass the Module wrangler precompiled.
    const compile = WebAssembly.Module as unknown as new (bytes: BufferSource) => WebAssembly.Module; // abstract in workers-types
    const module = source instanceof WebAssembly.Module ? source : new compile(source);
    const instance = await WebAssembly.instantiate(module, imports);
    const x = instance.exports as unknown as Exports;
    x._initialize();
    return new Engine(x);
  }

  setWorld(w: WorldParams): void {
    this.x.ss_set_world(VERSIONS[w.version], BigInt.asIntN(64, w.seed), w.dimension ?? Dimension.Overworld, w.largeBiomes ? 1 : 0);
  }

  /** Biome id at block coordinates (sampled at 1:4, which is what F3 shows to within a few blocks). */
  biomeAt(x: number, z: number, y = 64): number {
    return this.x.ss_biome_at(4, x >> 2, y >> 2, z >> 2);
  }

  /** w*h biome ids starting at (x,z) in units of `scale` blocks. */
  genBiomes(scale: BiomeScale, x: number, z: number, w: number, h: number, y = 64): Int32Array {
    const n = w * h;
    const ptr = this.buffer(n * 4);
    const yy = scale === 1 ? y : y >> 2;
    if (this.x.ss_gen_biomes(scale, x, z, w, h, yy, ptr) !== 0) throw new Error("biome generation failed");
    return new Int32Array(this.x.memory.buffer, ptr, n).slice();
  }

  /** Same as genBiomes but returns RGBA pixels suitable for `new ImageData(...)`. */
  biomeRgba(scale: BiomeScale, x: number, z: number, w: number, h: number, y = 64): Uint8ClampedArray {
    const n = w * h;
    const ids = this.buffer(n * 8); // ids followed by rgba, both 4 bytes per sample
    const yy = scale === 1 ? y : y >> 2;
    if (this.x.ss_gen_biomes(scale, x, z, w, h, yy, ids) !== 0) throw new Error("biome generation failed");
    this.x.ss_biomes_to_rgba(ids, n, ids + n * 4);
    return new Uint8ClampedArray(this.x.memory.buffer, ids + n * 4, n * 4).slice();
  }

  biomeColor(id: number): string {
    return "#" + this.x.ss_biome_rgb(id).toString(16).padStart(6, "0");
  }

  biomeName(id: number): string {
    return this.cString(this.x.ss_biome_name(id));
  }

  /** Overworld biomes that exist in the current version: [id, name] pairs. */
  biomeList(): Array<[number, string]> {
    const out: Array<[number, string]> = [];
    for (let id = 0; id < 256; id++) if (this.x.ss_biome_exists(id)) out.push([id, this.biomeName(id)]);
    return out;
  }

  isOceanic(id: number): boolean {
    return this.x.ss_is_oceanic(id) !== 0;
  }

  /** Viable structures of a type whose position lies in the block-space box. */
  structuresInBox(type: StructureType, x0: number, z0: number, x1: number, z1: number, max = 256): Pos[] {
    const ptr = this.buffer(max * 8);
    const n = this.x.ss_structures_in_box(type, x0, z0, x1, z1, ptr, max);
    if (n <= 0) return [];
    const a = new Int32Array(this.x.memory.buffer, ptr, n * 2);
    const out: Pos[] = [];
    for (let i = 0; i < n; i++) out.push({ x: a[2 * i]!, z: a[2 * i + 1]! });
    return out;
  }

  /** Nearest viable structure of a type to `from`, searching a square of half-width `radius`. */
  nearestStructure(type: StructureType, from: Pos, radius: number): (Pos & { dist: number }) | null {
    let best: (Pos & { dist: number }) | null = null;
    for (const p of this.structuresInBox(type, from.x - radius, from.z - radius, from.x + radius, from.z + radius)) {
      const dist = Math.hypot(p.x - from.x, p.z - from.z);
      if (dist <= radius && (!best || dist < best.dist)) best = { ...p, dist };
    }
    return best;
  }

  /** World spawn. `exact` matches the game; the estimate is ~100x faster and usually within a chunk or two. */
  spawn(exact = false): Pos {
    const ptr = this.buffer(8);
    this.x.ss_spawn(exact ? 1 : 0, ptr);
    const a = new Int32Array(this.x.memory.buffer, ptr, 2);
    return { x: a[0]!, z: a[1]! };
  }

  strongholds(max = 3): Pos[] {
    const ptr = this.buffer(max * 8);
    const n = this.x.ss_strongholds(ptr, max);
    const a = new Int32Array(this.x.memory.buffer, ptr, n * 2);
    return Array.from({ length: n }, (_, i) => ({ x: a[2 * i]!, z: a[2 * i + 1]! }));
  }

  /** Reusable scratch allocation inside WASM memory (grown on demand). */
  private buffer(bytes: number): number {
    if (bytes > this.scratchSize) {
      if (this.scratch) this.x.ss_free(this.scratch);
      this.scratchSize = Math.max(bytes, this.scratchSize * 2, 4096);
      this.scratch = this.x.ss_malloc(this.scratchSize);
      if (!this.scratch) throw new Error("out of WASM memory");
    }
    return this.scratch;
  }

  private cString(ptr: number): string {
    if (!ptr) return "unknown";
    const mem = new Uint8Array(this.x.memory.buffer);
    let end = ptr;
    while (mem[end]) end++;
    return new TextDecoder().decode(mem.subarray(ptr, end));
  }
}
