// Jarvis's own data: memories, tasks, business records, activity log, drafts, approvals, briefings.
// Every change is written to jarvis_activity with who asked for it.
import { jq } from "./db-jarvis.js";

export const nyDate = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // YYYY-MM-DD
// A calendar date from the database (comes back as midnight UTC) as YYYY-MM-DD, without shifting time zones
export const ymd = (d) => (d == null ? null : d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const cleanOwner = (o) => (["justin", "tyler", "jarvis"].includes(String(o || "").toLowerCase()) ? String(o).toLowerCase() : null);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

// ---------- activity log ----------
export async function logActivity(actor, action, summary, { entity = null, entityId = null, before = null, after = null } = {}) {
  await jq(
    `INSERT INTO jarvis_activity (actor, action, entity, entity_id, summary, before, after) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [actor, action, entity, entityId, summary, before && JSON.stringify(before), after && JSON.stringify(after)],
  );
}
export const listActivity = (limit = 20) =>
  jq(`SELECT id, actor, action, entity, entity_id, summary, created_at FROM jarvis_activity ORDER BY created_at DESC LIMIT $1`, [Math.min(100, limit)]);

// ---------- memories ----------
export const listMemories = (limit = 40) =>
  jq(`SELECT id, content, kind, due_date, created_by, created_at FROM jarvis_memories ORDER BY created_at DESC LIMIT $1`, [limit]);

export async function addMemory(actor, { content, kind = "fact", due_date = null }) {
  const k = ["fact", "decision", "deadline", "client"].includes(kind) ? kind : "fact";
  const [row] = await jq(
    `INSERT INTO jarvis_memories (content, kind, due_date, created_by) VALUES ($1,$2,$3,$4) RETURNING id, content, kind, due_date`,
    [String(content).slice(0, 1000), k, isDate(due_date) ? due_date : null, actor],
  );
  await logActivity(actor, "memory.remember", `Remembered: ${row.content}`, { entity: "memory", entityId: row.id, after: row });
  return row;
}

export async function forgetMemory(actor, { memory_id }) {
  const [row] = await jq(`DELETE FROM jarvis_memories WHERE id = $1 RETURNING id, content, kind, due_date`, [memory_id]);
  if (!row) return null;
  await logActivity(actor, "memory.forget", `Forgot: ${row.content}`, { entity: "memory", entityId: row.id, before: row });
  return row;
}

// ---------- tasks ----------
export async function listTasks({ owner = null, scope = "open" } = {}) {
  const where = [];
  const params = [];
  if (cleanOwner(owner)) { params.push(cleanOwner(owner)); where.push(`owner = $${params.length}`); }
  params.push(nyDate());
  const today = `$${params.length}::date`;
  if (scope === "today") where.push(`status = 'open' AND due_date IS NOT NULL AND due_date <= ${today}`);
  else if (scope === "overdue") where.push(`status = 'open' AND due_date < ${today}`);
  else if (scope === "done") where.push(`status = 'done'`);
  else if (scope !== "all") where.push(`status = 'open'`);
  return jq(
    `SELECT id, title, details, owner, due_date, status, completed_at, (due_date < ${today} AND status = 'open') AS overdue
     FROM jarvis_tasks ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY status, due_date NULLS LAST, created_at LIMIT 50`,
    params,
  );
}

export async function createTask(actor, { title, details = null, owner, due_date = null }) {
  const o = cleanOwner(owner) || actor;
  const [row] = await jq(
    `INSERT INTO jarvis_tasks (title, details, owner, due_date, created_by) VALUES ($1,$2,$3,$4,$5)
     RETURNING id, title, details, owner, due_date, status`,
    [String(title).slice(0, 300), details, o, isDate(due_date) ? due_date : null, actor],
  );
  await logActivity(actor, "task.create", `Task for ${o}: ${row.title}${row.due_date ? ` (due ${ymd(row.due_date)})` : ""}`, { entity: "task", entityId: row.id, after: row });
  return row;
}

export async function updateTask(actor, { task_id, title, details, owner, due_date, status }) {
  const [before] = await jq(`SELECT id, title, details, owner, due_date, status FROM jarvis_tasks WHERE id = $1`, [task_id]);
  if (!before) return null;
  const next = {
    title: title ?? before.title,
    details: details ?? before.details,
    owner: cleanOwner(owner) || before.owner,
    due_date: due_date === null ? null : isDate(due_date) ? due_date : before.due_date,
    status: status === "done" || status === "open" ? status : before.status,
  };
  const [row] = await jq(
    `UPDATE jarvis_tasks SET title=$2, details=$3, owner=$4, due_date=$5, status=$6, updated_at=now(),
       completed_at = CASE WHEN $6 = 'done' AND status <> 'done' THEN now() WHEN $6 = 'open' THEN NULL ELSE completed_at END
     WHERE id = $1 RETURNING id, title, details, owner, due_date, status`,
    [task_id, next.title, next.details, next.owner, next.due_date, next.status],
  );
  const action = row.status === "done" && before.status !== "done" ? "task.complete" : "task.update";
  await logActivity(actor, action, `${action === "task.complete" ? "Completed" : "Updated"} task: ${row.title}`, { entity: "task", entityId: row.id, before, after: row });
  return row;
}

// ---------- business records (imported from data/rsm-data.json) ----------
export const ENTITIES = {
  athletes: { table: "jarvis_athletes", label: "athlete", nameCol: "name", cols: ["name", "sport", "school", "status"] },
  deals: { table: "jarvis_deals", label: "deal", nameCol: "name", cols: ["name", "athlete", "business", "stage", "amount", "close_date"] },
  businesses: { table: "jarvis_businesses", label: "business", nameCol: "name", cols: ["name", "type", "instagram", "status"] },
  leads: { table: "jarvis_leads", label: "lead", nameCol: "name", cols: ["name", "type", "status", "why", "pitch"] },
  growth_moves: { table: "jarvis_growth_moves", label: "growth move", nameCol: "title", cols: ["title", "why", "first_step", "status"] },
};
const entity = (name) => {
  const e = ENTITIES[name];
  if (!e) throw new Error(`Unknown record type ${name}`);
  return e;
};

export async function listRecords(name, { search = null, limit = 50 } = {}) {
  const e = entity(name);
  const params = [Math.min(200, limit)];
  let where = "";
  if (search) { params.push(`%${search}%`); where = `WHERE ${e.nameCol} ILIKE $2 OR details::text ILIKE $2`; }
  return jq(`SELECT id, ${e.cols.join(", ")}, details, sample, updated_at FROM ${e.table} ${where} ORDER BY id LIMIT $1`, params);
}

export async function getRecord(name, id) {
  const e = entity(name);
  const [row] = await jq(`SELECT id, ${e.cols.join(", ")}, details, sample FROM ${e.table} WHERE id = $1`, [id]);
  return row || null;
}

// Split requested changes into real columns and extra fields kept in details
function splitChanges(e, changes) {
  const cols = {};
  const extra = {};
  for (const [k, v] of Object.entries(changes || {})) {
    if (k === "id" || k === "sample" || k === "details") continue;
    if (e.cols.includes(k)) cols[k] = v === "" ? null : v;
    else extra[k] = v;
  }
  return { cols, extra };
}

export async function updateRecord(actor, name, id, changes) {
  const e = entity(name);
  const before = await getRecord(name, id);
  if (!before) return null;
  const { cols, extra } = splitChanges(e, changes);
  const keys = Object.keys(cols);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  const params = [id, ...keys.map((k) => cols[k])];
  params.push(JSON.stringify(extra));
  sets.push(`details = details || $${params.length}::jsonb`, "updated_at = now()");
  const [after] = await jq(`UPDATE ${e.table} SET ${sets.join(", ")} WHERE id = $1 RETURNING id, ${e.cols.join(", ")}, details, sample`, params);
  const what = [...keys.map((k) => `${k} → ${cols[k]}`), ...Object.keys(extra).map((k) => `${k} → ${extra[k]}`)].join(", ");
  await logActivity(actor, `${name}.update`, `Updated ${e.label} "${after[e.nameCol]}": ${what}`, { entity: name, entityId: id, before, after });
  return after;
}

export async function addRecord(actor, name, fields) {
  const e = entity(name);
  const { cols, extra } = splitChanges(e, fields);
  if (!cols[e.nameCol]) throw new Error(`A ${e.label} needs a ${e.nameCol}`);
  const keys = Object.keys(cols);
  const [row] = await jq(
    `INSERT INTO ${e.table} (${[...keys, "details"].join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}, $${keys.length + 1}::jsonb)
     RETURNING id, ${e.cols.join(", ")}, details, sample`,
    [...keys.map((k) => cols[k]), JSON.stringify(extra)],
  );
  await logActivity(actor, `${name}.add`, `Added ${e.label} "${row[e.nameCol]}"`, { entity: name, entityId: row.id, after: row });
  return row;
}

// ---------- drafts + approvals (nothing ever leaves the app without an approval tap) ----------
export async function createDraft(actor, { channel, to_name = null, company = null, subject = null, body, source = null }) {
  const ch = channel === "instagram_dm" ? "instagram_dm" : "email";
  const [row] = await jq(
    `INSERT INTO jarvis_drafts (channel, to_name, company, subject, body, source, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, channel, to_name, company, subject, body`,
    [ch, to_name, company, ch === "email" ? subject : null, String(body || ""), source && JSON.stringify(source), actor],
  );
  await logActivity(actor, "draft.create", `Drafted ${ch === "email" ? "an email" : "an Instagram DM"}${to_name ? ` to ${to_name}` : ""}`, { entity: "draft", entityId: row.id, after: row });
  return row;
}

export async function getDraft(id) {
  const [row] = await jq(`SELECT id, channel, to_name, company, subject, body, updated_at FROM jarvis_drafts WHERE id = $1`, [id]);
  return row || null;
}

export async function updateDraft(actor, id, { subject, body, to_name, company }, { quiet = false } = {}) {
  const before = await getDraft(id);
  if (!before) return null;
  const [row] = await jq(
    `UPDATE jarvis_drafts SET subject = COALESCE($2, subject), body = COALESCE($3, body), to_name = COALESCE($4, to_name),
       company = COALESCE($5, company), updated_at = now() WHERE id = $1 RETURNING id, channel, to_name, company, subject, body`,
    [id, subject ?? null, body ?? null, to_name ?? null, company ?? null],
  );
  if (!quiet) await logActivity(actor, "draft.revise", `Revised draft #${id}`, { entity: "draft", entityId: id, before, after: row });
  return row;
}

export async function requestApproval(actor, { kind, draft_id = null, summary }) {
  const [row] = await jq(
    `INSERT INTO jarvis_approvals (kind, draft_id, summary, requested_by) VALUES ($1,$2,$3,$4) RETURNING id, kind, draft_id, summary, status, created_at`,
    [kind, draft_id, summary, actor],
  );
  await logActivity(actor, "approval.request", `Waiting for approval: ${summary}`, { entity: "approval", entityId: row.id, after: row });
  return row;
}

export const listApprovals = (status = "pending") =>
  jq(
    `SELECT a.id, a.kind, a.draft_id, a.summary, a.status, a.requested_by, a.decided_by, a.decided_at, a.result, a.created_at,
            d.channel, d.to_name, d.subject
     FROM jarvis_approvals a LEFT JOIN jarvis_drafts d ON d.id = a.draft_id
     WHERE ($1 = 'all' OR a.status = $1) ORDER BY a.created_at DESC LIMIT 30`,
    [status],
  );

// Records the decision. Sending is not wired up yet (no Gmail / Instagram connection),
// so an approval never sends anything; when a connection exists it will act only on "approved".
export async function decideApproval(actor, id, decision) {
  const status = decision === "approve" ? "approved" : "rejected";
  const result = status === "approved" ? "Approved. Not sent: Gmail / Instagram isn't connected yet." : "Rejected.";
  const [row] = await jq(
    `UPDATE jarvis_approvals SET status = $2, decided_by = $3, decided_at = now(), result = $4 WHERE id = $1 AND status = 'pending'
     RETURNING id, kind, draft_id, summary, status, result`,
    [id, status, actor, result],
  );
  if (row) await logActivity(actor, `approval.${status}`, `${status === "approved" ? "Approved" : "Rejected"}: ${row.summary}`, { entity: "approval", entityId: id, after: row });
  return row || null;
}

// ---------- briefings ----------
export async function getBriefing(date = nyDate()) {
  const [row] = await jq(`SELECT for_date, text, data, created_at FROM jarvis_briefings WHERE for_date = $1`, [date]);
  return row || null;
}
export async function saveBriefing(date, text, data) {
  await jq(
    `INSERT INTO jarvis_briefings (for_date, text, data) VALUES ($1,$2,$3) ON CONFLICT (for_date) DO UPDATE SET text = EXCLUDED.text, data = EXCLUDED.data, created_at = now()`,
    [date, text, JSON.stringify(data)],
  );
}
