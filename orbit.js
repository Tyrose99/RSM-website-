// Orbit carousels: athletes (/clients.js) and businesses (/businesses.js) share this one engine
(() => {
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const igLink = (handle, dup) => (handle ? `<a class="orbit-ig" href="https://instagram.com/${encodeURIComponent(handle)}" target="_blank" rel="noopener"${dup ? ' tabindex="-1"' : ""}>@${esc(handle)}</a>` : "");

  // Athlete card: photo with name details underneath.
  // An athlete with a `video` gets it layered over the photo (plays while centred) and opens it in a popup on tap.
  const athleteCard = (c, dup) => {
    const handle = (c.instagram || "").replace(/^@/, "").trim();
    const alt = [c.name, c.detail].filter(Boolean).join(", ");
    const img = `<img src="/assets/img/${esc(c.photo)}" alt="${dup ? "" : esc(alt)}" width="1100" height="1375" loading="lazy" decoding="async" draggable="false">`;
    const photo = c.video
      ? `<div class="orbit-photo has-video" role="button" tabindex="${dup ? -1 : 0}" aria-label="Play ${esc(c.name)} video" data-video="/assets/video/${esc(c.video)}" data-name="${esc(c.name)}">${img}` +
        `<video class="card-video" muted loop playsinline webkit-playsinline preload="none" disablepictureinpicture aria-hidden="true"></video>` +
        `<span class="play-badge" aria-hidden="true"></span><i class="orbit-shade"></i></div>`
      : `<div class="orbit-photo">${img}<i class="orbit-shade"></i></div>`;
    return (
      photo +
      `<div class="card-meta">` +
      (c.sport ? `<span class="tag">${esc(c.sport)}</span>` : "") +
      `<h3>${esc(c.name)}</h3>` +
      (c.detail ? `<p>${esc(c.detail)}</p>` : "") +
      igLink(handle, dup) +
      `</div>`
    );
  };

  // Business card: poster with the logo centred, name and tag at the bottom.
  // A business with a `video` becomes a flip card (poster on the front, video on the back; see /flip.js).
  const businessCard = (b, dup) => {
    const handle = (b.instagram || "").replace(/^@/, "").trim();
    const poster = (inner) =>
      `<div class="orbit-photo poster">` +
      `<div class="poster-art"><img src="/assets/img/${esc(b.logo)}" alt="${dup ? "" : esc(b.name + " logo")}" loading="lazy" decoding="async" draggable="false"></div>` +
      `<div class="poster-foot"><h3>${esc(b.name)}</h3>` +
      (b.tag ? `<p>${esc(b.tag)}</p>` : "") +
      igLink(handle, dup) +
      `</div>${inner}</div>`;
    if (!b.video) return poster(`<i class="orbit-shade"></i>`);
    return (
      `<div class="flip" role="button" tabindex="${dup ? -1 : 0}" aria-pressed="false" aria-label="${esc(b.name)}: flip to watch the video">` +
      `<div class="flip-inner">` +
      `<div class="flip-face flip-front">${poster(`<span class="flip-hint">Tap to flip</span>`)}</div>` +
      `<div class="flip-face flip-back"><video muted loop playsinline preload="none" disablepictureinpicture aria-hidden="true"` +
      ` data-src="/assets/video/${esc(b.video)}"${b.poster ? ` data-poster="/assets/img/${esc(b.poster)}"` : ""}></video></div>` +
      `</div><i class="orbit-shade"></i></div>`
    );
  };

  // ---------- Athlete videos: play in the card while centred, popup with sound on tap ----------
  function athleteVideos() {
    const root = document.getElementById("orbit");
    if (!root) return null;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let onScreen = false, modalOpen = false; // set by the observer below, so nothing downloads before the orbit is near

    const setPlaying = (photo, on) => {
      const v = photo.querySelector(".card-video");
      if (on) {
        if (!v.src) { v.preload = "auto"; v.src = photo.dataset.video; }
        if (v.paused) v.play().catch(() => {});
      } else if (!v.paused) {
        v.pause();
      }
      photo.classList.toggle("is-centred", on);
    };
    root.addEventListener("playing", (e) => e.target.classList && e.target.classList.contains("card-video") && e.target.closest(".orbit-photo").classList.add("is-playing"), true);
    root.addEventListener("pause", (e) => e.target.classList && e.target.classList.contains("card-video") && e.target.closest(".orbit-photo").classList.remove("is-playing"), true);

    new IntersectionObserver((entries) => {
      onScreen = entries[0].isIntersecting;
      if (!onScreen) root.querySelectorAll(".has-video").forEach((p) => setPlaying(p, false));
    }).observe(root);

    // ---- popup ----
    let modal, modalVideo, lastFocus;
    const close = () => {
      modal.hidden = true; modalOpen = false;
      modalVideo.pause();
      document.documentElement.classList.remove("vmodal-lock");
      if (lastFocus) lastFocus.focus({ preventScroll: true });
    };
    const open = (photo) => {
      if (!modal) {
        modal = document.createElement("div");
        modal.className = "vmodal";
        modal.hidden = true;
        modal.setAttribute("role", "dialog");
        modal.setAttribute("aria-modal", "true");
        modal.innerHTML = `<div class="vmodal-box"><video controls playsinline webkit-playsinline preload="auto"></video><button class="vmodal-close" type="button" aria-label="Close video">&times;</button></div>`;
        document.body.appendChild(modal);
        modalVideo = modal.querySelector("video");
        modal.addEventListener("click", (e) => { if (!e.target.closest("video")) close(); });
        document.addEventListener("keydown", (e) => { if (e.key === "Escape" && modalOpen) close(); });
      }
      lastFocus = document.activeElement;
      root.querySelectorAll(".has-video").forEach((p) => setPlaying(p, false));
      modal.setAttribute("aria-label", `${photo.dataset.name} video`);
      if (modalVideo.getAttribute("src") !== photo.dataset.video) modalVideo.src = photo.dataset.video;
      modalVideo.currentTime = 0;
      modalVideo.muted = false;
      modal.hidden = false; modalOpen = true;
      document.documentElement.classList.add("vmodal-lock");
      modalVideo.play().catch(() => {});
      modal.querySelector(".vmodal-close").focus({ preventScroll: true });
    };

    // Which card photo a click is on. Some browsers hit-test clicks on the turning 3D cards
    // as landing on the ring behind them, so fall back to the front-most card under the pointer.
    const photoAt = (e) => {
      if (e.target.closest(".orbit-card")) return e.target.closest(".orbit-photo");
      let best = null, bestZ = -1;
      for (const card of root.querySelectorAll(".orbit-card")) {
        if (card.style.pointerEvents === "none") continue;
        const photo = card.querySelector(".orbit-photo");
        const r = photo.getBoundingClientRect();
        const z = +card.style.zIndex || 0;
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom && z > bestZ) { best = photo; bestZ = z; }
      }
      return best;
    };
    root.addEventListener("click", (e) => {
      if (e.defaultPrevented || e.target.closest("a")) return; // a drag, or the Instagram link
      const photo = photoAt(e);
      if (photo && photo.classList.contains("has-video")) open(photo);
    });
    root.addEventListener("keydown", (e) => {
      const photo = e.target.closest && e.target.closest(".has-video");
      if (photo && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(photo); }
    });

    // called by the orbit for every card on every frame
    return (el, t, centred) => {
      const photo = el.querySelector(".has-video");
      if (!photo) return;
      const want = centred && onScreen && !modalOpen && !reduced;
      if (want !== photo.classList.contains("is-centred")) setPlaying(photo, want);
    };
  }

  createOrbit("orbit", "orbitRing", (window.RSM_CLIENTS || []).filter((c) => c && c.name && c.photo), athleteCard, athleteVideos());
  createOrbit("bizOrbit", "bizOrbitRing", (window.RSM_BUSINESSES || []).filter((b) => b && b.name && b.logo), businessCard);

  function createOrbit(rootId, ringId, clients, cardHtml, onRender) {
  const root = document.getElementById(rootId);
  const ring = document.getElementById(ringId);
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
  const centreT = (Math.cos(step / 2) + 1) / 2; // a card counts as "centred" while it's the slot nearest the front

  const els = slots.map(({ c, dup }) => {
    const el = document.createElement("article");
    el.className = "orbit-card";
    if (dup) el.setAttribute("aria-hidden", "true");
    el.innerHTML = cardHtml(c, dup);
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
      if (onRender) onRender(el, t, t >= centreT);
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
  }
})();
