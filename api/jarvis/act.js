// Small taps and edits from the /jarvis screen, in one function (the Hobby plan allows 12 functions per deployment).
// Login required (see /middleware.js).
//   GET  /api/jarvis/act                                  -> pending approvals
//   POST /api/jarvis/act { action: "card", type, ...args } -> open a card from a tile tap
//   POST { action: "task", task_id, done }                -> tick / untick a task
//   POST { action: "draft", id, subject, body }           -> save typed edits to a draft
//   POST { action: "queue", draft_id }                    -> queue a draft for approval
//   POST { action: "decide", id, decision }               -> approve / reject (never sends: Gmail / Instagram aren't connected)
import { readSession } from "../_lib/session.js";
import { buildCard, CARD_TYPES } from "../_lib/cards.js";
import { updateTask, updateDraft, logActivity, getDraft, requestApproval, listApprovals, decideApproval } from "../_lib/jarvis-store.js";

const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  return json({ approvals: await listApprovals("pending") });
}

export async function POST(request) {
  const user = await readSession(request);
  const { action, ...b } = await request.json().catch(() => ({}));
  try {
    switch (action) {
      case "card": {
        const { type, ...args } = b;
        if (!CARD_TYPES.includes(type)) return json({ error: "Unknown card type" }, 400);
        return json({ card: await buildCard(type, args) });
      }
      case "task": {
        const task = await updateTask(user, { task_id: Number(b.task_id), status: b.done ? "done" : "open" });
        return task ? json({ task }) : json({ error: "No such task" }, 404);
      }
      case "draft": {
        const draft = await updateDraft(user, Number(b.id), { subject: b.subject ?? null, body: typeof b.body === "string" ? b.body.slice(0, 10000) : null }, { quiet: true });
        if (!draft) return json({ error: "No such draft" }, 404);
        await logActivity(user, "draft.edit", `Edited draft #${draft.id} by hand`, { entity: "draft", entityId: draft.id });
        return json({ draft });
      }
      case "queue": {
        const draft = await getDraft(Number(b.draft_id));
        if (!draft) return json({ error: "No such draft" }, 404);
        const approval = await requestApproval(user, {
          kind: draft.channel === "email" ? "send_email" : "send_instagram_dm",
          draft_id: draft.id,
          summary: `${draft.channel === "email" ? "Email" : "Instagram DM"} to ${draft.to_name || "recipient"}${draft.subject ? `: ${draft.subject}` : ""}`,
        });
        return json({ approval });
      }
      case "decide": {
        if (!["approve", "reject"].includes(b.decision)) return json({ error: "decision must be approve or reject" }, 400);
        const row = await decideApproval(user, Number(b.id), b.decision);
        return row ? json({ approval: row }) : json({ error: "Not found or already decided" }, 404);
      }
      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    console.error("jarvis act", action, err.message);
    return json({ error: "That didn't work" }, 500);
  }
}
