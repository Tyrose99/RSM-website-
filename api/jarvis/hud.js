// GET /api/jarvis/hud — live numbers + sparklines for the side rails. Login required (see /middleware.js).
import { readSession } from "../_lib/session.js";
import { dailySeries, siteStats } from "../_lib/jarvis-data.js";
import { readonlyConfigured } from "../_lib/db-readonly.js";
import { listRecords, listTasks, listApprovals } from "../_lib/jarvis-store.js";
import { jarvisDbConfigured } from "../_lib/db-jarvis.js";

const OPEN_DEAL = /^(pitching|outreach|prospecting)$/i;
const safe = (p) => p.catch((err) => { console.error("hud", err.message); return null; });

export async function GET(request) {
  const user = await readSession(request);
  const [visits, inquiries, stats, athletes, deals, tasks, approvals] = await Promise.all([
    safe(dailySeries("page_views", 14)),
    safe(dailySeries("inquiries", 14)),
    safe(siteStats()),
    jarvisDbConfigured() ? safe(listRecords("athletes", { limit: 200 })) : null,
    jarvisDbConfigured() ? safe(listRecords("deals", { limit: 200 })) : null,
    jarvisDbConfigured() ? safe(listTasks({ scope: "today" })) : null,
    jarvisDbConfigured() ? safe(listApprovals("pending")) : null,
  ]);
  const signed = athletes && athletes.filter((a) => String(a.status || "").trim().toLowerCase() === "signed");
  const open = deals && deals.filter((d) => OPEN_DEAL.test(String(d.stage || "").trim()));
  const byStage = {};
  for (const d of open || []) byStage[d.stage] = (byStage[d.stage] || 0) + 1;
  const week = (s) => (s ? s.slice(-7).reduce((n, d) => n + d.count, 0) : null);
  return Response.json({
    user,
    db: { site: readonlyConfigured() && Boolean(visits), jarvis: jarvisDbConfigured() && Boolean(deals) },
    visitors: { week: week(visits), change: stats?.available ? stats.last_7_days.change_pct : null, series: visits },
    inquiries: { week: week(inquiries), series: inquiries },
    openDeals: open && { count: open.length, byStage, sample: open.some((d) => d.sample) },
    signedAthletes: signed && { count: signed.length, sample: signed.some((a) => a.sample) },
    tasksToday: tasks && { count: tasks.length, items: tasks.slice(0, 4).map((t) => ({ id: t.id, title: t.title, owner: t.owner, overdue: t.overdue })) },
    approvalsPending: approvals ? approvals.length : null,
  }, { headers: { "Cache-Control": "no-store" } });
}
