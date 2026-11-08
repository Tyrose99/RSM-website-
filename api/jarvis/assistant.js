// POST /api/jarvis/assistant  { text, direct, history, drafts }
// -> { speaker, direct, reply, cards, switched }
// Login required (see /middleware.js). Jarvis answers, bringing in Scout / the Strategist behind the scenes.
import { AGENTS, detectSwitch } from "../../jarvis/agents.js";
import { readSession } from "../_lib/session.js";
import { answer } from "../_lib/brain.js";

export async function POST(request) {
  const user = await readSession(request);
  const body = await request.json().catch(() => ({}));
  const text = String(body.text || "").trim().slice(0, 2000);
  if (!text) return Response.json({ error: "Say something first." }, { status: 400 });
  let direct = AGENTS[body.direct] && body.direct !== "jarvis" ? body.direct : null;

  // "let me talk to Scout directly" stays with Scout until "back to Jarvis"
  const target = detectSwitch(text);
  const switched = Boolean(target) && (target === "jarvis" ? direct !== null : target !== direct);
  if (target) direct = target === "jarvis" ? null : target;
  if (target && !/\?/.test(text) && text.split(/\s+/).length <= 9) {
    const speaker = direct || "jarvis";
    return Response.json({ speaker, direct, switched, reply: AGENTS[speaker].greeting, cards: [] });
  }

  const out = await answer({
    user,
    text,
    history: Array.isArray(body.history) ? body.history : [],
    direct,
    drafts: Array.isArray(body.drafts) ? body.drafts.slice(0, 3) : [],
  });
  return Response.json({ speaker: out.speaker, direct, switched, reply: out.text, cards: out.cards }, { status: out.error ? 502 : 200 });
}
