// POST /api/jarvis/tasks  { task_id, done } — tick a task on a card. Login required (see /middleware.js).
import { readSession } from "../_lib/session.js";
import { updateTask } from "../_lib/jarvis-store.js";

export async function POST(request) {
  const user = await readSession(request);
  const body = await request.json().catch(() => ({}));
  const task = await updateTask(user, { task_id: Number(body.task_id), status: body.done ? "done" : "open" });
  return task ? Response.json({ task }) : Response.json({ error: "No such task" }, { status: 404 });
}
