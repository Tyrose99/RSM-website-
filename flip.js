// Flip cards in the business orbit: tap/click/Enter/Space flips between the poster and its video
(() => {
  const cards = [...document.querySelectorAll(".flip")];
  if (!cards.length) return;

  const onScreen = new Map();
  const load = (card) => {
    const v = card.querySelector("video");
    if (v.src || !v.dataset.src) return;
    if (v.dataset.poster) v.poster = v.dataset.poster;
    v.preload = card.closest("[aria-hidden]") ? "metadata" : "auto"; // repeated cards reuse the same file
    v.src = v.dataset.src;
  };
  // The video only plays while the back is showing and the card is on screen
  const sync = (card) => {
    const v = card.querySelector("video");
    if (card.classList.contains("is-flipped") && onScreen.get(card)) {
      load(card);
      v.play().catch(() => {});
    } else if (!v.paused) {
      v.pause();
    }
  };
  const toggle = (card) => {
    const flipped = card.classList.toggle("is-flipped");
    card.setAttribute("aria-pressed", String(flipped));
    sync(card);
  };

  // Which flip card is under a click. Some mobile browsers hit-test taps on these nested 3D
  // faces as landing on the ring behind them, so fall back to the card's on-screen box.
  const cardAt = (e) => {
    const direct = e.target.closest(".flip");
    if (direct) return direct;
    if (e.target.closest(".orbit-card")) return null; // tapped a different card in front
    let best = null, bestZ = -1;
    for (const card of cards) {
      const slot = card.closest(".orbit-card");
      if (!slot || !e.target.contains(slot) || slot.style.pointerEvents === "none") continue;
      const r = card.getBoundingClientRect();
      const z = +slot.style.zIndex || 0;
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom && z > bestZ) { best = card; bestZ = z; }
    }
    return best;
  };

  const roots = new Set(cards.map((card) => card.closest(".orbit") || card));
  roots.forEach((root) => root.addEventListener("click", (e) => {
    if (e.defaultPrevented) return; // the orbit marks a drag's click as handled, so a swipe never flips a card
    const card = cardAt(e);
    if (card) toggle(card);
  }));
  cards.forEach((card) => card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(card); }
  }));

  // "Tap to flip" tags without a flipTag setting: light tag over a light photo, dark tag otherwise
  const toneCache = new Map();
  const pickTone = (hint) => {
    const photo = hint.offsetParent;
    const img = photo && [...photo.children].find((el) => el.tagName === "IMG");
    if (!img) { hint.classList.add("flip-hint--dark"); return; } // poster cards: dark background behind the tag
    const decide = () => {
      if (!img.naturalWidth || !img.offsetWidth) return;
      const sx = img.naturalWidth / img.offsetWidth, sy = img.naturalHeight / img.offsetHeight;
      const left = hint.offsetLeft - hint.offsetWidth / 2; // the tag is centred with translateX(-50%)
      const x = Math.max(0, left - 6) * sx, y = Math.max(0, hint.offsetTop - 6) * sy;
      const w = (hint.offsetWidth + 12) * sx, h = (hint.offsetHeight + 12) * sy;
      const key = img.currentSrc + "|" + [x, y, w, h].map(Math.round).join(",");
      let light = toneCache.get(key);
      if (light === undefined) {
        try {
          const c = document.createElement("canvas"); c.width = 48; c.height = 16;
          const ctx = c.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(img, x, y, w, h, 0, 0, c.width, c.height);
          const d = ctx.getImageData(0, 0, c.width, c.height).data;
          let sum = 0;
          for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          light = sum / (d.length / 4) > 150;
        } catch (err) { light = false; }
        toneCache.set(key, light);
      }
      hint.classList.toggle("flip-hint--light", light);
      hint.classList.toggle("flip-hint--dark", !light);
    };
    if (img.complete) decide(); else img.addEventListener("load", decide, { once: true });
  };
  document.querySelectorAll(".flip-hint[data-auto]").forEach(pickTone);

  // Start downloading only when the card gets close to the screen
  const near = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { load(e.target); near.unobserve(e.target); } });
  }, { rootMargin: "400px 0px" });
  const seen = new IntersectionObserver((entries) => {
    entries.forEach((e) => { onScreen.set(e.target, e.isIntersecting); sync(e.target); });
  });
  cards.forEach((card) => { near.observe(card); seen.observe(card); });
})();
