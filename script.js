(() => {
  const FRAME_COUNT = 97;
  const framePath = (i) => `/assets/frames/f_${String(i + 1).padStart(3, "0")}.webp`;
  const SRC_W = 1280, SRC_H = 720;

  const canvas = document.getElementById("rose");
  const ctx = canvas.getContext("2d");
  const hero = document.getElementById("hero");
  const heroCopy = document.getElementById("heroCopy");
  const cue = document.getElementById("scrollCue");
  const finale = document.getElementById("finale");
  const finaleCopy = document.getElementById("finaleCopy");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  document.getElementById("yr").textContent = new Date().getFullYear();

  // ---------- Load frames (first frame first, the rest in order) ----------
  const frames = new Array(FRAME_COUNT);
  const loaded = new Array(FRAME_COUNT).fill(false);
  function load(i) {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => { loaded[i] = true; if (i === 0 || i === current) requestDraw(); };
    img.src = framePath(i);
    frames[i] = img;
  }
  load(0);
  if (!reduced) for (let i = 1; i < FRAME_COUNT; i++) load(i);

  // ---------- Canvas sizing ----------
  let vw = 0, vh = 0;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    vw = window.innerWidth;
    vh = window.innerHeight;
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingQuality = "high";
    update();
  }

  let current = 0;
  let scaleBoost = 1;
  function nearestLoaded(i) {
    for (let d = 0; d < FRAME_COUNT; d++) {
      if (loaded[i - d]) return i - d;
      if (loaded[i + d]) return i + d;
    }
    return -1;
  }
  function draw() {
    drawPending = false;
    const idx = nearestLoaded(current);
    ctx.clearRect(0, 0, vw, vh);
    if (idx < 0) return;
    const portrait = vh > vw;
    // Landscape: cover the screen. Portrait: keep the rose a good size without cropping the shards too hard.
    let s = portrait ? (vw * 1.75) / SRC_W : Math.max(vw / SRC_W, vh / SRC_H);
    s *= scaleBoost;
    const w = SRC_W * s, h = SRC_H * s;
    const y = portrait ? vh * 0.42 - h / 2 : (vh - h) / 2;
    const x = (vw - w) / 2;
    ctx.drawImage(frames[idx], x, y, w, h);
    // Feather every edge of the video into the page background so no box is ever visible
    const fadeY = h * 0.2, fadeX = w * 0.14;
    const edge = (x0, y0, x1, y1, rx, ry, rw, rh) => {
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, BG); g.addColorStop(1, "rgba(7,7,7,0)");
      ctx.fillStyle = g; ctx.fillRect(rx, ry, rw, rh);
    };
    edge(0, y, 0, y + fadeY, 0, y - 2, vw, fadeY + 2);
    edge(0, y + h, 0, y + h - fadeY, 0, y + h - fadeY, vw, fadeY + 2);
    edge(x, 0, x + fadeX, 0, x - 2, y, fadeX + 2, h);
    edge(x + w, 0, x + w - fadeX, 0, x + w - fadeX, y, fadeX + 2, h);
    ctx.fillStyle = BG;
    if (y > 0) { ctx.fillRect(0, 0, vw, y); ctx.fillRect(0, y + h, vw, vh - y - h); }
  }
  const BG = "#070707";
  let drawPending = false;
  function requestDraw() {
    if (!drawPending) { drawPending = true; requestAnimationFrame(draw); }
  }

  // ---------- Scroll logic ----------
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const ease = (t) => t * t * (3 - 2 * t);

  function update() {
    const y = window.scrollY;
    const last = FRAME_COUNT - 1;

    // Hero: play forward (spin, then break apart)
    const heroP = clamp((y - hero.offsetTop) / (hero.offsetHeight - vh));
    // Finale: play backward (shards fly back together)
    const finP = clamp((y - finale.offsetTop + vh * 0.35) / (finale.offsetHeight - vh * 0.65));

    let frame, opacity;
    if (finP > 0) {
      const back = clamp(finP / 0.7);
      frame = Math.round((1 - ease(back)) * last);
      opacity = 0.45 + 0.55 * clamp(finP / 0.2);
      // crossfade into the real logo once the rose is whole again
      const showLogo = finP > 0.72;
      finaleCopy.classList.toggle("show", showLogo);
      if (showLogo) opacity *= 1 - clamp((finP - 0.72) / 0.12);
      scaleBoost = 1;
    } else {
      frame = Math.round(heroP * last);
      finaleCopy.classList.remove("show");
      // after the break-apart, dim the shards so the content reads on top
      const mid = clamp((y - (hero.offsetTop + hero.offsetHeight - vh)) / (vh * 0.8));
      opacity = 1 - 0.6 * mid;
      // slow drift through the middle sections
      const drift = clamp((y - hero.offsetTop - hero.offsetHeight) / Math.max(1, finale.offsetTop - hero.offsetTop - hero.offsetHeight));
      scaleBoost = 1 + 0.12 * drift;
    }

    canvas.style.opacity = opacity.toFixed(3);

    // Hero text fades out as the rose starts to break
    const t = clamp((heroP - 0.38) / 0.22);
    heroCopy.style.opacity = (1 - t).toFixed(3);
    heroCopy.style.transform = `translateY(${(-t * 40).toFixed(1)}px)`;
    cue.style.opacity = (1 - clamp(heroP / 0.1)).toFixed(3);

    if (reduced) frame = last;
    current = frame;
    requestDraw();

    tiltCards();
  }

  // ---------- Athlete card tilt ----------
  const cards = [...document.querySelectorAll("[data-tilt]")];
  function tiltCards() {
    if (reduced) return;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (r.bottom < -100 || r.top > vh + 100) continue;
      const off = clamp(((r.top + r.height / 2) - vh / 2) / vh, -1, 1);
      const dir = c === cards[0] ? 1 : -1;
      c.style.transform = `rotateY(${(off * 7 * dir).toFixed(2)}deg) rotateX(${(off * -3).toFixed(2)}deg) translateY(${(off * 24).toFixed(1)}px)`;
    }
  }

  // ---------- Reveal on scroll ----------
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }, { threshold: 0.15 });
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

  let ticking = false;
  window.addEventListener("scroll", () => {
    if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; update(); }); }
  }, { passive: true });
  window.addEventListener("resize", resize);
  resize();
})();
