import type { BiomeScale, McVersion, Pos, ProfileKey, SeedScore, StructureKey } from "@seedscout/engine";

/** Seeds cross the worker boundary as bigint (structured-cloneable). */
export interface World {
  seed: bigint;
  version: McVersion;
}

export interface Requests {
  tile: { world: World; scale: BiomeScale; x: number; z: number; n: number };
  structures: { world: World; keys: StructureKey[]; box: [number, number, number, number] };
  overview: { world: World };
  score: { world: World; profile: ProfileKey };
  biomeAt: { world: World; x: number; z: number };
  biomeList: { version: McVersion };
}

export interface Responses {
  tile: Uint8ClampedArray;
  structures: Array<{ key: StructureKey } & Pos>;
  overview: { spawn: Pos; strongholds: Pos[] };
  score: SeedScore;
  biomeAt: string;
  biomeList: Array<[number, string]>;
}

export type RequestType = keyof Requests;
export type WorkerRequest = { [K in RequestType]: { id: number; type: K; payload: Requests[K] } }[RequestType];
export type WorkerResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };
