// Jarvis's brain: system prompts, tools and the Claude tool-use loop (with specialists behind the scenes).
import Anthropic from "@anthropic-ai/sdk";
import { AGENTS } from "../../jarvis/agents.js";
import { siteStats, recentInquiries } from "./jarvis-data.js";
import * as store from "./jarvis-store.js";
import { buildCard, cardSummary, CARD_TYPES } from "./cards.js";
import { findSiteMedia } from "./site-media.js";
import * as insta from "./instagram.js";

export const MODEL = "claude-sonnet-5-5";
const MAX_TOOL_ROUNDS = 8;
const RECORD_TYPES = Object.keys(store.ENTITIES);

// ---------- Anthropic client ----------
// The key as pasted into Vercel, minus stray spaces, quotes or a leading "ANTHROPIC_API_KEY="
export function anthropicKey() {
  return String(process.env.ANTHROPIC_API_KEY || "")
    .trim()
    .replace(/^ANTHROPIC_API_KEY\s*=\s*/i, "")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
}
// Safe description of the key for the logs: only its type prefix and length, never the key
export const keyShape = (k) => `key type: ${(k.match(/^sk-ant-[a-z]+/) || ["unrecognized"])[0]}, length ${k.length}`;

export function anthropicClient() {
  const apiKey = anthropicKey();
  if (!apiKey) return null;
  // The SDK sends the key as "Authorization: Bearer <key>". ANTHROPIC_WORKSPACE_ID is optional.
  const workspace = String(process.env.ANTHROPIC_WORKSPACE_ID || "").trim();
  return new Anthropic({ apiKey, ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}) });
}

export function friendlyError(err) {
  const status = err?.status;
  const message = String(err?.error?.error?.message || err?.message || "");
  console.error("jarvis brain error", status, message, status === 401 ? `(${keyShape(anthropicKey())})` : "");
  if (status === 401) return "My Anthropic key isn't being accepted, sir. It needs to be replaced in Vercel.";
  if (/credit balance/i.test(message)) return "My Anthropic account is out of credit, sir. Top it up in the Anthropic console and I'll be right back.";
  if (status === 429) return "I'm being rate limited, sir. Give me a moment and ask again.";
  return "I hit a snag reaching my brain, sir. Give it another try in a moment.";
}

// "yes", "yep, do it", "confirm", "go ahead" ...
const AFFIRMATIVE = /^\s*(yes|yeah|yep|yup|sure|confirm(ed)?|correct|do it|go ahead|go for it|that'?s right|ok(ay)?|please do|absolutely|make it so)\b/i;

// ---------- tools ----------
const WEB_SEARCH = { type: "web_search_20260209", name: "web_search", max_uses: 5 };
const obj = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const str = (description, extra = {}) => ({ type: "string", description, ...extra });

function tools({ withSpecialists }) {
  const list = [
    { name: "get_site_stats", description: "Live public-website traffic: visits today, last 7 and 30 days with the previous period and % change, top pages, traffic sources and devices.", input_schema: obj({}) },
    { name: "get_recent_inquiries", description: "Recent contact inquiries saved by the website (the site has no contact form yet, so this is usually empty).", input_schema: obj({ limit: { type: "integer", description: "1 to 20" } }) },
    {
      name: "query_records",
      description: "Read RSM's business records: athletes, deals, businesses, leads, growth_moves. Use search to filter by name or any text. Returns ids you need for update_record.",
      input_schema: obj({ type: str("Record type", { enum: RECORD_TYPES }), search: str("Optional text to match") }, ["type"]),
    },
    {
      name: "show_card",
      description:
        "Show a glass card on Justin/Tyler's screen while you talk. Use it whenever you answer about RSM data. Types: traffic (period), money (period: week|month|quarter|year), deals (search), leads (search), athlete (name), tasks (owner, scope: today|open|overdue|done|all), memories, growth, activity, approvals, email (draft_id, or channel for the inbox placeholder), table (entity, search), player (name: an athlete with their site photo, IG and open deals), business (name: a business with its logo, what we do for them and status), instagram_post (latest by default; post_id or search), instagram_top (period, metric), instagram_followers (period). Returns the card's data so you can speak about it.",
      input_schema: obj({
        type: str("Card type", { enum: CARD_TYPES }),
        period: str("For traffic/money/instagram_top/instagram_followers", { enum: ["week", "month", "quarter", "year"] }),
        search: str("For deals/leads/table, or caption text for instagram_post"),
        name: str("For athlete, player or business"),
        post_id: str("For instagram_post: a post id from get_instagram_posts"),
        metric: str("For instagram_top", { enum: ["reach", "views", "likes", "comments", "engagement"] }),
        owner: str("For tasks", { enum: ["justin", "tyler", "jarvis"] }),
        scope: str("For tasks", { enum: ["today", "open", "overdue", "done", "all"] }),
        entity: str("For table", { enum: RECORD_TYPES }),
        draft_id: { type: "integer", description: "For email: the draft to show" },
        channel: str("For email", { enum: ["email", "instagram_dm"] }),
      }, ["type"]),
    },
    {
      name: "get_site_media",
      description: "Look up the athletes (players) and businesses shown on the public RSM website: name, photo, sport, school/team, Instagram handle, and the business tagline. Leave query empty to list them all.",
      input_schema: obj({ query: str("Name or handle to look for"), kind: str("What to look for", { enum: ["player", "business", "any"] }) }),
    },
    { name: "get_instagram_profile", description: "Live numbers for RSM's Instagram, @rsm.collective: followers, following, post count, and follower growth over the last 7 and 30 days from Jarvis's daily snapshots.", input_schema: obj({}) },
    {
      name: "get_instagram_posts",
      description: "RSM's Instagram posts and reels with date, caption, likes, comments, reach, views, saves and shares. sort recent for the latest posts, top for the best ones in a period. Returns post ids for show_card instagram_post.",
      input_schema: obj({
        sort: str("recent or top", { enum: ["recent", "top"] }),
        metric: str("What 'best' means for top (default reach)", { enum: ["reach", "views", "likes", "comments", "engagement"] }),
        period: str("Time window", { enum: ["week", "month", "quarter", "year", "all"] }),
        limit: { type: "integer", description: "1 to 12" },
        search: str("Optional caption text to match"),
      }),
    },
    {
      name: "get_instagram_insights",
      description: "Account insights for @rsm.collective over the last week or month: reach, views, accounts engaged, interactions, new follows and unfollows (when Instagram provides them), plus follower growth from Jarvis's daily snapshots.",
      input_schema: obj({ period: str("week or month", { enum: ["week", "month"] }) }),
    },
    {
      name: "remember",
      description: "Save something to long-term memory, shared by Justin and Tyler. Use when asked to remember something, and on your own for decisions, deadlines and client details worth keeping.",
      input_schema: obj({ content: str("The fact, in one clear sentence"), kind: str("Kind", { enum: ["fact", "decision", "deadline", "client"] }), due_date: str("YYYY-MM-DD, for deadlines") }, ["content"]),
    },
    { name: "forget_memory", description: "Delete one memory by id (when asked to forget something). Memory ids are listed in your instructions.", input_schema: obj({ memory_id: { type: "integer" } }, ["memory_id"]) },
    {
      name: "create_task",
      description: "Create a task. owner is justin, tyler or jarvis ('me'/'my' means whoever is talking). Convert relative dates like 'Monday' to YYYY-MM-DD using today's date.",
      input_schema: obj({ title: str("Short task title"), details: str("Optional details"), owner: str("Owner", { enum: ["justin", "tyler", "jarvis"] }), due_date: str("YYYY-MM-DD") }, ["title", "owner"]),
    },
    {
      name: "update_task",
      description: "Change or complete a task (status done marks it complete). Find the id with list_tasks first.",
      input_schema: obj({ task_id: { type: "integer" }, title: str("New title"), details: str("New details"), owner: str("Owner", { enum: ["justin", "tyler", "jarvis"] }), due_date: str("YYYY-MM-DD"), status: str("Status", { enum: ["open", "done"] }) }, ["task_id"]),
    },
    {
      name: "list_tasks",
      description: "List tasks. scope today = open tasks due today or earlier.",
      input_schema: obj({ owner: str("Owner", { enum: ["justin", "tyler", "jarvis"] }), scope: str("Scope", { enum: ["today", "open", "overdue", "done", "all"] }) }),
    },
    {
      name: "update_record",
      description:
        "Change a business record (e.g. move a deal to a new stage). ALWAYS confirm out loud first: say exactly what you'll change and ask 'Shall I?'. Only call this with confirmed=true after the user's latest message says yes.",
      input_schema: obj({ type: str("Record type", { enum: RECORD_TYPES }), id: { type: "integer" }, changes: { type: "object", description: "Field → new value, e.g. {\"stage\": \"Negotiating\"}" }, confirmed: { type: "boolean" } }, ["type", "id", "changes", "confirmed"]),
    },
    {
      name: "add_record",
      description: "Add a new business record. Same rule: confirm out loud first, then call with confirmed=true after the user says yes.",
      input_schema: obj({ type: str("Record type", { enum: RECORD_TYPES }), fields: { type: "object", description: "Field → value; needs a name (title for growth_moves)" }, confirmed: { type: "boolean" } }, ["type", "fields", "confirmed"]),
    },
    {
      name: "draft_message",
      description: "Write an email or Instagram DM draft and show it on screen for editing. Nothing is sent.",
      input_schema: obj({ channel: str("Channel", { enum: ["email", "instagram_dm"] }), to_name: str("Recipient"), company: str("Their company"), subject: str("Email subject"), body: str("The message") }, ["channel", "body"]),
    },
    {
      name: "revise_draft",
      description: "Rewrite a draft that is on screen (e.g. 'make it shorter', 'more professional', 'mention the free first promo'). Start from the current text given in the user's message.",
      input_schema: obj({ draft_id: { type: "integer" }, subject: str("New subject"), body: str("The full new message") }, ["draft_id", "body"]),
    },
    {
      name: "request_send",
      description: "Queue a draft for Justin/Tyler to approve. Nothing is ever sent without their tap; email and Instagram aren't connected yet, so approving only records the decision.",
      input_schema: obj({ draft_id: { type: "integer" } }, ["draft_id"]),
    },
  ];
  if (withSpecialists) {
    list.push({
      name: "ask_specialist",
      description: "Hand a question to a specialist, who answers the user directly in their own voice: scout for leads, outreach and pitches; strategist for growth, pricing and strategy.",
      input_schema: obj({ specialist: str("Who", { enum: ["scout", "strategist"] }), question: str("The question, with any context they need") }, ["specialist", "question"]),
    });
  }
  return [...list, WEB_SEARCH];
}

// ---------- system prompt ----------
export async function systemPrompt(agentId, user, { direct = false } = {}) {
  const agent = AGENTS[agentId];
  const now = new Date();
  const today = now.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long", year: "numeric", month: "long", day: "numeric" });
  let memories = [];
  try { memories = await store.listMemories(40); } catch {}
  const who = user === "tyler" ? "Tyler" : "Justin";
  return [
    `You are ${agent.name}, the AI employee of RSM (Rose Sports Marketing), a South Florida sports marketing agency run by Justin and Tyler.`,
    `You are talking with ${who} by voice. Today is ${today} (${store.nyDate(now)}), Eastern Time.`,
    agent.persona,
    agentId !== "jarvis" && !direct ? "Jarvis brought you in for this question; answer it yourself." : "",
    "",
    "How to answer:",
    "- Your reply is spoken aloud: 2 to 5 short sentences of plain conversational English. No markdown, lists, emoji, links or code.",
    "- Only state numbers, names and details that came from a tool result in this conversation. If you don't have it, say so. Never invent numbers.",
    "- When you talk about RSM data, also call show_card so it appears on screen. Keep speaking short; the card has the detail.",
    "- If a result is marked sample, say it's sample data.",
    "- Use web_search for current outside information (businesses, NIL news, events, competitors). Say where it came from in a few words, like \"according to the Sun Sentinel\".",
    "- Instagram (@rsm.collective) is read-only: you can look at followers, posts and insights, but you can't post, comment or DM. For \"our last post\" use show_card instagram_post; for the best post use instagram_top; for follower growth use instagram_followers. Reach and views can be missing for some posts; say so rather than guessing.",
    "- When asked to show an athlete or business from the website (\"show me Chris Brown\"), use show_card player or business.",
    "- Tasks, memories and drafts: just do them. Business records (athletes, deals, businesses, leads, growth moves): confirm the exact change out loud first and only change it after a yes.",
    "- Save decisions, deadlines and client details with remember when they come up, without being asked.",
    "- Nothing leaves the app (emails, DMs, posts, deletes) without Justin or Tyler tapping Approve. You can draft and queue, never send.",
    "- After answering, you may offer one short next step, like \"Want me to add that as a task?\"",
    agentId === "jarvis" && !direct ? "- For leads, outreach and pitches, use ask_specialist with scout. For growth, pricing and strategy, use ask_specialist with strategist." : "",
    "",
    memories.length
      ? `Memories (shared by Justin and Tyler; id: content):\n${memories.map((m) => `#${m.id} [${m.kind}${m.due_date ? `, due ${store.ymd(m.due_date)}` : ""}] ${m.content}`).join("\n")}`
      : "No memories saved yet.",
  ].filter((l) => l !== "").join("\n");
}

// ---------- tool execution ----------
async function runTool(name, input, ctx) {
  const actor = ctx.user;
  switch (name) {
    case "get_site_stats": return siteStats();
    case "get_recent_inquiries": return recentInquiries(input.limit || 5);
    case "get_site_media": return findSiteMedia(input.query || "", input.kind || "any");
    case "get_instagram_profile": {
      const p = await insta.getProfile();
      if (!p.connected) return p;
      const [w, m] = await Promise.all([insta.followerGrowth(7), insta.followerGrowth(30)]);
      return { ...p, gained_last_7_days: w.gained, gained_last_30_days: m.gained, tracking_since: m.tracking_since, note: w.series.length < 2 ? "Daily follower tracking only started recently, so growth may not be known yet." : null };
    }
    case "get_instagram_posts": {
      const r = await insta.listPosts({ sort: input.sort || "recent", metric: input.metric || "reach", period: input.period || "all", limit: Math.min(12, input.limit || 6), search: input.search || null });
      if (!r.connected) return r.sync;
      return { sort: r.sort, metric: r.metric, period: r.period, posts: r.posts.map(({ thumb_url, ...p }) => ({ ...p, caption: p.caption ? p.caption.slice(0, 300) : null })) };
    }
    case "get_instagram_insights": return insta.accountInsights(input.period === "month" ? "month" : "week");
    case "query_records": {
      const rows = await store.listRecords(input.type, { search: input.search || null, limit: 30 });
      return { type: input.type, count: rows.length, sample_rows: rows.filter((r) => r.sample).length, rows };
    }
    case "show_card": {
      const { type, ...args } = input;
      const c = await buildCard(type, args);
      ctx.cards.push(c);
      return cardSummary(c);
    }
    case "remember": return { saved: await store.addMemory(actor, input) };
    case "forget_memory": {
      const row = await store.forgetMemory(actor, input);
      return row ? { forgotten: row } : { error: "No memory with that id." };
    }
    case "create_task": {
      const task = await store.createTask(actor, input);
      ctx.cards.push(await buildCard("tasks", { owner: task.owner, scope: "open" }));
      return { created: task };
    }
    case "update_task": {
      const task = await store.updateTask(actor, input);
      if (!task) return { error: "No task with that id." };
      ctx.cards.push(await buildCard("tasks", { owner: task.owner, scope: "open" }));
      return { updated: task };
    }
    case "list_tasks": return { tasks: await store.listTasks({ owner: input.owner || null, scope: input.scope || "open" }) };
    case "update_record":
    case "add_record": {
      if (!input.confirmed || !ctx.userConfirmed) {
        return { error: "Not changed. Say exactly what you will change and ask the user to confirm; only call again after they say yes." };
      }
      const row = name === "update_record"
        ? await store.updateRecord(actor, input.type, input.id, input.changes)
        : await store.addRecord(actor, input.type, input.fields);
      if (!row) return { error: "No record with that id." };
      return { [name === "update_record" ? "updated" : "added"]: row };
    }
    case "draft_message": {
      const draft = await store.createDraft(actor, input);
      ctx.cards.push(await buildCard("email", { draft_id: draft.id }));
      return { draft };
    }
    case "revise_draft": {
      const before = await store.getDraft(input.draft_id);
      const draft = await store.updateDraft(actor, input.draft_id, { subject: input.subject, body: input.body });
      if (!draft) return { error: "No draft with that id." };
      const c = await buildCard("email", { draft_id: draft.id });
      c.previous = { subject: before.subject, body: before.body };
      ctx.cards.push(c);
      return { draft };
    }
    case "request_send": {
      const draft = await store.getDraft(input.draft_id);
      if (!draft) return { error: "No draft with that id." };
      const kind = draft.channel === "email" ? "send_email" : "send_instagram_dm";
      const approval = await store.requestApproval(actor, { kind, draft_id: draft.id, summary: `${draft.channel === "email" ? "Email" : "Instagram DM"} to ${draft.to_name || "recipient"}${draft.subject ? `: ${draft.subject}` : ""}` });
      ctx.cards.push(await buildCard("approvals"));
      return { queued: approval, note: "Waiting for an Approve tap. Email and Instagram aren't connected yet, so nothing can be sent." };
    }
    default: throw new Error(`Unknown tool ${name}`);
  }
}

// ---------- the loop ----------
async function loop(client, agentId, user, messages, ctx, { withSpecialists, direct }) {
  const system = await systemPrompt(agentId, user, { direct });
  const toolList = tools({ withSpecialists });
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 6000,
      output_config: { effort: "low" }, // quick, spoken answers
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default", // if a safety classifier declines, the API retries on a fallback model
      system,
      tools: toolList,
      messages,
    });
    if (response.stop_reason === "refusal") return { speaker: agentId, text: "I can't help with that one, sir." };
    if (response.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: response.content }); continue; }
    const uses = response.content.filter((b) => b.type === "tool_use");
    if (response.stop_reason === "tool_use" && uses.length && round < MAX_TOOL_ROUNDS) {
      // a specialist takes over and answers in their own voice
      const handoff = uses.find((u) => u.name === "ask_specialist");
      if (handoff && withSpecialists) {
        const sp = AGENTS[handoff.input.specialist] ? handoff.input.specialist : "scout";
        const sub = await loop(client, sp, user, [...ctx.history, { role: "user", content: `${ctx.userText}\n\n(Jarvis's note: ${handoff.input.question})` }], ctx, { withSpecialists: false, direct: false });
        return { ...sub, speaker: sp };
      }
      messages.push({ role: "assistant", content: response.content });
      const results = await Promise.all(uses.map(async (t) => {
        try {
          const out = await runTool(t.name, t.input || {}, ctx);
          return { type: "tool_result", tool_use_id: t.id, content: typeof out === "string" ? out : JSON.stringify(out) };
        } catch (err) {
          return { type: "tool_result", tool_use_id: t.id, is_error: true, content: `That didn't work: ${err.message}` };
        }
      }));
      messages.push({ role: "user", content: results });
      continue;
    }
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join(" ");
    return { speaker: agentId, text: spoken(text) || "I'm drawing a blank on that one, sir. Try asking another way." };
  }
  return { speaker: agentId, text: "That took me too many steps, sir. Try a narrower question." };
}

const spoken = (s) => s.replace(/[*_#`>]+/g, "").replace(/^\s*[-•]\s+/gm, "").replace(/\s+\n/g, "\n").replace(/\s{2,}/g, " ").trim();

/**
 * Answer one user turn.
 * @param {object} p
 * @param {string} p.user        justin | tyler
 * @param {string} p.text        what the user said
 * @param {Array}  p.history     [{ role, text }] plain-text conversation so far
 * @param {string|null} p.direct talking directly to a specialist (scout | strategist), or null for Jarvis
 * @param {Array}  p.drafts      drafts open on screen: [{ id, subject, body }] (with any typed edits)
 */
export async function answer({ user, text, history = [], direct = null, drafts = [] }) {
  const client = anthropicClient();
  if (!client) return { speaker: direct || "jarvis", text: "My brain isn't connected yet, sir. The Anthropic key still needs to be added in Vercel.", cards: [] };
  const hist = history
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string" && m.text.trim())
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.text.slice(0, 2000) }));
  while (hist.length && hist[0].role !== "user") hist.shift();
  const onScreen = drafts.filter((d) => d && d.id).map((d) => `[Draft #${d.id} on screen${d.subject ? ` — subject: ${d.subject}` : ""} — body:\n${String(d.body || "").slice(0, 3000)}]`).join("\n");
  const userText = onScreen ? `${text}\n\n${onScreen}` : text;
  const lastAssistant = [...hist].reverse().find((m) => m.role === "assistant");
  const ctx = {
    user,
    cards: [],
    history: hist,
    userText,
    userConfirmed: AFFIRMATIVE.test(text) && Boolean(lastAssistant && /\?/.test(lastAssistant.content)),
  };
  const agentId = direct && AGENTS[direct] ? direct : "jarvis";
  try {
    const out = await loop(client, agentId, user, [...hist, { role: "user", content: userText }], ctx, { withSpecialists: agentId === "jarvis", direct: Boolean(direct) });
    return { speaker: out.speaker, text: out.text, cards: ctx.cards };
  } catch (err) {
    return { speaker: agentId, text: friendlyError(err), cards: ctx.cards, error: true };
  }
}

// ---------- daily briefing ----------
export async function briefingFacts(today = store.nyDate()) {
  const { dailySeries } = await import("./jarvis-data.js");
  const [tasks, memories, deals, moves, visits] = await Promise.all([
    store.listTasks({ scope: "today" }),
    store.listMemories(100),
    store.listRecords("deals", { limit: 200 }),
    store.listRecords("growth_moves", { limit: 20 }),
    dailySeries("page_views", 2).catch(() => null),
  ]);
  const in7 = new Date(Date.parse(today) + 7 * 864e5).toISOString().slice(0, 10);
  const deadlines = memories.filter((m) => m.due_date && store.ymd(m.due_date) >= today && store.ymd(m.due_date) <= in7);
  const stale = Date.now() - 7 * 864e5;
  const followUps = deals.filter((d) => /pitch|outreach|prospect|negotiat/i.test(d.stage || "") && new Date(d.updated_at).getTime() < stale);
  const move = moves.find((m) => !/done|complete/i.test(m.status || "")) || null;
  return {
    date: today,
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, owner: t.owner, due_date: store.ymd(t.due_date), overdue: t.overdue })),
    deadlines: deadlines.map((m) => ({ content: m.content, due_date: store.ymd(m.due_date) })),
    visitors_yesterday: visits ? visits[0].count : null,
    deals_needing_follow_up: followUps.map((d) => ({ name: d.name, stage: d.stage, sample: d.sample })),
    growth_move: move && { title: move.title, first_step: move.first_step, sample: move.sample },
  };
}

export async function composeBriefing(facts) {
  const client = anthropicClient();
  const fallback = () => {
    const parts = [`Good morning, sir. You have ${facts.tasks.length} task${facts.tasks.length === 1 ? "" : "s"} on the list today.`];
    if (facts.deadlines.length) parts.push(`${facts.deadlines.length} deadline${facts.deadlines.length === 1 ? "" : "s"} this week.`);
    if (facts.visitors_yesterday != null) parts.push(`The website had ${facts.visitors_yesterday} visits yesterday.`);
    if (facts.deals_needing_follow_up.length) parts.push(`${facts.deals_needing_follow_up.length} deal${facts.deals_needing_follow_up.length === 1 ? " needs" : "s need"} a follow-up.`);
    if (facts.growth_move) parts.push(`Growth move of the day: ${facts.growth_move.title}.`);
    return parts.join(" ");
  };
  if (!client) return fallback();
  try {
    const r = await client.beta.messages.create({
      model: MODEL, max_tokens: 2000, output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      system: `${AGENTS.jarvis.persona}\nWrite a spoken morning briefing of 4 to 6 short sentences from the facts given. Start with "Good morning, sir." Plain speech, no lists or markdown. Only use the facts; say "sample" for anything marked sample. Cover: today's tasks, deadlines this week, website visitors yesterday, deals needing follow-up, and the growth move.`,
      messages: [{ role: "user", content: JSON.stringify(facts) }],
    });
    return spoken(r.content.filter((b) => b.type === "text").map((b) => b.text).join(" ")) || fallback();
  } catch (err) {
    friendlyError(err);
    return fallback();
  }
}
