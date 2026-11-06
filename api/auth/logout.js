// POST /api/auth/logout  — clears the Jarvis session cookie
import { clearedCookie } from "../_lib/session.js";

export function POST() {
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearedCookie(), "Cache-Control": "no-store" } });
}
