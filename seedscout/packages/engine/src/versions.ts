/** Java Edition versions, mapped to cubiomes' `enum MCVersion` values (biomes.h). */
export const VERSIONS = {
  "1.16": 20,
  "1.17": 21,
  "1.18": 22,
  "1.19": 24,
  "1.20": 25,
  "1.21.1": 26,
  "1.21.3": 27,
  "1.21": 28, // latest 1.21.x worldgen (Winter Drop / pale garden)
} as const;

export type McVersion = keyof typeof VERSIONS;
export const LATEST_VERSION: McVersion = "1.21";
export const VERSION_LIST = Object.keys(VERSIONS) as McVersion[];

export function isVersion(v: unknown): v is McVersion {
  return typeof v === "string" && v in VERSIONS;
}

export enum Dimension {
  Nether = -1,
  Overworld = 0,
  End = 1,
}
