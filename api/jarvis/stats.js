// GET /api/jarvis/stats — numbers for the glass panels. Login required (see /middleware.js).
import { headline, siteStats, recentInquiries } from "../_lib/jarvis-data.js";

export async function GET() {
  const out = { ...headline(), visitsWeek: null, visitsWeekChange: null, newInquiries: null, db: "not connected" };
  try {
    const [s, q] = await Promise.all([siteStats(), recentInquiries(1)]);
    if (s.available) {
      out.visitsWeek = s.last_7_days.visits;
      out.visitsWeekChange = s.last_7_days.change_pct;
      out.newInquiries = q.new_last_7_days;
      out.db = "ok";
    }
  } catch {
    out.db = "error";
  }
  return Response.json(out, { headers: { "Cache-Control": "no-store" } });
}
