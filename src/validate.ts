export const NAME_MAX = 20;
export const MESSAGE_MAX = 60;

export interface Entry {
  name: string;
  message: string;
  email: string;
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Counts code points, matching SQLite's length() on TEXT. */
export const charCount = (s: string) => [...s].length;

const clean = (v: unknown) => (typeof v === "string" ? v.normalize("NFC").replace(/\s+/g, " ").trim() : "");

export function validateEntry(input: unknown): { ok: true; entry: Entry } | { ok: false; error: string } {
  const body = (input ?? {}) as Record<string, unknown>;
  const name = clean(body.name);
  const message = clean(body.message);
  const email = clean(body.email).toLowerCase();

  if (!name) return { ok: false, error: "Your royal name is required." };
  if (charCount(name) > NAME_MAX) return { ok: false, error: `Name must be ${NAME_MAX} characters or fewer.` };
  if (charCount(message) > MESSAGE_MAX) return { ok: false, error: `Message must be ${MESSAGE_MAX} characters or fewer.` };
  if (CONTROL_CHARS.test(name) || CONTROL_CHARS.test(message)) return { ok: false, error: "That text contains invalid characters." };
  if (email.length > 254 || !EMAIL.test(email)) return { ok: false, error: "Please enter a valid email address." };

  return { ok: true, entry: { name, message, email } };
}

/** Cheap deterministic checks that run before the model; catches the obvious cases for free. */
export function quickReject(text: string): string | null {
  const t = text.toLowerCase();
  if (/(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|uk|me|ly|gg|xyz|app|dev|tv|info|biz)\b)/.test(t)) {
    return "Links aren't allowed.";
  }
  if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/.test(t)) return "Email addresses aren't allowed.";
  if (/\+?\d[\d\s\-().]{5,}\d/.test(text)) return "Phone numbers aren't allowed.";
  return null;
}
