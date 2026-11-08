// Instagram (@rsm.collective, read-only) for the /jarvis screen. Login required (see /middleware.js).
//   GET  /api/jarvis/instagram?thumb=<post id>  -> the saved copy of a post's thumbnail
//   GET  /api/jarvis/instagram                  -> connection status (never the token)
//   POST /api/jarvis/instagram { action: "sync" } -> pull the latest posts and follower count now
//   GET  /api/jarvis/instagram?job=daily        -> the daily job (renew token, follower snapshot, posts).
//        Only runs when called with the CRON_SECRET (Vercel Cron sends it), or by a logged-in user.
import { readSession } from "../_lib/session.js";
import { thumbnail, instagramStatus, getProfile, syncPosts, dailyJob } from "../_lib/instagram.js";

const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function sameSecret(a, b) {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const p = new Uint8Array(x), q = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < p.length; i++) d |= p[i] ^ q[i];
  return d === 0;
}

export async function GET(request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("thumb");
  try {
    if (url.searchParams.get("job") === "daily") {
      const fromCron = await sameSecret(request.headers.get("authorization") || "", process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : "");
      if (!fromCron && !(await readSession(request))) return json({ error: "Not allowed" }, 401);
      const result = await dailyJob();
      console.log("instagram daily job", JSON.stringify({ refresh: result.refresh?.ok, followers: result.followers, posts: result.posts?.synced ?? null }));
      return json(result);
    }
    if (id) {
      if (!/^[0-9A-Za-z_]{1,64}$/.test(id)) return new Response("Not found", { status: 404 });
      const img = await thumbnail(id);
      if (!img) return new Response("Not found", { status: 404 });
      return new Response(img.bytes, {
        headers: { "Content-Type": /^image\/[a-z]+$/.test(img.type) ? img.type : "image/jpeg", "Cache-Control": "private, max-age=604800", "X-Content-Type-Options": "nosniff" },
      });
    }
    return json(await instagramStatus());
  } catch (err) {
    console.error("jarvis instagram", err.message);
    return json({ error: "That didn't work" }, 500);
  }
}

export async function POST(request) {
  const { action } = await request.json().catch(() => ({}));
  if (action !== "sync") return json({ error: "Unknown action" }, 400);
  try {
    const profile = await getProfile({ fresh: true });
    const posts = profile.connected ? await syncPosts({ force: true }) : null;
    return json({ profile, posts });
  } catch (err) {
    console.error("jarvis instagram sync", err.message);
    return json({ error: "That didn't work" }, 500);
  }
}
