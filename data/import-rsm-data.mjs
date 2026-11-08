// Import data/rsm-data.json into Jarvis's business tables (jarvis_athletes, jarvis_deals, jarvis_businesses,
// jarvis_leads, jarvis_growth_moves). Only those five Jarvis tables are cleared and refilled; nothing else is touched.
// Run: DATABASE_URL_JARVIS=... node data/import-rsm-data.mjs [path/to/rsm-data.json]
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const file = process.argv[2] || new URL("./rsm-data.json", import.meta.url);
const data = JSON.parse(readFileSync(file, "utf8"));
const sql = neon(process.env.DATABASE_URL_JARVIS);

const asList = (v) => (Array.isArray(v) ? v : v && typeof v === "object" ? ["items", "records", "list", "entries", "data"].map((k) => v[k]).find(Array.isArray) || [] : []);
const flagged = (o) => Boolean(o && typeof o === "object" && (o.sample === true || o._sample === true || o.is_sample === true));
const markedSections = [].concat(data._sample_sections || data.sample_sections || []);
const sectionSample = (key) => Boolean(data._placeholder) || markedSections.includes(key) || flagged(data[key]);
let used = new Set(); // field names consumed for the current record (everything else goes to details)
const pick = (o, ...keys) => { keys.forEach((k) => used.add(k)); for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k]; return null; };
const money = (v) => { if (v == null) return null; const n = Number(String(v).replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : null; };
const date = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null);

const SPECS = [
  { keys: ["athletes"], table: "jarvis_athletes", map: (r) => ({ name: pick(r, "name", "athlete"), sport: pick(r, "sport"), school: pick(r, "school", "team", "college", "detail"), status: pick(r, "status", "stage") }) },
  { keys: ["deals"], table: "jarvis_deals", map: (r) => ({ name: pick(r, "name", "deal", "title"), athlete: pick(r, "athlete"), business: pick(r, "business", "brand", "client", "company"), stage: pick(r, "stage", "status"), amount: money(pick(r, "amount", "value", "price", "revenue")), close_date: date(pick(r, "close_date", "closed", "date")) }) },
  { keys: ["businesses", "clients"], table: "jarvis_businesses", map: (r) => ({ name: pick(r, "name", "business", "company"), type: pick(r, "type", "category", "industry"), instagram: pick(r, "instagram", "ig", "handle"), status: pick(r, "status", "stage") }) },
  { keys: ["leads"], table: "jarvis_leads", map: (r) => ({ name: pick(r, "name", "business", "company", "lead"), type: pick(r, "type", "category"), status: pick(r, "status", "stage"), why: pick(r, "why", "reason", "fit"), pitch: pick(r, "pitch", "angle", "pitch_angle") }) },
  { keys: ["growth_moves", "growthMoves", "growth"], table: "jarvis_growth_moves", map: (r) => ({ title: pick(r, "title", "name", "move"), why: pick(r, "why", "reason"), first_step: pick(r, "first_step", "firstStep", "next_step"), status: pick(r, "status", "stage") }) },
];

let total = 0;
for (const spec of SPECS) {
  const key = spec.keys.find((k) => data[k] !== undefined);
  const rows = key ? asList(data[key]) : [];
  await sql.query(`DELETE FROM ${spec.table}`);
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    used = new Set();
    const cols = spec.map(r);
    const details = Object.fromEntries(Object.entries(r).filter(([k]) => !["sample", "_sample", "is_sample"].includes(k) && !used.has(k)));
    const names = Object.keys(cols);
    await sql.query(
      `INSERT INTO ${spec.table} (${[...names, "details", "sample"].join(", ")}) VALUES (${names.map((_, i) => `$${i + 1}`).join(", ")}, $${names.length + 1}::jsonb, $${names.length + 2})`,
      [...names.map((n) => cols[n]), JSON.stringify(details), sectionSample(key) || flagged(r)],
    );
    total++;
  }
  console.log(`${spec.table}: ${rows.length} rows${key && sectionSample(key) ? " (sample)" : ""}`);
}
await sql.query(`INSERT INTO jarvis_activity (actor, action, summary) VALUES ('jarvis', 'data.import', $1)`, [`Imported ${total} records from rsm-data.json${data._placeholder ? " (placeholder file)" : ""}`]);
