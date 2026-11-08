// Instagram for @rsm.collective — READ-ONLY (Instagram API with Instagram Login).
// Uses only profile/media reads and insights. Nothing here can post, comment or send DMs.
//
// Token: the first long-lived token comes from the INSTAGRAM_ACCESS_TOKEN Vercel variable. Jarvis copies it,
// encrypted, into jarvis_instagram_auth and renews it there before it expires (tokens last ~60 days).
// Pasting a new token into Vercel later replaces the stored one automatically.
// Instagram's image links expire, so post thumbnails are saved into jarvis_instagram_media.
import { jq, jarvisDbConfigured } from "./db-jarvis.js";
import { logActivity, nyDate } from "./jarvis-store.js";

const VERSION = "v23.0";
// INSTAGRAM_GRAPH_BASE is only for local testing; it is ignored on Vercel.
const BASE = () => (!process.env.VERCEL && process.env.INSTAGRAM_GRAPH_BASE) || "https://graph.instagram.com";
const DAY = 864e5;

const envToken = () =>
  String(process.env.INSTAGRAM_ACCESS_TOKEN || "")
    .trim()
    .replace(/^INSTAGRAM_ACCESS_TOKEN\s*=\s*/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
export const instagramConfigured = () => Boolean(envToken());

// ---------- encryption for the stored token (AES-GCM, key derived from the two login passwords) ----------
const enc = new TextEncoder();
const b64 = (buf) => Buffer.from(buf).toString("base64");
async function aesKey() {
  const j = process.env.JUSTIN_PASSWORD, t = process.env.TYLER_PASSWORD;
  if (!j || !t) return null;
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(`rsm-jarvis-instagram-v1|${j}|${t}`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function seal(token) {
  const key = await aesKey();
  if (!key) throw new Error("passwords not configured");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(token));
  return `${b64(iv)}.${b64(ct)}`;
}
async function unseal(s) {
  const key = await aesKey();
  const [iv, ct] = String(s || "").split(".");
  if (!key || !iv || !ct) return null;
  try {
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(iv, "base64") }, key, Buffer.from(ct, "base64")));
  } catch {
    return null;
  }
}
const fingerprint = async (t) => Buffer.from(await crypto.subtle.digest("SHA-256", enc.encode(`rsm-ig-fp|${t}`))).toString("hex").slice(0, 16);

// ---------- token storage ----------
const AUTH_COLS = "token_enc, env_fp, ig_user_id, username, expires_at, refreshed_at, synced_at, updated_at";
async function authRow() {
  const [row] = await jq(`SELECT ${AUTH_COLS} FROM jarvis_instagram_auth WHERE id = 1`);
  return row || null;
}
async function saveToken(token, { fp = null, expiresAt = null, refreshed = false } = {}) {
  const [row] = await jq(
    `INSERT INTO jarvis_instagram_auth AS a (id, token_enc, env_fp, expires_at, refreshed_at, updated_at)
     VALUES (1, $1, $2, $3, CASE WHEN $4 THEN now() END, now())
     ON CONFLICT (id) DO UPDATE SET token_enc = EXCLUDED.token_enc,
       env_fp = COALESCE(EXCLUDED.env_fp, a.env_fp),
       expires_at = CASE WHEN $2::text IS NOT NULL THEN EXCLUDED.expires_at ELSE COALESCE(EXCLUDED.expires_at, a.expires_at) END,
       refreshed_at = CASE WHEN $4 THEN now() WHEN $2::text IS NOT NULL THEN NULL ELSE a.refreshed_at END,
       updated_at = now()
     RETURNING ${AUTH_COLS}`,
    [await seal(token), fp, expiresAt, refreshed],
  );
  return row;
}

/** The token to use right now: { token, row } or { error } */
async function currentToken() {
  const env = envToken();
  if (!jarvisDbConfigured()) return env ? { token: env, row: null } : { error: "not_set_up" };
  let row = await authRow();
  if (env) {
    const fp = await fingerprint(env);
    if (!row || row.env_fp !== fp) {
      // a new token was pasted into Vercel: start using it
      row = await saveToken(env, { fp });
      await logActivity("jarvis", "instagram.connect", "Connected to Instagram with the token from Vercel").catch(() => {});
      return { token: env, row };
    }
  }
  if (!row) return { error: "not_set_up" };
  const token = await unseal(row.token_enc);
  if (!token) return env ? { token: env, row } : { error: "not_set_up" };
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return { error: "expired", row };
  return { token, row };
}

/**
 * Renew the long-lived token (each renewal is good for ~60 more days). Instagram only renews tokens that are
 * at least a day old, so this runs when the last renewal is over 6 days old (or the token is close to expiring).
 */
export async function refreshToken({ force = false } = {}) {
  const auth = await currentToken();
  if (auth.error) return { ok: false, reason: auth.error };
  if (!auth.row) return { ok: false, reason: "no database" };
  const last = new Date(auth.row.refreshed_at || auth.row.updated_at).getTime();
  const left = auth.row.expires_at ? new Date(auth.row.expires_at).getTime() - Date.now() : null;
  const due = force || Date.now() - last > 6 * DAY || (left != null && left < 14 * DAY && Date.now() - last > 25 * 36e5);
  if (!due) return { ok: true, skipped: true, expires_at: auth.row.expires_at };
  const u = new URL(`${BASE()}/refresh_access_token`);
  u.searchParams.set("grant_type", "ig_refresh_token");
  u.searchParams.set("access_token", auth.token);
  const r = await fetch(u, { signal: AbortSignal.timeout(10000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    console.error("instagram refresh failed", r.status, j.error?.code || "", j.error?.message || "");
    return { ok: false, reason: j.error?.message || `HTTP ${r.status}` };
  }
  const expiresAt = new Date(Date.now() + Number(j.expires_in || 60 * 86400) * 1000).toISOString();
  await saveToken(j.access_token, { expiresAt, refreshed: true });
  await logActivity("jarvis", "instagram.token_refresh", `Renewed the Instagram connection (good until ${expiresAt.slice(0, 10)})`).catch(() => {});
  return { ok: true, expires_at: expiresAt };
}

let lastLazyRefresh = 0;
async function connect() {
  let auth = await currentToken();
  if (auth.error) return auth;
  // renew in passing, at most once an hour per server instance (the daily job also does this)
  if (auth.row && Date.now() - lastLazyRefresh > 36e5) {
    lastLazyRefresh = Date.now();
    const r = await refreshToken().catch(() => null);
    if (r?.ok && !r.skipped) auth = await currentToken();
  }
  return auth;
}

// ---------- Graph API ----------
class IgError extends Error {}
async function ig(path, params, auth) {
  const u = new URL(`${BASE()}/${VERSION}/${path}`);
  for (const [k, v] of Object.entries(params || {})) if (v != null) u.searchParams.set(k, String(v));
  u.searchParams.set("access_token", auth.token);
  const r = await fetch(u, { signal: AbortSignal.timeout(9000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const e = new IgError(j.error?.message || `Instagram HTTP ${r.status}`);
    e.code = j.error?.code;
    e.status = r.status;
    throw e; // the URL (with the token) is never logged or returned
  }
  return j;
}

export function notConnected(reason) {
  const messages = {
    not_set_up: "Instagram isn't connected yet. Add the INSTAGRAM_ACCESS_TOKEN in Vercel to connect @rsm.collective.",
    expired: "The Instagram connection has expired. Generate a new token in the Meta developer dashboard and paste it into Vercel.",
  };
  return { connected: false, reason, message: messages[reason] || "Instagram didn't answer just now." };
}
const igFailure = (err) => {
  console.error("instagram", err.status || "", err.code || "", err.message);
  return notConnected(err.code === 190 ? "expired" : "error");
};

// ---------- profile + follower snapshots ----------
let profileMemo = null;
export async function getProfile({ fresh = false } = {}) {
  if (!fresh && profileMemo && Date.now() - profileMemo.at < 5 * 60e3) return profileMemo.data;
  const auth = await connect();
  if (auth.error) return notConnected(auth.error);
  let p;
  try {
    p = await ig("me", { fields: "user_id,username,name,followers_count,follows_count,media_count" }, auth);
  } catch (err) {
    return igFailure(err);
  }
  const data = { connected: true, username: p.username, name: p.name || null, followers: p.followers_count ?? null, follows: p.follows_count ?? null, posts: p.media_count ?? null };
  if (jarvisDbConfigured()) {
    if (data.followers != null) {
      await jq(
        `INSERT INTO jarvis_instagram_followers (day, followers, follows, media_count) VALUES ($1, $2, $3, $4)
         ON CONFLICT (day) DO UPDATE SET followers = EXCLUDED.followers, follows = EXCLUDED.follows, media_count = EXCLUDED.media_count, captured_at = now()`,
        [nyDate(), data.followers, data.follows, data.posts],
      );
    }
    await jq(`UPDATE jarvis_instagram_auth SET username = $1, ig_user_id = $2 WHERE id = 1`, [p.username || null, String(p.user_id || p.id || "") || null]);
  }
  profileMemo = { at: Date.now(), data };
  return data;
}

/** Follower counts per day from the saved snapshots, and how many were gained over the window */
export async function followerGrowth(days = 30) {
  const since = new Date(Date.now() - days * DAY).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const [rows, [first]] = await Promise.all([
    jq(`SELECT day, followers FROM jarvis_instagram_followers WHERE day >= $1 ORDER BY day`, [since]),
    jq(`SELECT min(day) AS day FROM jarvis_instagram_followers`),
  ]);
  const series = rows.map((r) => ({ day: String(r.day instanceof Date ? r.day.toISOString() : r.day).slice(0, 10), count: r.followers }));
  const gained = series.length > 1 ? series[series.length - 1].count - series[0].count : null;
  const trackingSince = first?.day ? String(first.day instanceof Date ? first.day.toISOString() : first.day).slice(0, 10) : null;
  return { days, series, gained, from: series[0]?.day || null, to: series[series.length - 1]?.day || null, tracking_since: trackingSince };
}

// ---------- posts ----------
const MEDIA_FIELDS = "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count";
const val = (m) => m?.total_value?.value ?? m?.values?.[0]?.value ?? null;

async function mediaInsights(m, auth) {
  const reel = m.media_product_type === "REELS" || m.media_type === "VIDEO";
  const sets = [reel ? "reach,views,saved,shares,total_interactions" : "reach,views,saved,shares,total_interactions", "reach,saved"];
  for (const metric of sets) {
    try {
      const j = await ig(`${m.id}/insights`, { metric }, auth);
      const out = {};
      for (const d of j.data || []) out[d.name] = val(d);
      return out;
    } catch (err) {
      if (err.code === 190) throw err;
    }
  }
  return null;
}

async function downloadImage(url) {
  const testBase = !process.env.VERCEL && process.env.INSTAGRAM_GRAPH_BASE;
  if (!url || !(/^https:\/\//.test(url) || (testBase && url.startsWith(testBase)))) return null;
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const type = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!r.ok || !/^image\/(jpeg|png|webp|gif|heic|heif)$/.test(type)) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 4 * 1024 * 1024) return null;
  return { b64: buf.toString("base64"), type };
}

async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch(() => null); } }));
  return out;
}

/** Pull the latest posts/reels with their numbers and save copies of their thumbnails. Throttled to every 15 min. */
export async function syncPosts({ force = false, limit = 30 } = {}) {
  if (!jarvisDbConfigured()) return { ok: false, reason: "no database" };
  const auth = await connect();
  if (auth.error) return { ok: false, ...notConnected(auth.error) };
  if (!force && auth.row?.synced_at && Date.now() - new Date(auth.row.synced_at).getTime() < 15 * 60e3) return { ok: true, skipped: true };
  let list;
  try {
    list = await ig("me/media", { fields: MEDIA_FIELDS, limit }, auth);
  } catch (err) {
    return { ok: false, ...igFailure(err) };
  }
  const items = (list.data || []).filter((m) => m && m.id);
  const known = new Map();
  if (items.length) {
    for (const r of await jq(`SELECT id, insights_at, (thumb IS NOT NULL) AS has_thumb FROM jarvis_instagram_media WHERE id = ANY($1)`, [items.map((m) => String(m.id))])) known.set(r.id, r);
  }
  await pool(items, 5, async (m) => {
    const ex = known.get(String(m.id));
    const posted = m.timestamp ? new Date(m.timestamp).getTime() : Date.now();
    const recent = Date.now() - posted < 45 * DAY;
    const stale = !ex || (recent && (!ex.insights_at || Date.now() - new Date(ex.insights_at).getTime() > 3 * 36e5));
    const ins = stale ? await mediaInsights(m, auth).catch(() => null) : null;
    const img = ex?.has_thumb ? null : await downloadImage(m.media_type === "VIDEO" ? m.thumbnail_url : m.media_url || m.thumbnail_url).catch(() => null);
    await jq(
      `INSERT INTO jarvis_instagram_media AS x (id, media_type, product_type, caption, permalink, posted_at, likes, comments,
         reach, views, saved, shares, interactions, thumb, thumb_type, insights_at, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, CASE WHEN $14::text IS NULL THEN NULL ELSE decode($14::text, 'base64') END, $15,
         CASE WHEN $16 THEN now() END, now())
       ON CONFLICT (id) DO UPDATE SET media_type = EXCLUDED.media_type, product_type = EXCLUDED.product_type, caption = EXCLUDED.caption,
         permalink = EXCLUDED.permalink, posted_at = EXCLUDED.posted_at, likes = EXCLUDED.likes, comments = EXCLUDED.comments,
         reach = COALESCE(EXCLUDED.reach, x.reach), views = COALESCE(EXCLUDED.views, x.views), saved = COALESCE(EXCLUDED.saved, x.saved),
         shares = COALESCE(EXCLUDED.shares, x.shares), interactions = COALESCE(EXCLUDED.interactions, x.interactions),
         thumb = COALESCE(EXCLUDED.thumb, x.thumb), thumb_type = COALESCE(EXCLUDED.thumb_type, x.thumb_type),
         insights_at = COALESCE(EXCLUDED.insights_at, x.insights_at), synced_at = now()`,
      [
        String(m.id), m.media_type || null, m.media_product_type || null, m.caption ? String(m.caption).slice(0, 2200) : null,
        /^https:\/\/(www\.)?instagram\.com\//.test(m.permalink || "") ? m.permalink : null, m.timestamp || null,
        m.like_count ?? null, m.comments_count ?? null,
        ins?.reach ?? null, ins?.views ?? null, ins?.saved ?? null, ins?.shares ?? null, ins?.total_interactions ?? null,
        img?.b64 ?? null, img?.type ?? null, Boolean(ins),
      ],
    );
  });
  await jq(`UPDATE jarvis_instagram_auth SET synced_at = now() WHERE id = 1`);
  return { ok: true, synced: items.length };
}

const PERIOD_DAYS = { week: 7, month: 30, quarter: 90, year: 365, all: 3650 };
const SORTS = {
  reach: "COALESCE(reach, interactions, COALESCE(likes,0) + COALESCE(comments,0))",
  views: "COALESCE(views, reach, 0)",
  likes: "COALESCE(likes, 0)",
  comments: "COALESCE(comments, 0)",
  engagement: "COALESCE(interactions, COALESCE(likes,0) + COALESCE(comments,0) + COALESCE(saved,0) + COALESCE(shares,0))",
};
const POST_COLS = "id, media_type, product_type, caption, permalink, posted_at, likes, comments, reach, views, saved, shares, interactions, (thumb IS NOT NULL) AS has_thumb";
const shape = (r) => {
  const { has_thumb, ...p } = r;
  return { ...p, kind: p.product_type === "REELS" ? "reel" : p.media_type === "CAROUSEL_ALBUM" ? "carousel" : p.media_type === "VIDEO" ? "video" : "photo", thumb_url: has_thumb ? `/api/jarvis/instagram?thumb=${encodeURIComponent(r.id)}` : null };
};

/**
 * Saved posts. sort: recent | top. metric (for top): reach | views | likes | comments | engagement.
 * period: week | month | quarter | year | all. Syncs from Instagram first (at most every 15 minutes).
 */
export async function listPosts({ sort = "recent", metric = "reach", period = "all", limit = 6, id = null, search = null } = {}) {
  const sync = await syncPosts().catch((err) => ({ ok: false, message: err.message }));
  const params = [];
  const where = [];
  if (id) { params.push(String(id)); where.push(`id = $${params.length}`); }
  if (search) { params.push(`%${String(search).slice(0, 80)}%`); where.push(`caption ILIKE $${params.length}`); }
  const days = PERIOD_DAYS[period] || PERIOD_DAYS.all;
  if (days < 3650) { params.push(new Date(Date.now() - days * DAY).toISOString()); where.push(`posted_at >= $${params.length}`); }
  params.push(Math.max(1, Math.min(24, Number(limit) || 6)));
  const order = sort === "top" ? `${SORTS[metric] || SORTS.reach} DESC, posted_at DESC` : "posted_at DESC";
  const rows = await jq(`SELECT ${POST_COLS} FROM jarvis_instagram_media ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${order} LIMIT $${params.length}`, params);
  return { connected: sync.ok !== false || rows.length > 0, sync, posts: rows.map(shape), sort, metric: SORTS[metric] ? metric : "reach", period: PERIOD_DAYS[period] ? period : "all" };
}

export async function thumbnail(id) {
  const [row] = await jq(`SELECT thumb_type, encode(thumb, 'base64') AS b64 FROM jarvis_instagram_media WHERE id = $1 AND thumb IS NOT NULL`, [String(id)]);
  return row ? { type: row.thumb_type || "image/jpeg", bytes: Buffer.from(row.b64, "base64") } : null;
}

// ---------- account insights ----------
/** Account-level numbers for the last week or month (whatever Instagram provides for this account). */
export async function accountInsights(period = "week") {
  const auth = await connect();
  if (auth.error) return notConnected(auth.error);
  const days = period === "month" ? 30 : 7;
  const until = Math.floor(Date.now() / 1000);
  const since = until - days * 86400;
  const out = { connected: true, period, days };
  const totals = ["reach", "views", "accounts_engaged", "total_interactions", "likes", "comments", "shares", "saves", "profile_links_taps"];
  await Promise.all([
    ...totals.map(async (metric) => {
      try {
        const j = await ig("me/insights", { metric, period: "day", metric_type: "total_value", since, until }, auth);
        out[metric] = val(j.data?.[0]);
      } catch (err) {
        if (err.code === 190) out.expired = true;
      }
    }),
    (async () => {
      try {
        const j = await ig("me/insights", { metric: "follows_and_unfollows", period: "day", metric_type: "total_value", breakdown: "follow_type", since, until }, auth);
        const res = j.data?.[0]?.total_value?.breakdowns?.[0]?.results || [];
        for (const r of res) {
          const t = String(r.dimension_values?.[0] || "").toUpperCase();
          if (t === "FOLLOWER") out.follows = r.value;
          if (t === "NON_FOLLOWER") out.unfollows = r.value;
        }
      } catch {}
    })(),
  ]);
  if (out.expired) return notConnected("expired");
  if (jarvisDbConfigured()) out.follower_growth = await followerGrowth(days).catch(() => null);
  return out;
}

/** Status for the HUD and the setup check (never includes the token) */
export async function instagramStatus() {
  const row = jarvisDbConfigured() ? await authRow().catch(() => null) : null;
  return {
    token_in_vercel: instagramConfigured(),
    connected: Boolean(row || instagramConfigured()),
    username: row?.username || null,
    expires_at: row?.expires_at || null,
    renewed_at: row?.refreshed_at || null,
    last_sync: row?.synced_at || null,
  };
}

/** The daily job: renew the token if due, save today's follower count, pull posts. */
export async function dailyJob() {
  const refresh = await refreshToken().catch((err) => ({ ok: false, reason: err.message }));
  const profile = await getProfile({ fresh: true }).catch((err) => ({ connected: false, message: err.message }));
  const posts = profile.connected ? await syncPosts({ force: true }).catch((err) => ({ ok: false, reason: err.message })) : { ok: false, skipped: true };
  return { refresh, followers: profile.followers ?? null, posts };
}
