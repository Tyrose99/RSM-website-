// POST /api/jarvis/drafts  { id, subject, body } — save typed edits to a draft. Login required (see /middleware.js).
import { readSession } from "../_lib/session.js";
import { updateDraft, logActivity } from "../_lib/jarvis-store.js";

export async function POST(request) {
  const user = await readSession(request);
  const b = await request.json().catch(() => ({}));
  const draft = await updateDraft(user, Number(b.id), { subject: b.subject ?? null, body: typeof b.body === "string" ? b.body.slice(0, 10000) : null }, { quiet: true });
  if (!draft) return Response.json({ error: "No such draft" }, { status: 404 });
  await logActivity(user, "draft.edit", `Edited draft #${draft.id} by hand`, { entity: "draft", entityId: draft.id });
  return Response.json({ draft });
}
