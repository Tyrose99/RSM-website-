// Orbit carousel for the client list in /clients.js
(() => {
  const root = document.getElementById("orbit");
  const ring = document.getElementById("orbitRing");
  const clients = (window.RSM_CLIENTS || []).filter((c) => c && c.name && c.photo);
  if (!root || !ring || !clients.length) return;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const MIN_SLOTS = 8;            // repeat short lists so the ring always looks full
  const SECONDS_PER_SLOT = 4.5;   // slow, premium pace

  // Repeat the whole list (keeps clients in order around the ring)
  const repeats = Math.max(1, Math.ceil(MIN_SLOTS / clients.length));
  const slots = [];
  for (let r = 0; r < repeats; r++) clients.forEach((c) => slots.push({ c, dup: r > 0 }));
  const N = slots.length;
  const step = (Math.PI * 2) / N;

  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const els = slots.map(({ c, dup }) => {
    const el = document.createElement("article");
    el.className = "orbit-card";
    if (dup) el.setAttribute("aria-hidden", "true");
    const handle = (c.instagram || "").replace(/^@/, "").trim();
    const alt = [c.name, c.detail].filter(Boolean).join(", ");
    el.innerHTML =
      `<div class="orbit-photo"><img src="/assets/img/${esc(c.photo)}" alt="${dup ? "" : esc(alt)}" width="1100" height="1375" loading="lazy" decoding="async" draggable="false"><i class="orbit-shade"></i></div>` +
      `<div class="card-meta">` +
      (c.sport ? `<span class="tag">${esc(c.sport)}</span>` : "") +
      `<h3>${esc(c.name)}</h3>` +
      (c.detail ? `<p>${esc(c.detail)}</p>` : "") +
      (handle ? `<a class="orbit-ig" href="https://instagram.com/${encodeURIComponent(handle)}" target="_blank" rel="noopener"${dup ? ' tabindex="-1"' : ""}>@${esc(handle)}</a>` : "") +
      `</div>`;
    ring.appendChild(el);
    return { el, shade: el.querySelector(".orbit-shade") };
  });

  // ---------- Layout ----------
  let radius = 400;
  function measure() {
    const w = root.clientWidth;
    radius = w < 760 ? w * 0.95 : Math.min(w * 0.36, 560); // phones: neighbours just peek in from the edges
  }

  let angle = 0;
  function render() {
    for (let i = 0; i < N; i++) {
      // a = 0 is the front-centre position
      let a = (i * step + angle) % (Math.PI * 2);
      if (a > Math.PI) a -= Math.PI * 2;
      if (a < -Math.PI) a += Math.PI * 2;
      const s = Math.sin(a), c = Math.cos(a);
      const t = (c + 1) / 2;                       // 1 = front, 0 = back
      const scale = 0.58 + 0.42 * Math.pow(t, 1.4);
      const x = s * radius;
      const rot = Math.max(-55, Math.min(55, (a * 180) / Math.PI * 0.7));
      const vis = Math.min(1, Math.max(0, (t - 0.18) / 0.3));
      const { el, shade } = els[i];
      el.style.transform = `translate3d(${x.toFixed(1)}px,0,0) scale(${scale.toFixed(3)}) rotateY(${rot.toFixed(1)}deg)`;
      el.style.opacity = vis.toFixed(3);
      el.style.zIndex = String(Math.round(t * 100));
      el.style.visibility = vis < 0.01 ? "hidden" : "visible";
      el.style.pointerEvents = t > 0.55 ? "auto" : "none";
      shade.style.opacity = Math.min(0.75, (1 - t) * 1.5).toFixed(3);
    }
  }

  // ---------- Motion ----------
  const autoSpeed = reduced ? 0 : step / SECONDS_PER_SLOT;  // radians per second, moves to the right
  let speed = autoSpeed, hover = false, touchHold = false, dragging = false;
  let resumeAt = 0, visible = true, last = 0, raf = 0;

  function tick(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    if (!dragging) {
      const paused = hover || touchHold || now < resumeAt;
      const target = paused ? 0 : autoSpeed;
      speed += (target - speed) * Math.min(1, dt * (paused ? 6 : 1.6)); // ease in/out, also bleeds off fling momentum
      angle += speed * dt;
    }
    render();
    if (visible) raf = requestAnimationFrame(tick);
  }
  function start() { if (!raf && visible) { last = 0; raf = requestAnimationFrame(tick); } }

  // ---------- Hover / touch / drag ----------
  let downX = 0, lastX = 0, lastT = 0, vel = 0, moved = false, pid = null;
  root.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") hover = true; });
  root.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hover = false; });
  root.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    pid = e.pointerId; dragging = true; moved = false;
    if (e.pointerType !== "mouse") touchHold = true;
    downX = lastX = e.clientX; lastT = performance.now(); vel = 0; speed = 0;
  });
  root.addEventListener("pointermove", (e) => {
    if (!dragging || e.pointerId !== pid) return;
    const dx = e.clientX - lastX;
    if (!moved && Math.abs(e.clientX - downX) > 6) { moved = true; root.setPointerCapture(pid); root.classList.add("is-dragging"); }
    if (!moved) return;
    const now = performance.now();
    const da = dx / radius;
    angle += da;
    vel = da / Math.max(0.008, (now - lastT) / 1000);
    lastX = e.clientX; lastT = now;
    start();
  });
  const release = (e) => {
    if (!dragging || (e && e.pointerId !== pid)) return;
    dragging = false; touchHold = false; root.classList.remove("is-dragging");
    if (moved) speed = Math.max(-step * 3, Math.min(step * 3, vel)); // fling, then glide back to autoplay
    if (e && e.pointerType !== "mouse") resumeAt = performance.now() + 1500;
    start();
  };
  root.addEventListener("pointerup", release);
  root.addEventListener("pointercancel", release);
  // A drag shouldn't open the Instagram link underneath
  root.addEventListener("click", (e) => { if (moved) { e.preventDefault(); moved = false; } }, true);

  // Only animate while on screen
  new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    if (visible) start();
  }).observe(root);

  window.addEventListener("resize", () => { measure(); render(); });
  measure();
  render();
  start();
})();
