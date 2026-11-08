// Refreshes data/site-media.json, the fallback copy of the site's athlete and business cards that Jarvis
// uses if it can't read clients.js / businesses.js directly. Read-only: it never changes the public files.
// Run: node data/build-site-media.mjs
import { readFile, writeFile } from "node:fs/promises";
import { evalList } from "../api/_lib/site-media.js";

const root = new URL("../", import.meta.url);
const clients = evalList(await readFile(new URL("clients.js", root), "utf8"), "RSM_CLIENTS");
const businesses = evalList(await readFile(new URL("businesses.js", root), "utf8"), "RSM_BUSINESSES");
await writeFile(new URL("data/site-media.json", root), JSON.stringify({ clients, businesses }, null, 2) + "\n");
console.log(`site-media.json: ${clients.length} athletes, ${businesses.length} businesses`);
