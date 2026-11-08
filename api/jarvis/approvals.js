// GET  /api/jarvis/approvals            — pending approvals
// POST /api/jarvis/approvals { id, decision: "approve" | "reject" }  or  { draft_id } to queue a draft
// Login required (see /middleware.js). Approving never sends anything until Gmail / Instagram are connected.
import { readSession } from "../_lib/session.js";
import { listApprovals, decideApproval, requestApproval, getDraft } from "../_lib/jarvis-store.js";

export async function GET() {
  return Response.json({ approvals: await listApprovals("pending") }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request) {
  const user = await readSession(request);
  const b = await request.json().catch(() => ({}));
  // { draft_id } queues a draft for approval (the "Queue for approval" button)
  if (b.draft_id) {
    const draft = await getDraft(Number(b.draft_id));
    if (!draft) return Response.json({ error: "No such draft" }, { status: 404 });
    const approval = await requestApproval(user, {
      kind: draft.channel === "email" ? "send_email" : "send_instagram_dm",
      draft_id: draft.id,
      summary: `${draft.channel === "email" ? "Email" : "Instagram DM"} to ${draft.to_name || "recipient"}${draft.subject ? `: ${draft.subject}` : ""}`,
    });
    return Response.json({ approval });
  }
  if (!["approve", "reject"].includes(b.decision)) return Response.json({ error: "decision must be approve or reject" }, { status: 400 });
  const row = await decideApproval(user, Number(b.id), b.decision);
  return row ? Response.json({ approval: row }) : Response.json({ error: "Not found or already decided" }, { status: 404 });
}
