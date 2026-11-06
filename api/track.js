// POST /api/track — anonymous page-view logging for the public site.
// Stores only: page path, referrer source (instagram / google / direct / other), device type, time.
// No IP address, no cookies, no user agent, nothing personal. Always answers 204, even if the
// database is missing or down, so it can never affect the site.
import { neon } from "@neondatabase/serverless";

let sql = null;
const db = () => {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (url && !sql) sql = neon(url);
  return sql;
};

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|pingdom|monitor|curl|wget|python|go-http|java\//i;
const NO_CONTENT = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

export function sourceOf(referrer, ownHost) {
  let host = "";
  try { host = new URL(referrer).hostname.toLowerCase(); } catch { return "direct"; }
  if (!host || host === ownHost) return "direct";
  if (/(^|\.)instagram\.com$|(^|\.)ig\.me$/.test(host)) return "instagram";
  if (/(^|\.)google\.[a-z.]+$/.test(host)) return "google";
  return "other";
}

export function deviceOf(ua) {
  if (/ipad|tablet|kindle|silk|playbook|(android(?!.*mobile))/i.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) return "mobile";
  return "desktop";
}

export async function POST(request) {
  try {
    const ua = request.headers.get("user-agent") || "";
    const sql = db();
    if (!sql || BOT.test(ua)) return NO_CONTENT();
    const body = await request.json().catch(() => ({}));
    const path = String(body.p || "/").split(/[?#]/)[0].slice(0, 200) || "/";
    if (path.startsWith("/jarvis")) return NO_CONTENT();
    const host = new URL(request.url).hostname.toLowerCase();
    await sql.query("INSERT INTO page_views (path, source, device) VALUES ($1, $2, $3)", [
      path,
      sourceOf(String(body.r || ""), host),
      deviceOf(ua),
    ]);
  } catch {
    // database down, table missing, bad input: silently do nothing
  }
  return NO_CONTENT();
}
