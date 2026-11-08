// POST /api/jarvis/card { type, ...args } — open a card from a tile tap. Login required (see /middleware.js).
import { buildCard, CARD_TYPES } from "../_lib/cards.js";

export async function POST(request) {
  const { type, ...args } = await request.json().catch(() => ({}));
  if (!CARD_TYPES.includes(type)) return Response.json({ error: "Unknown card type" }, { status: 400 });
  try {
    return Response.json({ card: await buildCard(type, args) });
  } catch (err) {
    console.error("card", err.message);
    return Response.json({ error: "Couldn't load that card" }, { status: 500 });
  }
}
