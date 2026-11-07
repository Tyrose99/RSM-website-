// Jarvis voice assistant page. Talks to /api/jarvis/* (login required).
import { AGENTS, DEFAULT_AGENT } from "/jarvis/agents.js";

const $ = (id) => document.getElementById(id);
const body = document.body;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

let agent = DEFAULT_AGENT;
let state = "idle"; // idle | listening | thinking | speaking
const history = []; // conversation memory for this session: [{ role, text }]

// ---------------- state + agent ----------------
const STATUS = {
  idle: "Tap the mic or press space",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking — tap to interrupt",
};
function setState(s) {
  state = s;
  body.dataset.state = s;
  $("status").textContent = STATUS[s];
}
function setAgent(id) {
  if (!AGENTS[id]) return;
  agent = id;
  body.dataset.agent = id;
  const [r, g, b] = AGENTS[id].tint;
  document.documentElement.style.setProperty("--tint", `${r}, ${g}, ${b}`);
  $("agent-name").textContent = AGENTS[id].name;
  $("typed").placeholder = `Type to ${AGENTS[id].name}…`;
  document.querySelectorAll(".agents button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.agent === id)));
}

// ---------------- transcript ----------------
let interimEl = null;
function line(who, text, cls = "") {
  const el = document.createElement("div");
  el.className = `line ${cls}`;
  if (who) {
    const b = document.createElement("b");
    b.textContent = who;
    el.append(b);
  }
  el.append(document.createTextNode(text));
  $("transcript").append(el);
  $("transcript").scrollTop = $("transcript").scrollHeight;
  return el;
}
function showInterim(text) {
  if (!interimEl) interimEl = line("You", "", "interim");
  interimEl.lastChild.textContent = text;
  $("transcript").scrollTop = $("transcript").scrollHeight;
}
function clearInterim() {
  if (interimEl) interimEl.remove();
  interimEl = null;
}

// ---------------- API ----------------
async function api(path, opts) {
  const r = await fetch(path, { credentials: "same-origin", ...opts });
  if (r.status === 401) { location.reload(); throw new Error("logged out"); }
  return r;
}

async function loadStats() {
  try {
    const s = await (await api("/api/jarvis/stats")).json();
    $("s-visits").textContent = s.visitsWeek ?? "—";
    const ch = s.visitsWeekChange;
    $("s-visits-sub").innerHTML =
      s.db !== "ok" ? "tracking not connected" :
      ch == null ? "vs last week: new" : `<span class="${ch >= 0 ? "up" : "down"}">${ch >= 0 ? "▲" : "▼"} ${Math.abs(ch)}%</span> vs last week`;
    $("s-inq").textContent = s.newInquiries ?? "—";
    $("s-ath").textContent = s.signedAthletes;
    $("s-ath-sub").textContent = s.athletesSample ? "sample data" : "";
    $("s-deals").textContent = s.openDeals;
    $("s-deals-sub").textContent = s.dealsSample ? "sample data" : "";
  } catch {}
}

async function ask(text) {
  text = text.trim();
  if (!text) return;
  clearInterim();
  line("You", text);
  setState("thinking");
  try {
    const r = await api("/api/jarvis/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent, text, history: history.slice(-20) }),
    });
    const j = await r.json();
    if (j.agent && j.agent !== agent) setAgent(j.agent);
    const reply = j.reply || j.error || "Something went wrong.";
    history.push({ role: "user", text }, { role: "assistant", text: reply });
    line(AGENTS[agent].name, reply, "ai");
    speak(reply);
  } catch (e) {
    if (e.message !== "logged out") { line("", "Couldn't reach Jarvis. Check the connection and try again.", "note"); setState("idle"); }
  }
}

// ---------------- voice out (streamed MP3) + analyser for the orb ----------------
const audio = new Audio();
audio.preload = "auto";
let audioCtx = null, analyser = null, levelData = null;
function unlockAudio() {
  // iOS needs audio to be started from a tap once; after that the page can play replies
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const src = audioCtx.createMediaElementSource(audio);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      levelData = new Uint8Array(analyser.fftSize);
      src.connect(analyser);
      analyser.connect(audioCtx.destination);
    } catch { audioCtx = null; }
  }
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
}
function speak(text) {
  setState("speaking");
  audio.src = `/api/jarvis/speak?agent=${encodeURIComponent(agent)}&text=${encodeURIComponent(text.slice(0, 1200))}`;
  audio.play().catch(() => setState("idle"));
}
audio.addEventListener("ended", () => state === "speaking" && setState("idle"));
audio.addEventListener("error", () => {
  if (state === "speaking") { line("", "Voice is unavailable right now (reply shown above).", "note"); setState("idle"); }
});
function stopSpeaking() {
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
}
function voiceLevel() {
  if (!analyser || state !== "speaking") return 0;
  analyser.getByteTimeDomainData(levelData);
  let sum = 0;
  for (let i = 0; i < levelData.length; i++) { const v = (levelData[i] - 128) / 128; sum += v * v; }
  return Math.min(1, Math.sqrt(sum / levelData.length) * 4);
}

// ---------------- voice in (browser speech recognition) ----------------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, heard = "", speechBump = 0;
function listen() {
  unlockAudio();
  if (state === "speaking") { stopSpeaking(); }
  if (!SR) { showTyping(true); return; }
  if (state === "listening") { rec && rec.stop(); return; }
  heard = "";
  rec = new SR();
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.continuous = false;
  rec.onresult = (e) => {
    let interim = "";
    heard = "";
    for (const r of e.results) (r.isFinal ? (heard += r[0].transcript) : (interim += r[0].transcript));
    showInterim((heard + " " + interim).trim());
    speechBump = 1;
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") line("", "Microphone access is blocked. Allow it in the browser, or type instead.", "note");
  };
  rec.onend = () => {
    const text = heard.trim() || (interimEl ? interimEl.lastChild.textContent.trim() : "");
    if (text) ask(text); else { clearInterim(); if (state === "listening") setState("idle"); }
  };
  try { rec.start(); setState("listening"); } catch { setState("idle"); }
}

// ---------------- typing fallback ----------------
function showTyping(on) {
  $("typeform").hidden = !on;
  $("typetoggle").textContent = on ? "Hide keyboard" : "Type instead";
  if (on) $("typed").focus();
}
$("typetoggle").addEventListener("click", () => showTyping($("typeform").hidden));
$("typeform").addEventListener("submit", (e) => {
  e.preventDefault();
  unlockAudio();
  if (state === "speaking") stopSpeaking();
  const t = $("typed").value;
  $("typed").value = "";
  ask(t);
});

// ---------------- controls ----------------
$("mic").addEventListener("click", listen);
document.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || e.repeat) return;
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select" || tag === "button") return;
  e.preventDefault();
  listen();
});
document.querySelectorAll(".agents button").forEach((b) =>
  b.addEventListener("click", () => {
    unlockAudio();
    if (b.dataset.agent === agent) return;
    stopSpeaking();
    setAgent(b.dataset.agent);
    const greet = AGENTS[agent].greeting;
    line(AGENTS[agent].name, greet, "ai");
    speak(greet);
  }),
);
$("logout").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  location.reload();
});

// ---------------- the orb ----------------
const canvas = $("orb");
const ctx = canvas.getContext("2d");
const COUNT = matchMedia("(max-width: 760px)").matches ? 700 : 1300;
const pts = [];
for (let i = 0; i < COUNT; i++) {
  // even spread over a sphere (Fibonacci sphere)
  const y = 1 - (i / (COUNT - 1)) * 2;
  const r = Math.sqrt(1 - y * y);
  const th = i * Math.PI * (3 - Math.sqrt(5));
  pts.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r, j: Math.random() });
}
let W = 0, H = 0, dpr = 1;
function resize() {
  dpr = Math.min(2, devicePixelRatio || 1);
  W = canvas.clientWidth; H = canvas.clientHeight;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
}
addEventListener("resize", resize);
if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas); // layout changes (keyboard, transcript) too

let level = 0, rot = 0, last = performance.now();
let tint = [...AGENTS[agent].tint];
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const target = AGENTS[agent].tint;
  for (let k = 0; k < 3; k++) tint[k] += (target[k] - tint[k]) * Math.min(1, dt * 3);
  const v = voiceLevel();
  level += ((state === "speaking" ? v : 0) - level) * Math.min(1, dt * 12);
  speechBump = Math.max(0, speechBump - dt * 1.8);
  rot += dt * (state === "thinking" ? 0.9 : 0.18) * (reduced ? 0.3 : 1);

  const t = now / 1000;
  const R = Math.min(W, H) * 0.3;
  const breathe = state === "idle" ? Math.sin(t * 1.3) * 0.035 : 0;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // soft core glow
  const [r, g, b] = tint.map(Math.round);
  const glowR = R * (1.35 + level * 0.5 + speechBump * 0.15);
  const grad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, glowR);
  grad.addColorStop(0, `rgba(${r},${g},${b},${0.32 + level * 0.3})`);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(W / 2, H / 2, glowR, 0, Math.PI * 2); ctx.fill();

  ctx.globalCompositeOperation = "lighter";
  const cos = Math.cos(rot), sin = Math.sin(rot), tilt = 0.35;
  for (const p of pts) {
    // per-state displacement
    let d = 1 + breathe;
    if (state === "listening") d += Math.sin(p.y * 9 - t * 6) * 0.05 + speechBump * 0.06 * Math.sin(p.j * 40 + t * 10);
    if (state === "speaking") d += level * (0.12 + 0.18 * Math.sin(p.j * 30 + t * 14));
    if (state === "thinking") d += Math.sin(p.x * 6 + t * 4) * 0.025;
    const x = (p.x * cos - p.z * sin) * d;
    let z = (p.x * sin + p.z * cos) * d;
    let y = p.y * d;
    const y2 = y * Math.cos(tilt) - z * Math.sin(tilt);
    z = y * Math.sin(tilt) + z * Math.cos(tilt);
    const depth = (z + 1.4) / 2.8; // 0 back .. 1 front
    const sx = W / 2 + x * R, sy = H / 2 + y2 * R;
    const a = 0.12 + depth * 0.75;
    const s = 0.6 + depth * 1.6 + level * 0.8;
    ctx.fillStyle = `rgba(${Math.min(255, r + 40 * depth)},${Math.min(255, g + 50 * depth)},${Math.min(255, b + 50 * depth)},${a})`;
    ctx.fillRect(sx - s / 2, sy - s / 2, s, s);
  }
  ctx.globalCompositeOperation = "source-over";
  requestAnimationFrame(frame);
}

// ---------------- start ----------------
setAgent(DEFAULT_AGENT);
setState("idle");
resize();
requestAnimationFrame(frame);
if (!SR) { showTyping(true); $("mic").title = "Voice input isn't supported in this browser"; }
try { const u = localStorage.getItem("jarvis-user"); if (u) $("who").textContent = u; } catch {}
line(AGENTS[agent].name, "Good to see you, sir. Ask me about the athletes, deals, leads or site traffic.", "ai");
loadStats();
setInterval(loadStats, 60000);
