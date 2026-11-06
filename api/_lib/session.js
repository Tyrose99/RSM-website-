// Login sessions for the private /jarvis page (Justin and Tyler only).
// Runs in both the edge middleware and Node functions, so it only uses Web Crypto.
// The signing key is derived from the two passwords: changing either password logs everyone out.

const enc = new TextEncoder();
export const COOKIE = "__Host-rsm_jarvis";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days
export const USERS = { justin: "JUSTIN_PASSWORD", tyler: "TYLER_PASSWORD" };

const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function signingKey() {
  const j = process.env.JUSTIN_PASSWORD, t = process.env.TYLER_PASSWORD;
  if (!j || !t) return null;
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(`rsm-jarvis-session-v1|${j}|${t}`));
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export function passwordsConfigured() {
  return Boolean(process.env.JUSTIN_PASSWORD && process.env.TYLER_PASSWORD);
}

// Compare a typed password with the stored one without leaking timing information
export async function checkPassword(user, password) {
  const envName = USERS[user];
  const expected = envName && process.env[envName];
  if (!expected || typeof password !== "string") return false;
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(password)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function createSession(user) {
  const key = await signingKey();
  if (!key) throw new Error("passwords not configured");
  const payload = `${user}.${Math.floor(Date.now() / 1000) + MAX_AGE}`;
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

// Returns "justin" / "tyler" for a valid, unexpired session cookie, otherwise null
export async function readSession(request) {
  const cookie = request.headers.get("cookie") || "";
  const match = cookie.split(/;\s*/).find((c) => c.startsWith(COOKIE + "="));
  if (!match) return null;
  const [user, exp, sig] = match.slice(COOKIE.length + 1).split(".");
  if (!USERS[user] || !/^\d+$/.test(exp || "") || !sig) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  const key = await signingKey();
  if (!key) return null;
  try {
    return (await crypto.subtle.verify("HMAC", key, fromB64url(sig), enc.encode(`${user}.${exp}`))) ? user : null;
  } catch {
    return null;
  }
}

export const sessionCookie = (value) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`;
export const clearedCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
