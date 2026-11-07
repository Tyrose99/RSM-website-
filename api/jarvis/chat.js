// POST /api/jarvis/chat  { agent, text, history: [{ role: "user"|"assistant", text }] }
// -> { agent, reply, switched }
// Login required (see /middleware.js). Claude gets the agent's personality plus three read-only tools.
import Anthropic from "@anthropic-ai/sdk";
import { AGENTS, DEFAULT_AGENT, detectSwitch } from "../../jarvis/agents.js";
import { rsmData, isPlaceholder, sectionIsSample, sections, siteStats, recentInquiries } from "../_lib/jarvis-data.js";
import { readSession } from "../_lib/session.js";

const MODEL = "claude-sonnet-5-5";
const MAX_TOOL_ROUNDS = 5;

const TOOLS = () => [
  {
    name: "get_site_stats",
    description:
      "Live public-website traffic from the tracking database: visits today, last 7 days and last 30 days, each with the previous period and % change, plus top pages, traffic sources (instagram, google, direct, other) and device types.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    name: "get_recent_inquiries",
    description: "The most recent contact inquiries saved in the database, newest first, and how many came in over the last 7 days.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "integer", description: "How many inquiries to return, 1 to 20." } },
      required: ["limit"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "get_rsm_data",
    description:
      "RSM's own business data: athletes, deals, clients, outreach leads and growth moves. Ask for one section at a time, or 'all'.",
    input_schema: {
      type: "object",
      properties: { section: { type: "string", enum: [...sections(), "all"] } },
      required: ["section"],
      additionalProperties: false,
    },
    strict: true,
  },
];

async function runTool(name, input) {
  if (name === "get_site_stats") return siteStats();
  if (name === "get_recent_inquiries") return recentInquiries(input.limit);
  if (name === "get_rsm_data") {
    const d = rsmData();
    const names = input.section === "all" ? sections(d) : [input.section];
    return {
      // which of the returned sections are sample data (the rest is real)
      sample_sections: names.filter((n) => sectionIsSample(n, d)),
      ...(isPlaceholder(d) ? { note: d._note } : {}),
      ...Object.fromEntries(names.map((n) => [n, d[n] ?? null])),
    };
  }
  throw new Error(`Unknown tool ${name}`);
}

function systemPrompt(agentId, user) {
  const agent = AGENTS[agentId];
  const today = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long", year: "numeric", month: "long", day: "numeric" });
  return [
    `You are ${agent.name}, a private voice assistant for RSM (Rose Sports Marketing), a South Florida sports marketing agency run by Justin and Tyler.`,
    `You are talking with ${user === "tyler" ? "Tyler" : "Justin"} by voice. Today is ${today}, Eastern Time.`,
    agent.persona,
    "How to answer:",
    "- Your reply is spoken aloud. Answer in 2 to 5 short sentences of plain conversational English. No markdown, lists, headings, emoji, links or code.",
    "- Get facts with the tools. Only state numbers, names and details that came from a tool result in this conversation. If the data doesn't have it, say so plainly. Never guess or invent numbers.",
    "- Tool results list any sample_sections. When you use data from one of those sections, say it's sample data. Everything else is real; don't call it sample.",
    "- Site visits are page views from anonymous visitors, so they aren't unique people.",
    "- Lead with the most important point.",
    "- The team: Jarvis (main assistant), Lead Scout (outreach leads and pitch angles), Growth Strategist (growth moves). The user switches by saying things like \"let me talk to Scout\" or \"back to Jarvis\". If a question fits another agent better, answer briefly and suggest switching.",
  ].join("\n");
}

// The key as pasted into Vercel, minus stray spaces, quotes or a leading "ANTHROPIC_API_KEY="
function anthropicKey() {
  return String(process.env.ANTHROPIC_API_KEY || "")
    .trim()
    .replace(/^ANTHROPIC_API_KEY\s*=\s*/i, "")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
}
// Safe description of the key for the logs: only its type prefix (e.g. "sk-ant-usr") and length, never the key
const keyShape = (k) => `key type: ${(k.match(/^sk-ant-[a-z]+/) || ["unrecognized"])[0]}, length ${k.length}`;

const spoken = (s) => s.replace(/[*_#`>]+/g, "").replace(/^\s*[-•]\s+/gm, "").replace(/\s+\n/g, "\n").trim();

export async function POST(request) {
  const user = await readSession(request);
  const body = await request.json().catch(() => ({}));
  const text = String(body.text || "").trim().slice(0, 2000);
  let agent = AGENTS[body.agent] ? body.agent : DEFAULT_AGENT;
  if (!text) return Response.json({ error: "Say something first." }, { status: 400 });

  // Agent switching: "let me talk to Scout", "get me the Strategist", "back to Jarvis"
  const target = detectSwitch(text);
  const switched = Boolean(target && target !== agent);
  if (target) agent = target;
  if (target && !/\?/.test(text) && text.split(/\s+/).length <= 8) {
    return Response.json({ agent, switched, reply: AGENTS[agent].greeting });
  }

  const apiKey = anthropicKey();
  if (!apiKey) {
    return Response.json({ agent, switched, reply: "My brain isn't connected yet, sir. The Anthropic key still needs to be added in Vercel." });
  }

  // Conversation memory for this session comes from the page, as plain text turns
  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string" && m.text.trim())
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.text.slice(0, 2000) }));
  while (history.length && history[0].role !== "user") history.shift();
  const messages = [...history, { role: "user", content: text }];

  // The SDK sends the key as "Authorization: Bearer <key>", which Console keys (including user and
  // service-account keys) accept. ANTHROPIC_WORKSPACE_ID is optional: set it in Vercel only if the
  // key needs a specific workspace.
  const workspace = String(process.env.ANTHROPIC_WORKSPACE_ID || "").trim();
  const client = new Anthropic({ apiKey, ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}) });
  const tools = TOOLS();
  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 4000,
        output_config: { effort: "low" }, // quick, spoken answers
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default", // if a safety classifier declines, the API retries on a fallback model
        system: systemPrompt(agent, user),
        tools,
        messages,
      });
      if (response.stop_reason === "refusal") {
        return Response.json({ agent, switched, reply: "I can't help with that one, sir." });
      }
      const toolUses = response.content.filter((b) => b.type === "tool_use");
      if (response.stop_reason === "tool_use" && toolUses.length && round < MAX_TOOL_ROUNDS) {
        messages.push({ role: "assistant", content: response.content });
        const results = await Promise.all(
          toolUses.map(async (t) => {
            try {
              return { type: "tool_result", tool_use_id: t.id, content: JSON.stringify(await runTool(t.name, t.input)) };
            } catch (err) {
              return { type: "tool_result", tool_use_id: t.id, is_error: true, content: `Couldn't get that data: ${err.message}` };
            }
          }),
        );
        messages.push({ role: "user", content: results });
        continue;
      }
      if (response.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: response.content });
        continue;
      }
      const reply = spoken(response.content.filter((b) => b.type === "text").map((b) => b.text).join(" "));
      return Response.json({ agent, switched, reply: reply || "I'm drawing a blank on that one, sir. Try asking another way." });
    }
    return Response.json({ agent, switched, reply: "That took me too many steps, sir. Try a narrower question." });
  } catch (err) {
    const status = err?.status;
    const message = String(err?.error?.error?.message || err?.message || "");
    console.error("jarvis chat error", status, message, status === 401 ? `(${keyShape(apiKey)})` : "");
    let reply = "I hit a snag reaching my brain, sir. Give it another try in a moment.";
    if (status === 401) reply = "My Anthropic key isn't being accepted, sir. It needs to be replaced in Vercel.";
    else if (/credit balance/i.test(message)) reply = "My Anthropic account is out of credit, sir. Top it up in the Anthropic console and I'll be right back.";
    else if (status === 429) reply = "I'm being rate limited, sir. Give me a moment and ask again.";
    return Response.json({ agent, switched, reply }, { status: 502 });
  }
}
