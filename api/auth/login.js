// POST /api/auth/login  { user: "justin" | "tyler", password }
// Sets a 30-day httpOnly session cookie on success.
import { checkPassword, createSession, passwordsConfigured, sessionCookie, USERS } from "../_lib/session.js";

const json = (body, status = 200, headers = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

export async function POST(request) {
  // Only accept logins from this site's own login form
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: "Forbidden" }, 403);
  if (!passwordsConfigured()) return json({ error: "Jarvis isn't set up yet: the passwords haven't been added in Vercel." }, 503);

  const body = await request.json().catch(() => ({}));
  const user = String(body.user || "").toLowerCase().trim();
  if (!USERS[user] || !(await checkPassword(user, body.password))) {
    await new Promise((r) => setTimeout(r, 800)); // slow down password guessing
    return json({ error: "Wrong name or password." }, 401);
  }
  return json({ ok: true, user }, 200, { "Set-Cookie": sessionCookie(await createSession(user)) });
}
