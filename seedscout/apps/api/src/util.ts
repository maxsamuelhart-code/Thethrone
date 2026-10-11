export const now = () => Date.now();

export function randomToken(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export const newId = () => crypto.randomUUID();

/** Random signed 64-bit integer as a decimal string. */
export function randomSeed(): string {
  const v = new BigUint64Array(1);
  crypto.getRandomValues(v);
  return BigInt.asIntN(64, v[0]!).toString();
}
