// Read-write database access for Jarvis's OWN tables only (jarvis_*), through DATABASE_URL_JARVIS.
// That login (jarvis_app) has no permission on the site-tracking tables; those stay read-only
// for Jarvis through db-readonly.js.
import { neon } from "@neondatabase/serverless";

let sql = null;
export const jarvisDbConfigured = () => Boolean(process.env.DATABASE_URL_JARVIS);

export async function jq(text, params = []) {
  if (!/\bjarvis_\w+/.test(text)) throw new Error("Jarvis can only write to jarvis_* tables");
  const url = process.env.DATABASE_URL_JARVIS;
  if (!url) throw new Error("DATABASE_URL_JARVIS is not set");
  if (!sql) sql = neon(url);
  return sql.query(text, params);
}
