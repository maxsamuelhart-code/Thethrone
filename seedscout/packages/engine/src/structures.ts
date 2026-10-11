/** cubiomes `enum StructureType` (finders.h). Order matters: values are passed to WASM. */
export enum StructureType {
  DesertPyramid = 1,
  JungleTemple = 2,
  SwampHut = 3,
  Igloo = 4,
  Village = 5,
  OceanRuin = 6,
  Shipwreck = 7,
  Monument = 8,
  Mansion = 9,
  Outpost = 10,
  RuinedPortal = 11,
  RuinedPortalNether = 12,
  AncientCity = 13,
  BuriedTreasure = 14,
  DesertWell = 16,
  Fortress = 18,
  Bastion = 19,
  EndCity = 20,
  TrailRuins = 23,
  TrialChambers = 24,
}

export type StructureKey =
  | "village" | "desert_pyramid" | "jungle_temple" | "swamp_hut" | "igloo"
  | "ocean_ruin" | "shipwreck" | "monument" | "mansion" | "outpost"
  | "ruined_portal" | "ancient_city" | "buried_treasure" | "trail_ruins" | "trial_chambers";

export interface StructureInfo {
  key: StructureKey;
  type: StructureType;
  label: string;
  /** Short glyph used for map markers. */
  icon: string;
  /** Has chests whose contents we can (eventually) predict. */
  hasLoot: boolean;
}

export const STRUCTURES: readonly StructureInfo[] = [
  { key: "village", type: StructureType.Village, label: "Village", icon: "🏘️", hasLoot: true },
  { key: "desert_pyramid", type: StructureType.DesertPyramid, label: "Desert Pyramid", icon: "🔺", hasLoot: true },
  { key: "jungle_temple", type: StructureType.JungleTemple, label: "Jungle Temple", icon: "🗿", hasLoot: true },
  { key: "swamp_hut", type: StructureType.SwampHut, label: "Witch Hut", icon: "🧙", hasLoot: false },
  { key: "igloo", type: StructureType.Igloo, label: "Igloo", icon: "🧊", hasLoot: true },
  { key: "ocean_ruin", type: StructureType.OceanRuin, label: "Ocean Ruin", icon: "🏛️", hasLoot: true },
  { key: "shipwreck", type: StructureType.Shipwreck, label: "Shipwreck", icon: "⛵", hasLoot: true },
  { key: "monument", type: StructureType.Monument, label: "Ocean Monument", icon: "🔱", hasLoot: false },
  { key: "mansion", type: StructureType.Mansion, label: "Woodland Mansion", icon: "🏚️", hasLoot: true },
  { key: "outpost", type: StructureType.Outpost, label: "Pillager Outpost", icon: "🏹", hasLoot: true },
  { key: "ruined_portal", type: StructureType.RuinedPortal, label: "Ruined Portal", icon: "🌀", hasLoot: true },
  { key: "ancient_city", type: StructureType.AncientCity, label: "Ancient City", icon: "💀", hasLoot: true },
  { key: "buried_treasure", type: StructureType.BuriedTreasure, label: "Buried Treasure", icon: "💰", hasLoot: true },
  { key: "trail_ruins", type: StructureType.TrailRuins, label: "Trail Ruins", icon: "🏺", hasLoot: false },
  { key: "trial_chambers", type: StructureType.TrialChambers, label: "Trial Chambers", icon: "⚔️", hasLoot: true },
];

export const STRUCTURE_BY_KEY: Record<StructureKey, StructureInfo> = Object.fromEntries(
  STRUCTURES.map((s) => [s.key, s]),
) as Record<StructureKey, StructureInfo>;
