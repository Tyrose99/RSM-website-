// GET /api/jarvis/speak?agent=jarvis&text=...  -> streamed MP3 from ElevenLabs (Flash model)
// Login required (see /middleware.js). Streaming lets the browser start playing within a moment.
import { AGENTS, TTS_MODEL } from "../../jarvis/agents.js";

export async function GET(request) {
  const url = new URL(request.url);
  const agent = AGENTS[url.searchParams.get("agent")] || AGENTS.jarvis;
  const text = (url.searchParams.get("text") || "").trim().slice(0, 1200);
  if (!text) return Response.json({ error: "Nothing to say" }, { status: 400 });
  if (!process.env.ELEVENLABS_API_KEY) return Response.json({ error: "ELEVENLABS_API_KEY is not set" }, { status: 503 });

  const r = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${agent.voiceId}/stream?output_format=mp3_44100_64`,
    {
      method: "POST",
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: TTS_MODEL }),
    },
  ).catch(() => null);
  if (!r || !r.ok || !r.body) {
    console.error("elevenlabs error", r?.status);
    return Response.json({ error: "Voice service unavailable" }, { status: 502 });
  }
  return new Response(r.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
}
