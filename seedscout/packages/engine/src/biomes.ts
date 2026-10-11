/** Biome ids from cubiomes `enum BiomeID` (biomes.h) used by scoring and search. */
export const Biome = {
  ocean: 0,
  plains: 1,
  desert: 2,
  forest: 4,
  taiga: 5,
  swamp: 6,
  river: 7,
  mushroom_fields: 14,
  jungle: 21,
  deep_ocean: 24,
  dark_forest: 29,
  savanna: 35,
  badlands: 37,
  warm_ocean: 44,
  sunflower_plains: 129,
  flower_forest: 132,
  ice_spikes: 140,
  eroded_badlands: 165,
  bamboo_jungle: 168,
  meadow: 177,
  deep_dark: 183,
  mangrove_swamp: 184,
  cherry_grove: 185,
  pale_garden: 186,
} as const;

export type BiomeKey = keyof typeof Biome;

/** Biomes players actively hunt for; their presence near spawn raises a seed's score. */
export const RARE_BIOMES: readonly number[] = [
  Biome.mushroom_fields,
  Biome.ice_spikes,
  Biome.eroded_badlands,
  Biome.badlands,
  Biome.cherry_grove,
  Biome.bamboo_jungle,
  Biome.flower_forest,
  Biome.sunflower_plains,
  Biome.pale_garden,
];
