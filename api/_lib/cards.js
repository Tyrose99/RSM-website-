// Pop-up cards for the /jarvis screen. Every card is built here from real database rows (never from
// numbers the model writes), and is marked sample when any of its rows come from sample data.
import { dailySeries, trafficBreakdown } from "./jarvis-data.js";
import { listRecords, listTasks, listMemories, listActivity, listApprovals, getDraft, ymd } from "./jarvis-store.js";

let seq = 0;
const card = (type, title, data, sample = false) => ({ id: `${type}-${Date.now().toString(36)}-${(seq++).toString(36)}`, type, title, sample: Boolean(sample), ...data });
const anySample = (rows) => (rows || []).some((r) => r && r.sample);
const WON = /won|closed|signed|paid|complete/i;
const num = (v) => (v == null || v === "" ? null : Number(v));

const PERIODS = { week: 7, month: 30, quarter: 90, year: 365 };

export const CARD_TYPES = ["traffic", "money", "deals", "leads", "athlete", "tasks", "memories", "growth", "activity", "approvals", "email", "table"];

export async function buildCard(type, args = {}) {
  switch (type) {
    case "traffic": {
      const days = PERIODS[args.period] || 7;
      const [series, breakdown] = await Promise.all([dailySeries("page_views", Math.min(days, 90)), trafficBreakdown(days)]);
      if (!series) return card("traffic", "Website traffic", { unavailable: "The tracking database isn't connected yet." });
      const total = series.reduce((s, d) => s + d.count, 0);
      return card("traffic", `Website visits · last ${days} days`, { total, series, ...breakdown });
    }
    case "money": {
      const period = PERIODS[args.period] ? args.period : "month";
      const days = PERIODS[period];
      const deals = await listRecords("deals", { limit: 200 });
      const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
      const won = deals.filter((d) => WON.test(d.stage || "") && num(d.amount) != null && (!d.close_date || ymd(d.close_date) >= since));
      const total = won.reduce((s, d) => s + num(d.amount), 0);
      // bucket by week (week/month periods) or month (quarter/year)
      const byMonth = days > 31;
      const buckets = {};
      for (const d of won) {
        const dt = d.close_date ? new Date(ymd(d.close_date) + "T12:00:00Z") : new Date(d.updated_at);
        const key = byMonth ? dt.toISOString().slice(0, 7) : new Date(dt.getTime() - ((dt.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
        buckets[key] = (buckets[key] || 0) + num(d.amount);
      }
      const series = Object.keys(buckets).sort().map((k) => ({ day: k, count: Math.round(buckets[k]) }));
      const noAmounts = !deals.some((d) => num(d.amount) != null);
      return card("money", `Money · last ${period}`, {
        total, currency: "USD", series, deals: won.map((d) => ({ name: d.name, amount: num(d.amount), stage: d.stage, close_date: d.close_date, sample: d.sample })),
        note: noAmounts ? "No deal amounts are recorded yet." : won.length ? null : "No closed deals with amounts in this period.",
      }, anySample(won));
    }
    case "deals": {
      const deals = await listRecords("deals", { search: args.search || null, limit: 200 });
      const stages = {};
      for (const d of deals) {
        const s = d.stage || "No stage";
        stages[s] = stages[s] || { stage: s, count: 0, amount: 0 };
        stages[s].count++;
        stages[s].amount += num(d.amount) || 0;
      }
      return card("deals", "Deal pipeline", { stages: Object.values(stages), deals: deals.map(({ details, updated_at, ...d }) => ({ ...d, amount: num(d.amount), notes: details?.notes ?? null })) }, anySample(deals));
    }
    case "leads": {
      const leads = await listRecords("leads", { search: args.search || null, limit: 20 });
      return card("leads", args.search ? `Leads · ${args.search}` : "Outreach leads", { leads: leads.map(({ details, updated_at, ...l }) => ({ ...l, extra: details })) }, anySample(leads));
    }
    case "athlete": {
      const [athlete] = await listRecords("athletes", { search: args.name || args.search || "", limit: 1 });
      if (!athlete) return card("athlete", "Athlete", { unavailable: `No athlete found matching "${args.name || args.search || ""}".` });
      const deals = await listRecords("deals", { search: athlete.name, limit: 20 });
      return card("athlete", athlete.name, { athlete, deals: deals.map(({ details, updated_at, ...d }) => ({ ...d, amount: num(d.amount) })) }, athlete.sample || anySample(deals));
    }
    case "tasks": {
      const tasks = await listTasks({ owner: args.owner || null, scope: args.scope || "open" });
      const who = args.owner ? `${args.owner[0].toUpperCase()}${args.owner.slice(1)}'s` : "Open";
      return card("tasks", args.scope === "today" ? `${args.owner ? who + " tasks" : "Tasks"} · today` : `${who} tasks`, { tasks });
    }
    case "memories":
      return card("memories", "What I remember", { memories: await listMemories(40) });
    case "growth": {
      const moves = await listRecords("growth_moves", { limit: 20 });
      return card("growth", "Growth moves", { moves: moves.map(({ details, updated_at, ...m }) => ({ ...m, extra: details })) }, anySample(moves));
    }
    case "activity":
      return card("activity", "Activity log", { activity: await listActivity(25) });
    case "approvals":
      return card("approvals", "Waiting for your approval", { approvals: await listApprovals("pending") });
    case "email": {
      if (args.draft_id) {
        const draft = await getDraft(args.draft_id);
        if (draft) return card("email", draft.channel === "email" ? "Email draft" : "Instagram DM draft", { draft, connected: false });
      }
      return card("email", args.channel === "instagram_dm" ? "Instagram inbox" : "Email inbox", {
        placeholder: true,
        connected: false,
        note: `${args.channel === "instagram_dm" ? "Instagram" : "Gmail"} isn't connected yet, so there are no real messages to show. This is a placeholder.`,
      }, true);
    }
    case "table": {
      const entity = ["athletes", "deals", "businesses", "leads", "growth_moves"].includes(args.entity) ? args.entity : "businesses";
      const rows = await listRecords(entity, { search: args.search || null, limit: 50 });
      const columns = rows.length ? Object.keys(rows[0]).filter((k) => !["id", "details", "sample", "updated_at"].includes(k)) : [];
      return card("table", entity.replace("_", " ").replace(/^./, (c) => c.toUpperCase()), { columns, rows: rows.map(({ details, updated_at, ...r }) => r) }, anySample(rows));
    }
    default:
      throw new Error(`Unknown card type ${type}`);
  }
}

// A compact version of a card for Claude to talk about
export function cardSummary(c) {
  const { id, ...rest } = c;
  return JSON.stringify(rest).slice(0, 6000);
}
