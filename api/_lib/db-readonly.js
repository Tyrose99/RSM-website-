// READ-ONLY database access for Jarvis. Three layers make sure Jarvis can never change data:
//  1. it connects with DATABASE_URL_READONLY, a Postgres login that only has SELECT permission
//  2. every query runs in a READ ONLY transaction
//  3. anything that isn't a single SELECT statement is rejected before it is sent
import { neon } from "@neondatabase/serverless";

let sql = null;
function client() {
  const url = process.env.DATABASE_URL_READONLY;
  if (!url) return null;
  if (!sql) sql = neon(url, { readOnly: true });
  return sql;
}

export const readonlyConfigured = () => Boolean(process.env.DATABASE_URL_READONLY);

export async function select(text, params = []) {
  const trimmed = text.trim();
  if (!/^(select|with)\b/i.test(trimmed) || trimmed.replace(/;\s*$/, "").includes(";")) {
    throw new Error("Jarvis only runs single SELECT queries");
  }
  const db = client();
  if (!db) throw new Error("DATABASE_URL_READONLY is not set");
  return db.query(trimmed, params);
}
