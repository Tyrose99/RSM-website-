// Read-only view of the athlete and business cards on the public RSM site.
// The source of truth is the site's own clients.js and businesses.js (window.RSM_CLIENTS / RSM_BUSINESSES).
// Jarvis only READS them; it never changes the public site. Photos are the site's public /assets files.
// If the files can't be read in a function bundle, data/site-media.json (a snapshot made by
// data/build-site-media.mjs) is used instead.
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import snapshot from "../../data/site-media.json" with { type: "json" };

const IMG = "/assets/img/";
const VID = "/assets/video/";
const asset = (dir, f) => (f ? dir + String(f).replace(/^\/+/, "") : null);
const handle = (h) => (h ? String(h).trim().replace(/^@/, "") || null : null);

// Run a site list file in an empty sandbox and return what it puts on window
export function evalList(src, key) {
  const sandbox = { window: {} };
  vm.runInNewContext(String(src), sandbox, { timeout: 200 });
  const list = sandbox.window[key];
  return Array.isArray(list) ? JSON.parse(JSON.stringify(list)) : [];
}

export function normalize({ clients = [], businesses = [] }) {
  const players = clients.map((c) => {
    const detail = c.detail || "";
    const parts = detail.split(/\s*[·,]\s*/).filter(Boolean);
    return {
      kind: "player",
      name: c.name,
      photo: asset(IMG, c.photo),
      sport: c.sport || null,
      detail: detail || null,
      position: parts.length > 1 ? parts[0] : null,
      school: parts.length > 1 ? parts.slice(1).join(", ") : parts[0] || null,
      instagram: handle(c.instagram),
      video: asset(VID, c.video),
      poster: asset(IMG, c.poster),
      slug: String(c.photo || c.name).replace(/\.[a-z0-9]+$/i, ""),
    };
  });
  const biz = businesses.map((b) => ({
    kind: "business",
    name: b.name,
    logo: asset(IMG, b.logo),
    tag: b.tag || null,
    instagram: handle(b.instagram),
    video: asset(VID, b.video),
    poster: asset(IMG, b.poster),
    slug: String(b.logo || b.name).replace(/\.[a-z0-9]+$/i, ""),
  }));
  return { players, businesses: biz };
}

let cache = null;
export async function siteMedia() {
  if (cache && Date.now() - cache.at < 5 * 60e3) return cache.data;
  let data;
  try {
    const [c, b] = await Promise.all([
      readFile(new URL("../../clients.js", import.meta.url), "utf8"),
      readFile(new URL("../../businesses.js", import.meta.url), "utf8"),
    ]);
    data = { ...normalize({ clients: evalList(c, "RSM_CLIENTS"), businesses: evalList(b, "RSM_BUSINESSES") }), source: "site files" };
  } catch {
    data = { ...normalize(snapshot), source: "snapshot" };
  }
  cache = { at: Date.now(), data };
  return data;
}

// Loose name matching: "Chris Brown", "chris", "Moe" (matches moe-masoud.webp), "@kosportstv", "LLMD"
const words = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
function score(item, q) {
  const qw = words(q);
  if (!qw.length) return 0;
  const hay = new Set([...words(item.name), ...words(item.slug), ...words(item.instagram), ...words(item.tag)]);
  const full = words(item.name).join(" ");
  if (full === qw.join(" ") || item.instagram === qw.join("")) return 100;
  let s = 0;
  for (const w of qw) {
    if (hay.has(w)) s += 10;
    else if ([...hay].some((h) => h.startsWith(w) && w.length >= 3)) s += 5;
  }
  return s / qw.length;
}

/** Look up players and/or businesses shown on the public site. kind: player | business | any */
export async function findSiteMedia(query = "", kind = "any") {
  const { players, businesses, source } = await siteMedia();
  const pool = kind === "player" ? players : kind === "business" ? businesses : [...players, ...businesses];
  if (!String(query).trim()) return { source, matches: pool };
  const ranked = pool.map((it) => ({ it, s: score(it, query) })).filter((x) => x.s >= 5).sort((a, b) => b.s - a.s);
  return { source, matches: ranked.map((x) => x.it) };
}
