/** Single source of truth for what each tier can do. Enforced server-side; mirrored in the UI. */
export type Plan = "free" | "pro";

export type Feature = "map" | "score" | "loot" | "search" | "saved" | "export";

export const PLAN_FEATURES: Record<Plan, readonly Feature[]> = {
  free: ["map", "score"],
  pro: ["map", "score", "loot", "search", "saved", "export"],
};

export const FEATURE_LABELS: Record<Feature, string> = {
  map: "Seed map & structure finder",
  score: "Seed score & verdict",
  loot: "Chest loot prediction",
  search: "Advanced seed search",
  saved: "Saved seeds & bookmarks",
  export: "Export (JSON / CSV)",
};

export const can = (plan: Plan, f: Feature) => PLAN_FEATURES[plan].includes(f);

/** Stripe subscription statuses that grant Pro. past_due keeps access while Stripe retries the card. */
export const ENTITLED_STATUSES = new Set(["active", "trialing", "past_due"]);

export const LIMITS = {
  free: { searchJobsPerDay: 0, savedSeeds: 0 },
  pro: { searchJobsPerDay: 50, savedSeeds: 500, maxSeedsPerJob: 2_000_000, concurrentJobs: 2 },
} as const;
