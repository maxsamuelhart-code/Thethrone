import type { Feature, Me } from "@seedscout/shared";

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly feature?: Feature) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? (init.body !== undefined ? "POST" : "GET");
  // Mutations always send JSON: the API rejects other content types as a CSRF guard.
  const res = await fetch(`/api${path}`, {
    method,
    headers: method !== "GET" ? { "Content-Type": "application/json" } : undefined,
    body: method !== "GET" ? JSON.stringify(init.body ?? {}) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? res.statusText, data.feature);
  return data as T;
}

export const ANON: Me = { user: null, plan: "free", features: ["map", "score"], subscription: null };

/** Works offline / without the API running: the free map is fully client-side. */
export const fetchMe = () => api<Me>("/me").catch(() => ANON);
