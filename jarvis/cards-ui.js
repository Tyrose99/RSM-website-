// Renders Jarvis's pop-up cards. All text goes in through textContent (never innerHTML) so nothing from
// the database can inject markup.

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
};
const svgEl = (tag, attrs) => {
  const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
const fmtMoney = (n) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const fmtDate = (d) => (d ? new Date(String(d).slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
const fmtWhen = (d) => (d ? new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const cap = (s) => (s ? String(s)[0].toUpperCase() + String(s).slice(1) : "");

// ---------- charts ----------
// fromMin: scale between the lowest and highest value (for totals like followers, where change is what matters)
export function sparkPaths(svg, series, { w = 100, h = 28, fromMin = false } = {}) {
  svg.replaceChildren();
  if (!series || !series.length) return;
  const vals = series.map((d) => d.count);
  const lo = fromMin ? Math.min(...vals) - Math.max(1, (Math.max(...vals) - Math.min(...vals)) * 0.15) : 0;
  const max = Math.max(lo + 1, ...vals);
  const step = series.length > 1 ? w / (series.length - 1) : w;
  const pts = vals.map((v, i) => [i * step, h - ((v - lo) / (max - lo)) * (h - 3) - 1.5]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  svg.append(svgEl("path", { d: `${line} L${w},${h} L0,${h} Z`, class: "a" }), svgEl("path", { d: line, class: "l" }));
}
function areaChart(series, { fromMin = false } = {}) {
  const wrap = el("div");
  const svg = svgEl("svg", { class: "jv-chart", viewBox: "0 0 300 110", preserveAspectRatio: "none" });
  sparkPaths(svg, series, { w: 300, h: 110, fromMin });
  const axis = el("div", "axis");
  axis.append(el("span", null, fmtDate(series[0]?.day)), el("span", null, fmtDate(series[series.length - 1]?.day)));
  wrap.append(svg, axis);
  return wrap;
}
function barChart(series) {
  const wrap = el("div");
  const svg = svgEl("svg", { class: "jv-chart", viewBox: "0 0 300 110", preserveAspectRatio: "none" });
  const max = Math.max(1, ...series.map((d) => d.count));
  const bw = 300 / Math.max(1, series.length);
  series.forEach((d, i) => {
    const bh = (d.count / max) * 104;
    svg.append(svgEl("rect", { x: i * bw + bw * 0.15, y: 110 - bh, width: bw * 0.7, height: bh, rx: 2 }));
  });
  const axis = el("div", "axis");
  axis.append(el("span", null, series[0]?.day || ""), el("span", null, series[series.length - 1]?.day || ""));
  wrap.append(svg, axis);
  return wrap;
}
function bars(items) {
  const box = el("div", "bars");
  const max = Math.max(1, ...items.map((i) => i.count));
  for (const it of items) {
    const row = el("div");
    const i = el("i");
    i.style.width = `${Math.max(3, (it.count / max) * 100)}%`;
    row.append(el("span", null, it.label), el("b", null, it.count), i);
    box.append(row);
  }
  return box;
}
function rowsList(items, render) {
  const ul = el("ul", "rows");
  for (const it of items) {
    const li = el("li");
    render(li, it);
    ul.append(li);
  }
  return ul;
}

// Word-level diff (LCS) for the animated draft rewrite
function diffWords(a, b) {
  const A = a.split(/(\s+)/), B = b.split(/(\s+)/);
  if (A.length * B.length > 250000) return [{ t: "ins", s: b }];
  const L = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { out.push({ t: "eq", s: A[i] }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push({ t: "del", s: A[i++] });
    else out.push({ t: "ins", s: B[j++] });
  }
  while (i < A.length) out.push({ t: "del", s: A[i++] });
  while (j < B.length) out.push({ t: "ins", s: B[j++] });
  return out;
}

// Images: only same-site paths (/assets/... for the public site's photos, /api/jarvis/instagram for saved thumbnails)
const safeSrc = (u) => (typeof u === "string" && /^\/(assets|api\/jarvis\/instagram)[\/?][^\s"'<>]*$/.test(u) ? u : null);
function img(src, alt, cls) {
  const s = safeSrc(src);
  if (!s) return el("div", `${cls || ""} noimg`, alt ? alt.slice(0, 1) : "");
  const i = el("img", cls);
  i.src = s;
  i.alt = alt || "";
  i.loading = "lazy";
  i.decoding = "async";
  i.addEventListener("error", () => i.replaceWith(el("div", `${cls || ""} noimg`, alt ? alt.slice(0, 1) : "")));
  return i;
}
function igLink(handle) {
  const h = String(handle || "").replace(/^@/, "");
  if (!/^[A-Za-z0-9._]{1,30}$/.test(h)) return null;
  const a = el("a", "iglink", `@${h}`);
  a.href = `https://instagram.com/${h}`;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  return a;
}
function postLink(url) {
  if (!/^https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9_\/\-]+\/?$/.test(url || "")) return null;
  const a = el("a", "iglink", "Open on Instagram ↗");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  return a;
}
const fmtNum = (n) => (n == null ? "—" : Number(n).toLocaleString("en-US"));
function stats(pairs) {
  const box = el("div", "igstats");
  for (const [label, v] of pairs) { if (v === undefined) continue; const d = el("div"); d.append(el("b", null, fmtNum(v)), el("span", null, label)); box.append(d); }
  return box;
}
const KIND = { reel: "Reel", carousel: "Carousel", video: "Video", photo: "Photo" };

// ---------- the cards ----------
const RENDER = {
  traffic(c, b) {
    if (c.unavailable) return b.append(el("p", "note", c.unavailable));
    b.append(el("div", "big", c.total), el("p", "note", "visits (page views)"), areaChart(c.series || []));
    if (c.sources?.length) b.append(el("div", "sec", "Sources"), bars(c.sources));
    if (c.pages?.length) b.append(el("div", "sec", "Top pages"), bars(c.pages));
    if (c.devices?.length) b.append(el("div", "sec", "Devices"), bars(c.devices));
  },
  money(c, b) {
    b.append(el("div", "big", fmtMoney(c.total)), el("p", "note", "closed deals with amounts"));
    if (c.series?.length) b.append(barChart(c.series));
    if (c.note) b.append(el("p", "note", c.note));
    if (c.deals?.length) b.append(rowsList(c.deals, (li, d) => { li.append(el("b", null, d.name), el("span", "pill", fmtMoney(d.amount))); li.append(el("small", null, [d.stage, fmtDate(d.close_date)].filter(Boolean).join(" · "))); }));
  },
  deals(c, b) {
    const pipe = el("div", "pipeline");
    for (const s of c.stages || []) { const d = el("div"); d.append(el("b", null, s.count), el("span", null, s.stage)); pipe.append(d); }
    b.append(pipe);
    if (!c.deals?.length) b.append(el("p", "note", "No deals recorded yet."));
    else b.append(rowsList(c.deals, (li, d) => { li.append(el("b", null, d.name), el("span", "pill", d.stage || "No stage")); li.append(el("small", null, [d.athlete, d.business, d.amount != null ? fmtMoney(d.amount) : null, d.notes].filter(Boolean).join(" · "))); }));
  },
  leads(c, b) {
    if (!c.leads?.length) return b.append(el("p", "note", "No leads recorded yet."));
    b.append(rowsList(c.leads, (li, l) => {
      li.append(el("b", null, l.name));
      if (l.status) li.append(el("span", "pill", l.status));
      if (l.why) li.append(el("small", null, `Why: ${l.why}`));
      if (l.pitch) li.append(el("small", null, `Pitch: ${l.pitch}`));
    }));
  },
  athlete(c, b) {
    if (c.unavailable) return b.append(el("p", "note", c.unavailable));
    const a = c.athlete;
    const prof = el("div", "from");
    for (const [k, v] of [["Sport", a.sport], ["School / team", a.school], ["Status", a.status], ...Object.entries(a.details || {}).slice(0, 6)]) if (v != null && v !== "") prof.append(el("span", null, cap(k)), el("b", null, typeof v === "object" ? JSON.stringify(v) : v));
    b.append(prof, el("div", "sec", "Deals"));
    b.append(c.deals?.length ? rowsList(c.deals, (li, d) => { li.append(el("b", null, d.name), el("span", "pill", d.stage || "—")); }) : el("p", "note", "No deals yet."));
  },
  tasks(c, b, ctx) {
    if (!c.tasks?.length) return b.append(el("p", "note", "Nothing on the list."));
    b.append(rowsList(c.tasks, (li, t) => {
      li.className = `task${t.status === "done" ? " done" : ""}`;
      const box = el("input");
      box.type = "checkbox";
      box.checked = t.status === "done";
      box.setAttribute("aria-label", `Done: ${t.title}`);
      box.addEventListener("change", async () => {
        li.classList.toggle("done", box.checked);
        if (!(await ctx.toggleTask(t.id, box.checked))) { box.checked = !box.checked; li.classList.toggle("done", box.checked); }
      });
      const txt = el("div");
      txt.append(el("b", null, t.title));
      txt.append(el("small", t.overdue ? "late" : null, [cap(t.owner), t.due_date ? `due ${fmtDate(t.due_date)}` : null, t.overdue ? "overdue" : null, t.details].filter(Boolean).join(" · ")));
      li.append(box, txt);
    }));
  },
  memories(c, b) {
    if (!c.memories?.length) return b.append(el("p", "note", "Nothing saved yet. Say \"remember…\" to add something."));
    b.append(rowsList(c.memories, (li, m) => { li.append(el("b", null, m.content)); li.append(el("small", null, [cap(m.kind), m.due_date ? `due ${fmtDate(m.due_date)}` : null, `by ${cap(m.created_by)}`, fmtWhen(m.created_at)].filter(Boolean).join(" · "))); }));
  },
  growth(c, b) {
    if (!c.moves?.length) return b.append(el("p", "note", "No growth moves recorded yet."));
    b.append(rowsList(c.moves, (li, m) => { li.append(el("b", null, m.title)); if (m.status) li.append(el("span", "pill", m.status)); if (m.why) li.append(el("small", null, `Why: ${m.why}`)); if (m.first_step) li.append(el("small", null, `First step: ${m.first_step}`)); }));
  },
  activity(c, b) {
    if (!c.activity?.length) return b.append(el("p", "note", "No activity yet."));
    b.append(rowsList(c.activity, (li, a) => { li.append(el("b", null, a.summary)); li.append(el("small", null, `${cap(a.actor)} · ${fmtWhen(a.created_at)}`)); }));
  },
  approvals(c, b, ctx) {
    if (!c.approvals?.length) return b.append(el("p", "note", "Nothing waiting for approval."));
    b.append(rowsList(c.approvals, (li, a) => {
      li.append(el("b", null, a.summary), el("small", null, `Asked by ${cap(a.requested_by)} · ${fmtWhen(a.created_at)}`));
      const act = el("div", "actions");
      const status = el("small", "muted");
      for (const [label, decision] of [["Approve", "approve"], ["Reject", "reject"]]) {
        const btn = el("button", "jv-btn", label);
        btn.type = "button";
        btn.addEventListener("click", async () => {
          act.querySelectorAll("button").forEach((x) => (x.disabled = true));
          const r = await ctx.decide(a.id, decision);
          status.textContent = r ? r.result : "Couldn't save that.";
          if (!r) act.querySelectorAll("button").forEach((x) => (x.disabled = false));
        });
        act.append(btn);
      }
      act.append(status);
      li.append(act);
    }));
  },
  email(c, b, ctx) {
    const svc = c.draft?.channel === "instagram_dm" ? "Instagram" : "Gmail";
    if (!c.draft) return b.append(el("p", "note", c.note || `${svc} isn't connected yet.`));
    const d = c.draft;
    const form = el("div", "draft");
    const head = el("div", "from");
    if (d.to_name) head.append(el("span", null, "To"), el("b", null, d.to_name));
    if (d.company) head.append(el("span", null, "Company"), el("b", null, d.company));
    form.append(head);
    let subject = null;
    if (d.channel === "email") {
      form.append(el("label", null, "Subject"));
      subject = el("input");
      subject.value = d.subject || "";
      form.append(subject);
    }
    form.append(el("label", null, "Message"));
    const area = el("textarea");
    area.value = d.body || "";
    area.dataset.draftId = d.id;
    // animate a voice rewrite: show the word changes, then hand back the editable box
    if (c.previous && c.previous.body !== d.body && !ctx.reduced) {
      const diff = el("div", "diff");
      for (const part of diffWords(c.previous.body || "", d.body || "")) diff.append(part.t === "eq" ? document.createTextNode(part.s) : el(part.t, null, part.s));
      form.append(diff);
      setTimeout(() => diff.replaceWith(area), 2200);
    } else form.append(area);
    let timer = null;
    const save = () => { clearTimeout(timer); timer = setTimeout(() => ctx.saveDraft(d.id, { subject: subject ? subject.value : null, body: area.value }), 600); };
    area.addEventListener("input", save);
    subject?.addEventListener("input", save);
    const act = el("div", "actions");
    const copy = el("button", "jv-btn", "Copy");
    copy.type = "button";
    copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText((subject?.value ? `${subject.value}\n\n` : "") + area.value); copy.textContent = "Copied"; } catch { copy.textContent = "Copy failed"; } setTimeout(() => (copy.textContent = "Copy"), 1500); });
    const send = el("button", "jv-btn", "Approve & Send");
    send.type = "button";
    send.disabled = true;
    send.title = `Connect ${svc} to send`;
    const queue = el("button", "jv-btn", "Queue for approval");
    queue.type = "button";
    queue.addEventListener("click", async () => { queue.disabled = true; queue.textContent = (await ctx.queueDraft(d.id)) ? "Queued" : "Couldn't queue"; });
    act.append(copy, queue, send, el("small", "muted", `${svc} not connected · nothing is sent without your tap`));
    form.append(act);
    b.append(form);
    return { draftId: d.id, getDraft: () => ({ id: d.id, subject: subject ? subject.value : null, body: area.value }) };
  },
  table(c, b) {
    if (!c.rows?.length) return b.append(el("p", "note", "Nothing recorded yet."));
    const wrap = el("div", "tablewrap");
    const t = el("table");
    const hr = el("tr");
    for (const col of c.columns) hr.append(el("th", null, col.replace(/_/g, " ")));
    t.append(hr);
    for (const r of c.rows) {
      const tr = el("tr");
      for (const col of c.columns) tr.append(el("td", null, r[col] == null ? "" : String(r[col]).slice(0, 120)));
      t.append(tr);
    }
    wrap.append(t);
    b.append(wrap);
  },
  player(c, b) {
    if (c.unavailable) return b.append(el("p", "note", c.unavailable));
    const p = c.player;
    const hero = el("div", "hero");
    hero.append(img(p.photo, p.name, "portrait"));
    const info = el("div", "heroinfo");
    info.append(el("div", "heroname", p.name));
    const prof = el("div", "from");
    for (const [k, v] of [["Sport", p.sport], ["Position", p.position], ["School / team", p.school], ["Status", p.status]]) if (v) prof.append(el("span", null, k), el("b", null, v));
    info.append(prof);
    const ig = igLink(p.instagram);
    info.append(ig || el("small", "muted", "No Instagram handle on the site yet"));
    if (!p.on_site) info.append(el("small", "muted", "Not shown on the website"));
    hero.append(info);
    b.append(hero, el("div", "sec", "Open deals"));
    b.append(c.deals?.length ? rowsList(c.deals, (li, d) => { li.append(el("b", null, d.name), el("span", "pill", d.stage || "—")); const sub = [d.business, d.amount != null ? fmtMoney(d.amount) : null, d.sample ? "sample" : null].filter(Boolean).join(" · "); if (sub) li.append(el("small", null, sub)); }) : el("p", "note", "No open deals."));
  },
  business(c, b) {
    if (c.unavailable) return b.append(el("p", "note", c.unavailable));
    const x = c.business;
    const hero = el("div", "hero");
    hero.append(img(x.logo || x.poster, x.name, "logo"));
    const info = el("div", "heroinfo");
    info.append(el("div", "heroname", x.name));
    const prof = el("div", "from");
    for (const [k, v] of [["What they do", x.tag], ["What we do for them", x.what_we_do], ["Status", x.status]]) if (v) prof.append(el("span", null, k), el("b", null, v));
    info.append(prof);
    const ig = igLink(x.instagram);
    if (ig) info.append(ig);
    hero.append(info);
    b.append(hero);
    if (c.deals?.length) b.append(el("div", "sec", "Deals"), rowsList(c.deals, (li, d) => { li.append(el("b", null, d.name), el("span", "pill", d.stage || "—")); }));
  },
  instagram_post(c, b) {
    if (c.unavailable) return b.append(el("p", "note", c.unavailable));
    const p = c.post;
    const wrap = el("div", "igpost");
    wrap.append(img(p.thumb_url, KIND[p.kind] || "Post", "igimg"));
    const side = el("div");
    side.append(el("small", "muted", [KIND[p.kind], fmtWhen(p.posted_at)].filter(Boolean).join(" · ")));
    if (p.caption) side.append(el("p", "caption", p.caption.length > 280 ? p.caption.slice(0, 280) + "…" : p.caption));
    side.append(stats([["likes", p.likes], ["comments", p.comments], ["reach", p.reach], [p.kind === "reel" || p.kind === "video" ? "plays" : "views", p.views], ["saves", p.saved], ["shares", p.shares]].filter(([, v], i) => i < 2 || v != null)));
    if (p.reach == null) side.append(el("small", "muted", "Reach isn't available for this post."));
    const link = postLink(p.permalink);
    if (link) side.append(link);
    wrap.append(side);
    b.append(wrap);
  },
  instagram_top(c, b) {
    if (c.unavailable) return b.append(el("p", "note", c.unavailable));
    const grid = el("div", "iggrid");
    const label = { reach: "reach", views: "views", likes: "likes", comments: "comments", engagement: "interactions" }[c.metric] || "reach";
    c.posts.forEach((p, i) => {
      const cell = el("div", "igcell");
      cell.append(img(p.thumb_url, KIND[p.kind] || "Post", "igimg"));
      const score = c.metric === "likes" ? p.likes : c.metric === "comments" ? p.comments : c.metric === "views" ? p.views : c.metric === "engagement" ? p.interactions ?? (p.likes || 0) + (p.comments || 0) : p.reach ?? p.interactions;
      cell.append(el("b", "rank", `#${i + 1}`), el("small", null, `${score == null ? `${fmtNum(p.likes)} likes` : `${fmtNum(score)} ${label}`} · ${fmtDate(p.posted_at)}`));
      const link = postLink(p.permalink);
      if (link) { link.textContent = "Open ↗"; cell.append(link); }
      grid.append(cell);
    });
    b.append(grid);
  },
  instagram_followers(c, b) {
    if (c.unavailable) return b.append(el("p", "note", c.unavailable));
    b.append(el("div", "big", fmtNum(c.followers)), el("p", "note", c.gained == null ? "followers" : `followers · ${c.gained >= 0 ? "+" : ""}${fmtNum(c.gained)} since ${fmtDate(c.from)}`));
    if (c.series?.length > 1) b.append(areaChart(c.series, { fromMin: true }));
    if (c.note) b.append(el("p", "note", c.note));
    b.append(stats([["following", c.following], ["posts", c.posts]]));
  },
  briefing(c, b) {
    const f = c.facts || {};
    b.append(el("p", null, c.text));
    if (f.tasks?.length) b.append(el("div", "sec", "Today's tasks"), rowsList(f.tasks, (li, t) => { li.append(el("b", null, t.title), el("small", null, [cap(t.owner), t.overdue ? "overdue" : null].filter(Boolean).join(" · "))); }));
    if (f.deadlines?.length) b.append(el("div", "sec", "Deadlines this week"), rowsList(f.deadlines, (li, m) => { li.append(el("b", null, m.content), el("small", null, fmtDate(m.due_date))); }));
    if (f.visitors_yesterday != null) b.append(el("div", "sec", "Website yesterday"), el("div", "big", f.visitors_yesterday));
    if (f.deals_needing_follow_up?.length) b.append(el("div", "sec", "Deals needing follow-up"), rowsList(f.deals_needing_follow_up, (li, d) => { li.append(el("b", null, d.name), el("span", "pill", d.stage || "")); }));
    if (f.growth_move) b.append(el("div", "sec", "Growth move"), rowsList([f.growth_move], (li, m) => { li.append(el("b", null, m.title)); if (m.first_step) li.append(el("small", null, `First step: ${m.first_step}`)); }));
  },
};

const WIDE = new Set(["deals", "table", "briefing", "email", "instagram_top", "instagram_post"]);

export function renderCard(c, ctx) {
  const node = el("article", `jv-card${WIDE.has(c.type) ? " wide" : ""}`);
  node.dataset.cardId = c.id;
  node.dataset.type = c.type;
  const head = el("header");
  head.append(el("h3", null, c.title));
  if (c.sample) head.append(el("em", "jv-sample", "sample"));
  const close = el("button", "jv-x", "✕");
  close.type = "button";
  close.setAttribute("aria-label", `Close ${c.title}`);
  close.addEventListener("click", () => ctx.close(c.id));
  const body = el("div");
  const extra = (RENDER[c.type] || RENDER.table)(c, body, ctx) || {};
  node.append(head, close, body);
  return { node, ...extra };
}
