// Everything Jarvis can know, all read-only: data/rsm-data.json plus live site stats from the database.
import { readFileSync } from "node:fs";
import { select, readonlyConfigured } from "./db-readonly.js";

// ---------- data/rsm-data.json ----------
let cache = null;
export function rsmData() {
  if (!cache) cache = JSON.parse(readFileSync(new URL("../../data/rsm-data.json", import.meta.url), "utf8"));
  return cache;
}
export const isPlaceholder = (d = rsmData()) => Boolean(d._placeholder);
export const sections = (d = rsmData()) => Object.keys(d).filter((k) => !k.startsWith("_"));

// A section counts as sample data only if it is marked that way itself
// (e.g. "website_visitors": { "sample": true, ... }, or listed in "_sample_sections"),
// or if the whole file is the placeholder. Everything else is real.
const flagged = (o) => Boolean(o && typeof o === "object" && (o.sample === true || o._sample === true || o.is_sample === true));
export function sectionIsSample(name, d = rsmData()) {
  if (isPlaceholder(d)) return true;
  const marked = [].concat(d._sample_sections || d.sample_sections || []);
  if (marked.includes(name)) return true;
  const v = d[name];
  if (flagged(v)) return true;
  const items = asList(v);
  return items.length > 0 && items.every(flagged);
}
// A section may be a plain list or an object holding the list ({ items: [...] })
function asList(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") for (const k of ["items", "records", "list", "entries", "data"]) if (Array.isArray(v[k])) return v[k];
  return [];
}
const list = (d, ...names) => {
  for (const n of names) if (d[n] !== undefined) return { name: n, items: asList(d[n]) };
  return { name: names[0], items: [] };
};
const statusOf = (x) => String((x && (x.status ?? x.stage ?? x.state)) || "").trim().toLowerCase();
const OPEN_DEAL = new Set(["pitching", "outreach", "prospecting"]);

// Signed athletes: status "Signed". Open deals: status Pitching, Outreach or Prospecting.
export function headline() {
  const d = rsmData();
  const athletes = list(d, "athletes");
  const deals = list(d, "deals");
  return {
    signedAthletes: athletes.items.filter((a) => statusOf(a) === "signed").length,
    openDeals: deals.items.filter((x) => OPEN_DEAL.has(statusOf(x))).length,
    athletesSample: sectionIsSample(athletes.name, d),
    dealsSample: sectionIsSample(deals.name, d),
  };
}

// ---------- live site stats (read-only database) ----------
const pct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);

export async function siteStats() {
  if (!readonlyConfigured()) return { available: false, reason: "The tracking database isn't connected yet." };
  const [totals] = await select(`
    WITH t AS (SELECT now() AS n,
               date_trunc('day', now() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York' AS today0)
    SELECT
      count(*) FILTER (WHERE created_at >= today0)::int AS today,
      count(*) FILTER (WHERE created_at >= today0 - interval '1 day' AND created_at < n - interval '1 day')::int AS yesterday_same_time,
      count(*) FILTER (WHERE created_at >= n - interval '7 days')::int AS week,
      count(*) FILTER (WHERE created_at >= n - interval '14 days' AND created_at < n - interval '7 days')::int AS prev_week,
      count(*) FILTER (WHERE created_at >= n - interval '30 days')::int AS month,
      count(*) FILTER (WHERE created_at >= n - interval '60 days' AND created_at < n - interval '30 days')::int AS prev_month
    FROM page_views CROSS JOIN t
    WHERE created_at >= n - interval '60 days'`);
  const [topPages, sources, devices] = await Promise.all([
    select(`SELECT path, count(*)::int AS visits FROM page_views WHERE created_at >= now() - interval '30 days'
            GROUP BY path ORDER BY visits DESC LIMIT 5`),
    select(`SELECT source, count(*)::int AS visits FROM page_views WHERE created_at >= now() - interval '30 days'
            GROUP BY source ORDER BY visits DESC`),
    select(`SELECT device, count(*)::int AS visits FROM page_views WHERE created_at >= now() - interval '30 days'
            GROUP BY device ORDER BY visits DESC`),
  ]);
  return {
    available: true,
    note: "Visits are page views. Visitors are anonymous, so unique people can't be told apart. Times are Eastern.",
    today: { visits: totals.today, vs_same_time_yesterday: totals.yesterday_same_time, change_pct: pct(totals.today, totals.yesterday_same_time) },
    last_7_days: { visits: totals.week, previous_7_days: totals.prev_week, change_pct: pct(totals.week, totals.prev_week) },
    last_30_days: { visits: totals.month, previous_30_days: totals.prev_month, change_pct: pct(totals.month, totals.prev_month) },
    top_pages_30_days: topPages,
    traffic_sources_30_days: sources,
    devices_30_days: devices,
  };
}

export async function recentInquiries(limit = 5) {
  if (!readonlyConfigured()) return { available: false, reason: "The tracking database isn't connected yet." };
  const n = Math.max(1, Math.min(20, Number(limit) || 5));
  const [rows, [week]] = await Promise.all([
    select(`SELECT name, email, phone, message, source, created_at FROM inquiries ORDER BY created_at DESC LIMIT $1`, [n]),
    select(`SELECT count(*)::int AS c FROM inquiries WHERE created_at >= now() - interval '7 days'`),
  ]);
  return {
    available: true,
    note: rows.length ? undefined : "No inquiries saved yet. The public site has no contact form; visitors reach RSM by Instagram DM.",
    new_last_7_days: week.c,
    inquiries: rows,
  };
}
