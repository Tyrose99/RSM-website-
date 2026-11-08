// Jarvis command center. Talks to /api/jarvis/* (login required).
import { AGENTS, DEFAULT_AGENT } from "/jarvis/agents.js";
import { renderCard, sparkPaths } from "/jarvis/cards-ui.js";

const $ = (id) => document.getElementById(id);
const body = document.body;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

let state = "idle"; // idle | listening | thinking | speaking
let speaker = DEFAULT_AGENT; // who is talking right now (tints the orb, picks the voice)
let direct = null; // "scout" | "strategist" while talking to a specialist directly
const history = []; // conversation memory for this session: [{ role, text }]
const cards = new Map(); // id -> { card, node, getDraft }

// ---------------- state, speaker, caption ----------------
const STATUS = { idle: "Tap the mic or press space", listening: "Listening…", thinking: "Thinking…", speaking: "" };
function setState(s) {
  state = s;
  body.dataset.state = s;
  if (s !== "speaking" && STATUS[s]) caption(null, STATUS[s], s === "listening");
}
function setSpeaker(id) {
  if (!AGENTS[id]) id = DEFAULT_AGENT;
  speaker = id;
  body.dataset.speaker = id;
  const [r, g, b] = AGENTS[id].tint;
  body.style.setProperty("--tint", `${r}, ${g}, ${b}`);
  $("speaker").textContent = AGENTS[id].name;
  $("typed").placeholder = `Type to ${AGENTS[direct || DEFAULT_AGENT].name}…`;
}
function caption(who, text, interim = false) {
  const c = $("caption");
  c.replaceChildren();
  c.classList.toggle("interim", interim);
  if (who) {
    const w = document.createElement("span");
    w.className = "who";
    w.textContent = who;
    c.append(w);
  }
  c.append(document.createTextNode(text));
  c.title = text;
}

// ---------------- API ----------------
async function api(path, opts = {}) {
  const r = await fetch(path, { credentials: "same-origin", ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
  if (r.status === 401) { location.reload(); throw new Error("logged out"); }
  return r;
}
const post = (path, data) => api(path, { method: "POST", body: JSON.stringify(data) });

// ---------------- clock ----------------
function tick() {
  const now = new Date();
  $("clock-time").textContent = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  $("clock-date").textContent = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}
tick();
setInterval(tick, 10000);

// ---------------- live tiles ----------------
function setDot(status, title) {
  $("status-dot").dataset.status = status;
  $("status-dot").title = title;
}
async function loadHud() {
  try {
    const h = await (await api("/api/jarvis/hud")).json();
    if (h.user) $("who").textContent = h.user;
    $("t-visitors").textContent = h.visitors.week ?? "—";
    const ch = h.visitors.change;
    const chEl = $("t-visitors-change");
    chEl.textContent = h.visitors.week == null ? "not connected" : ch == null ? "" : `${ch >= 0 ? "▲" : "▼"} ${Math.abs(ch)}%`;
    chEl.className = ch == null ? "" : ch >= 0 ? "up" : "down";
    sparkPaths($("s-visitors"), h.visitors.series);
    $("t-inquiries").textContent = h.inquiries.week ?? "—";
    sparkPaths($("s-inquiries"), h.inquiries.series);
    $("t-athletes").textContent = h.signedAthletes ? h.signedAthletes.count : "—";
    sampleBadge($("t-athletes-sample"), h.signedAthletes?.sample);
    $("t-deals").textContent = h.openDeals ? h.openDeals.count : "—";
    sampleBadge($("t-deals-sample"), h.openDeals?.sample);
    const stages = $("t-deal-stages");
    stages.replaceChildren();
    const max = Math.max(1, ...Object.values(h.openDeals?.byStage || {}));
    for (const [stage, n] of Object.entries(h.openDeals?.byStage || {})) {
      const row = document.createElement("span");
      const bar = document.createElement("i");
      bar.style.width = `${(n / max) * 100}%`;
      row.append(document.createTextNode(stage), Object.assign(document.createElement("b"), { textContent: n }), bar);
      stages.append(row);
    }
    $("t-tasks").textContent = h.tasksToday ? h.tasksToday.count : "—";
    $("t-approvals").textContent = h.approvalsPending ? `${h.approvalsPending} awaiting approval` : "";
    const list = $("t-task-list");
    list.replaceChildren();
    for (const t of h.tasksToday?.items || []) {
      const s = document.createElement("span");
      s.textContent = `${t.overdue ? "! " : "· "}${t.title} (${t.owner})`;
      if (t.overdue) s.className = "late";
      list.append(s);
    }
    const ok = h.db.site && h.db.jarvis;
    setDot(ok ? "ok" : "warn", ok ? "All systems online" : "Some data isn't connected yet");
  } catch (e) {
    if (e.message !== "logged out") setDot("down", "Can't reach Jarvis");
  }
}
function sampleBadge(node, on) {
  node.textContent = on ? "sample" : "";
  node.className = on ? "jv-sample" : "";
}
document.querySelectorAll("button.jv-tile[data-card]").forEach((t) =>
  t.addEventListener("click", async () => {
    const { card: type, ...args } = t.dataset;
    try {
      const r = await post("/api/jarvis/card", { type, ...args });
      if (r.ok) addCards([(await r.json()).card]);
    } catch {}
  }),
);

// ---------------- daily briefing ----------------
let briefing = null;
async function loadBriefing() {
  try {
    const b = await (await api("/api/jarvis/briefing")).json();
    if (!b.available) {
      $("brief-status").textContent = b.reason === "weekend" ? "No briefing on weekends." : "Not available yet.";
      return;
    }
    briefing = b;
    $("brief-status").textContent = `Ready for ${new Date(b.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" })}.`;
    $("play-brief").disabled = false;
    const hour = new Date().getHours();
    const seenKey = `jarvis-greeted-${b.date}`;
    let seen = false;
    try { seen = sessionStorage.getItem(seenKey) === "1"; sessionStorage.setItem(seenKey, "1"); } catch {}
    if (!seen) {
      $("greet-text").textContent = `${hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"}, sir. Here's your day.`;
      $("greet").hidden = false;
    }
  } catch {
    $("brief-status").textContent = "Couldn't load the briefing.";
  }
}
function playBriefing() {
  if (!briefing) return;
  $("greet").hidden = true;
  unlockAudio();
  addCards([{ id: `briefing-${briefing.date}`, type: "briefing", title: "Today's briefing", text: briefing.text, facts: briefing.facts, sample: false }]);
  history.push({ role: "assistant", text: briefing.text });
  speak(briefing.text, DEFAULT_AGENT);
}
$("play-brief").addEventListener("click", playBriefing);
$("greet-play").addEventListener("click", playBriefing);
$("greet-close").addEventListener("click", () => ($("greet").hidden = true));

// ---------------- cards ----------------
const cardCtx = {
  reduced,
  close: (id) => closeCard(id),
  toggleTask: async (id, done) => { try { const r = await post("/api/jarvis/tasks", { task_id: id, done }); loadHud(); return r.ok; } catch { return false; } },
  saveDraft: (id, d) => post("/api/jarvis/drafts", { id, ...d }).catch(() => {}),
  queueDraft: async (id) => { try { const r = await post("/api/jarvis/approvals", { draft_id: id }); loadHud(); return r.ok; } catch { return false; } },
  decide: async (id, decision) => { try { const r = await post("/api/jarvis/approvals", { id, decision }); loadHud(); return r.ok ? (await r.json()).approval : null; } catch { return null; } },
};
function addCards(list) {
  for (const c of list || []) {
    // one card per kind (or per draft): a new one replaces the old
    for (const [id, existing] of cards) {
      const same = existing.card.type === c.type && (c.type !== "email" || existing.card.draft?.id === c.draft?.id);
      if (same) closeCard(id, { quiet: true });
    }
    const r = renderCard(c, cardCtx);
    cards.set(c.id, { card: c, node: r.node, getDraft: r.getDraft });
    $("cards").prepend(r.node);
  }
  layout();
}
function closeCard(id, { quiet = false } = {}) {
  const c = cards.get(id);
  if (!c) return;
  c.node.remove();
  cards.delete(id);
  if (!quiet) layout();
}
function clearCards() {
  for (const id of [...cards.keys()]) closeCard(id, { quiet: true });
  layout();
}
function layout() {
  const has = cards.size > 0;
  $("stage").classList.toggle("has-cards", has);
  $("clear").hidden = !has;
}
$("clear").addEventListener("click", clearCards);
const openDrafts = () => [...cards.values()].filter((c) => c.getDraft).map((c) => c.getDraft());

// "close that" / "clear the screen" are handled right here, no round trip
function localCommand(text) {
  const t = text.trim().toLowerCase().replace(/[.!?]+$/, "");
  if (/^(clear( the)? screen|clear (it )?all|close (all|everything|the cards)|clear everything)$/.test(t)) { clearCards(); return "Screen cleared, sir."; }
  if (/^(close|dismiss|hide) (that|it|this|the card)$/.test(t)) {
    const first = $("cards").firstElementChild;
    if (first) closeCard(first.dataset.cardId);
    return "Done.";
  }
  return null;
}

// ---------------- asking ----------------
async function ask(text) {
  text = text.trim();
  if (!text) return;
  const local = localCommand(text);
  if (local) { caption(AGENTS[DEFAULT_AGENT].name, local); setState("idle"); return; }
  caption("You", text);
  setState("thinking");
  try {
    const r = await post("/api/jarvis/assistant", { text, direct, history: history.slice(-20), drafts: openDrafts() });
    const j = await r.json();
    direct = j.direct ?? null;
    const reply = j.reply || j.error || "Something went wrong, sir.";
    history.push({ role: "user", text }, { role: "assistant", text: reply });
    addCards(j.cards);
    if ((j.cards || []).some((c) => c.type === "tasks" || c.type === "approvals")) loadHud();
    speak(reply, j.speaker || direct || DEFAULT_AGENT);
  } catch (e) {
    if (e.message !== "logged out") { caption(null, "Couldn't reach Jarvis. Check the connection and try again."); setState("idle"); }
  }
}

// ---------------- voice out (streamed MP3) + analyser for the orb ----------------
const audio = new Audio();
audio.preload = "auto";
let audioCtx = null, analyser = null, levelData = null;
function unlockAudio() {
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
function speak(text, who) {
  setSpeaker(who);
  caption(AGENTS[who]?.name || "Jarvis", text);
  setState("speaking");
  audio.src = `/api/jarvis/speak?agent=${encodeURIComponent(who)}&text=${encodeURIComponent(text.slice(0, 1200))}`;
  audio.play().catch(() => done());
}
function done() {
  if (state === "speaking") setState("idle");
  setSpeaker(direct || DEFAULT_AGENT); // specialists hand back to Jarvis unless you're talking to them directly
}
audio.addEventListener("ended", done);
audio.addEventListener("error", () => { if (state === "speaking") { done(); caption(null, "Voice is unavailable right now."); } });
function stopSpeaking() {
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  done();
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
let rec = null, heard = "", lastInterim = "", speechBump = 0;
function listen() {
  unlockAudio();
  if (state === "speaking") stopSpeaking();
  if (!SR) { showTyping(true); return; }
  if (state === "listening") { rec && rec.stop(); return; }
  heard = ""; lastInterim = "";
  rec = new SR();
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.continuous = false;
  rec.onresult = (e) => {
    let interim = "";
    heard = "";
    for (const r of e.results) (r.isFinal ? (heard += r[0].transcript) : (interim += r[0].transcript));
    lastInterim = (heard + " " + interim).trim();
    caption("You", lastInterim, true);
    speechBump = 1;
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") caption(null, "Microphone access is blocked. Allow it in the browser, or type instead.");
  };
  rec.onend = () => {
    const text = heard.trim() || lastInterim;
    if (text) ask(text); else if (state === "listening") setState("idle");
  };
  try { rec.start(); setState("listening"); } catch { setState("idle"); }
}

// ---------------- typing ----------------
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
$("mic").addEventListener("click", listen);
document.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || e.repeat) return;
  const tag = (e.target.tagName || "").toLowerCase();
  if (["input", "textarea", "select", "button"].includes(tag) || e.target.isContentEditable) return;
  e.preventDefault();
  listen();
});
$("logout").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  location.reload();
});

// ---------------- orb + HUD rings ----------------
const canvas = $("orb");
const ctx = canvas.getContext("2d");
const COUNT = matchMedia("(max-width: 820px)").matches ? 650 : 1100;
const pts = [];
for (let i = 0; i < COUNT; i++) {
  const y = 1 - (i / (COUNT - 1)) * 2;
  const r = Math.sqrt(1 - y * y);
  const th = i * Math.PI * (3 - Math.sqrt(5)); // Fibonacci sphere
  pts.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r, j: Math.random() });
}
let W = 0, H = 0, dpr = 1;
function resize() {
  dpr = Math.min(2, devicePixelRatio || 1);
  W = canvas.clientWidth; H = canvas.clientHeight;
  canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr));
}
if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
addEventListener("resize", resize);

const rings = [$("ring-a"), $("ring-b"), $("ring-c")];
const ringDir = [1, -1, 1], ringBase = [6, 10, 4]; // degrees per second when idle
const ringAngle = [0, 120, 240];
let level = 0, rot = 0, last = performance.now();
const tint = [...AGENTS[DEFAULT_AGENT].tint];

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const target = AGENTS[speaker].tint;
  for (let k = 0; k < 3; k++) tint[k] += (target[k] - tint[k]) * Math.min(1, dt * 3);
  level += ((state === "speaking" ? voiceLevel() : 0) - level) * Math.min(1, dt * 12);
  speechBump = Math.max(0, speechBump - dt * 1.8);
  const t = now / 1000;

  // rings: slow when idle, faster while listening/thinking, pulsing with the voice
  if (!reduced) {
    const speed = state === "listening" ? 5 : state === "thinking" ? 3.5 : state === "speaking" ? 1.8 : 1;
    rings.forEach((g, i) => {
      ringAngle[i] = (ringAngle[i] + ringDir[i] * ringBase[i] * speed * dt) % 360;
      const s = 1 + (state === "speaking" ? level * (0.03 + i * 0.02) : state === "listening" ? speechBump * 0.02 : 0);
      g.setAttribute("transform", `rotate(${ringAngle[i].toFixed(2)} 200 200) translate(200 200) scale(${s.toFixed(4)}) translate(-200 -200)`);
    });
    rot += dt * (state === "thinking" ? 0.9 : state === "listening" ? 0.45 : 0.18);
  }

  const R = Math.min(W, H) * 0.3;
  const breathe = state === "idle" && !reduced ? Math.sin(t * 1.3) * 0.035 : 0;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const [r, g, b] = tint.map(Math.round);
  const glowR = R * (1.35 + level * 0.5 + speechBump * 0.15);
  const grad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(1, glowR));
  grad.addColorStop(0, `rgba(${r},${g},${b},${0.32 + level * 0.3})`);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(W / 2, H / 2, Math.max(1, glowR), 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = "lighter";
  const cos = Math.cos(rot), sin = Math.sin(rot), tilt = 0.35;
  const small = R < 60;
  for (const p of pts) {
    let d = 1 + breathe;
    if (!reduced) {
      if (state === "listening") d += Math.sin(p.y * 9 - t * 6) * 0.05 + speechBump * 0.06 * Math.sin(p.j * 40 + t * 10);
      if (state === "speaking") d += level * (0.12 + 0.18 * Math.sin(p.j * 30 + t * 14));
      if (state === "thinking") d += Math.sin(p.x * 6 + t * 4) * 0.025;
    }
    const x = (p.x * cos - p.z * sin) * d;
    let z = (p.x * sin + p.z * cos) * d;
    const y = p.y * d;
    const y2 = y * Math.cos(tilt) - z * Math.sin(tilt);
    z = y * Math.sin(tilt) + z * Math.cos(tilt);
    const depth = (z + 1.4) / 2.8;
    const s = (small ? 0.4 : 0.6) + depth * (small ? 1 : 1.6) + level * 0.8;
    ctx.fillStyle = `rgba(${Math.min(255, r + 40 * depth)},${Math.min(255, g + 50 * depth)},${Math.min(255, b + 50 * depth)},${0.12 + depth * 0.75})`;
    ctx.fillRect(W / 2 + x * R - s / 2, H / 2 + y2 * R - s / 2, s, s);
  }
  ctx.globalCompositeOperation = "source-over";
  requestAnimationFrame(frame);
}

// ---------------- start ----------------
setSpeaker(DEFAULT_AGENT);
setState("idle");
resize();
requestAnimationFrame(frame);
if (!SR) { showTyping(true); $("mic").title = "Voice input isn't supported in this browser"; }
loadHud();
setInterval(loadHud, 60000);
loadBriefing();
