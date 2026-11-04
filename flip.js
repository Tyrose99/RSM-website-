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

  // Start downloading only when the card gets close to the screen
  const near = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { load(e.target); near.unobserve(e.target); } });
  }, { rootMargin: "400px 0px" });
  const seen = new IntersectionObserver((entries) => {
    entries.forEach((e) => { onScreen.set(e.target, e.isIntersecting); sync(e.target); });
  });
  cards.forEach((card) => { near.observe(card); seen.observe(card); });
})();
