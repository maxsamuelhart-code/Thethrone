/**
 * Minecraft's two RNGs, bit-exact.
 *  - JavaRandom: java.util.Random (LegacyRandomSource). Rolls chest loot.
 *  - Xoroshiro: XoroshiroRandomSource (Xoroshiro128++). Drives 1.18+ feature/structure
 *    decoration, which is where chest loot *seeds* come from.
 * Uses BigInt: these run per chest, not per pixel, so clarity beats speed.
 */

const M64 = (1n << 64n) - 1n;
const i64 = (v: bigint) => BigInt.asIntN(64, v);
const u64 = (v: bigint) => v & M64;

export interface RandomSource {
  setSeed(seed: bigint): void;
  nextInt(bound?: number): number;
  nextLong(): bigint;
  nextFloat(): number;
  nextDouble(): number;
  nextBoolean(): boolean;
}

export class JavaRandom implements RandomSource {
  private static readonly MULT = 0x5deece66dn;
  private static readonly MASK = (1n << 48n) - 1n;
  private seed = 0n;

  constructor(seed: bigint) {
    this.setSeed(seed);
  }

  setSeed(seed: bigint): void {
    this.seed = (seed ^ JavaRandom.MULT) & JavaRandom.MASK;
  }

  next(bits: number): number {
    this.seed = (this.seed * JavaRandom.MULT + 0xbn) & JavaRandom.MASK;
    return Number(BigInt.asIntN(32, this.seed >> BigInt(48 - bits)));
  }

  nextInt(bound?: number): number {
    if (bound === undefined) return this.next(32);
    if (bound <= 0) throw new RangeError("bound must be positive");
    if ((bound & -bound) === bound) return Number((BigInt(bound) * BigInt(this.next(31))) >> 31n);
    let bits: number, val: number;
    do {
      bits = this.next(31);
      val = bits % bound;
    } while (bits - val + (bound - 1) < 0 || bits - val + (bound - 1) > 0x7fffffff);
    return val;
  }

  nextLong(): bigint {
    return i64((BigInt(this.next(32)) << 32n) + BigInt(this.next(32)));
  }

  nextFloat(): number {
    return this.next(24) / (1 << 24);
  }

  nextDouble(): number {
    return (this.next(26) * 2 ** 27 + this.next(27)) * 2 ** -53;
  }

  nextBoolean(): boolean {
    return this.next(1) !== 0;
  }
}

const rotl = (x: bigint, r: bigint) => u64((x << r) | (x >> (64n - r)));

function mixStafford13(z: bigint): bigint {
  z = u64((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n);
  z = u64((z ^ (z >> 27n)) * 0x94d049bb133111ebn);
  return z ^ (z >> 31n);
}

/** XoroshiroRandomSource. Must be checked against the game before predictions are trusted (see docs/LOOT.md). */
export class Xoroshiro implements RandomSource {
  private lo = 0n;
  private hi = 0n;

  constructor(seed: bigint) {
    this.setSeed(seed);
  }

  /** RandomSupport.upgradeSeedTo128bit */
  setSeed(seed: bigint): void {
    const lo = u64(seed) ^ 0x6a09e667f3bcc909n;
    const hi = u64(lo + 0x9e3779b97f4a7c15n);
    this.lo = mixStafford13(lo);
    this.hi = mixStafford13(hi);
    if (this.lo === 0n && this.hi === 0n) {
      this.lo = 0x9e3779b97f4a7c15n;
      this.hi = 0x6a09e667f3bcc909n;
    }
  }

  nextLong(): bigint {
    const l = this.lo;
    let m = this.hi;
    const n = u64(rotl(u64(l + m), 17n) + l);
    m ^= l;
    this.lo = rotl(l, 49n) ^ m ^ u64(m << 21n);
    this.hi = rotl(m, 28n);
    return i64(n);
  }

  nextInt(bound?: number): number {
    if (bound === undefined) return Number(BigInt.asIntN(32, this.nextLong()));
    if (bound <= 0) throw new RangeError("bound must be positive");
    // Lemire's method, as in XoroshiroRandomSource.nextInt(int)
    let l = BigInt.asUintN(32, this.nextLong());
    let m = l * BigInt(bound);
    let n = m & 0xffffffffn;
    if (n < BigInt(bound)) {
      const j = BigInt((((~bound + 1) >>> 0) % bound) >>> 0);
      while (n < j) {
        l = BigInt.asUintN(32, this.nextLong());
        m = l * BigInt(bound);
        n = m & 0xffffffffn;
      }
    }
    return Number(m >> 32n);
  }

  nextFloat(): number {
    return Number(u64(this.nextLong()) >> 40n) * 2 ** -24;
  }

  nextDouble(): number {
    return Number(u64(this.nextLong()) >> 11n) * 2 ** -53;
  }

  nextBoolean(): boolean {
    return (this.nextLong() & 1n) !== 0n;
  }
}

/** WorldgenRandom helpers (1.18+). Returned seeds are signed 64-bit like Java longs. */
export function decorationSeed(rng: RandomSource, worldSeed: bigint, blockX: number, blockZ: number): bigint {
  rng.setSeed(worldSeed);
  const a = rng.nextLong() | 1n;
  const b = rng.nextLong() | 1n;
  const seed = i64((BigInt(blockX) * a + BigInt(blockZ) * b) ^ worldSeed);
  rng.setSeed(seed);
  return seed;
}

export function featureSeed(rng: RandomSource, decoSeed: bigint, index: number, step: number): void {
  rng.setSeed(i64(decoSeed + BigInt(index) + 10000n * BigInt(step)));
}
