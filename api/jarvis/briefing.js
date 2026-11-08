// GET /api/jarvis/briefing — today's briefing (weekdays), made on the first request of the day.
// Login required (see /middleware.js).
import { getBriefing, saveBriefing, nyDate } from "../_lib/jarvis-store.js";
import { briefingFacts, composeBriefing } from "../_lib/brain.js";
import { jarvisDbConfigured } from "../_lib/db-jarvis.js";

export async function GET() {
  const today = nyDate();
  const weekday = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short" });
  if (["Sat", "Sun"].includes(weekday)) return Response.json({ available: false, reason: "weekend" });
  if (!jarvisDbConfigured()) return Response.json({ available: false, reason: "not set up" });
  try {
    let b = await getBriefing(today);
    if (!b) {
      const facts = await briefingFacts(today);
      const text = await composeBriefing(facts);
      await saveBriefing(today, text, facts);
      b = { for_date: today, text, data: facts };
    }
    return Response.json({ available: true, date: today, text: b.text, facts: b.data }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("briefing", err.message);
    return Response.json({ available: false, reason: "error" }, { status: 500 });
  }
}
