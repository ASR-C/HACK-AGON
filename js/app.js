/* ============================================================
   HackAgon — app.js
   Shared shell: top bar + bottom nav, auth guard, toasts,
   dialogs, hand-drawn inline SVG icon set, and small helpers.
   ============================================================ */

(function () {
  const S = window.Store;

  /* ---------- helpers ---------- */
  const qs = (sel, root) => (root || document).querySelector(sel);
  const qsa = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  function el(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function escapeHtml(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function on(node, ev, fn, opts) { if (node) node.addEventListener(ev, fn, opts); }
  function money(paise) { return S.formatInr(paise); }

  /* ---------- icon set (hand-drawn stroke SVGs, no emoji) ---- */
  const P = (d, extra) => `<path d="${d}" ${extra || ""}/>`;
  const ICONS = {
    logo: `<svg viewBox="0 0 40 40" fill="none" stroke="#2A211B" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6c0 8-2 12-2 16s3 12 14 12 14-8 14-13-4-7-4-11" stroke="#B4523A"/><path d="M14 20h12M20 14v12" stroke="#DD9A2B"/><path d="M11 8l3 3M29 8l-3 3"/></svg>`,
    trophy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M7 6H4v1a4 4 0 0 0 3 3.9M17 6h3v1a4 4 0 0 1-3 3.9"/><path d="M10 19h4M9 22h6M12 14v5"/></svg>`,
    arena: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4l7 3 7-3v17"/><path d="M5 21h14M9 10h6M9 14h6"/></svg>`,
    swords: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 14.5 20 20M20 4l-8 8M4 4l8 8M9.5 14.5 4 20"/><path d="M17 3h4v4M7 3H3v4M17 21h4v-4M7 21H3v-4"/></svg>`,
    book: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-2V5Z"/><path d="M8 3v18M11 8h4M11 12h4"/></svg>`,
    user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>`,
    plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
    search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`,
    clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
    users: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-3.3 3-5 6.5-5s6.5 1.7 6.5 5"/><path d="M16 5.5a3 3 0 0 1 0 5.6M18 14.4c2.2.6 3.5 2.2 3.5 4.6"/></svg>`,
    rupee: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10M7 8.5h10M7 4c5 0 7 2 7 4.5S12 13 7 13l7 7"/></svg>`,
    lock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10" width="15" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 15v2"/></svg>`,
    camera: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h2L9 4h6l1.5 2h2A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-9Z"/><circle cx="12" cy="13" r="3.4"/></svg>`,
    check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m4 12.5 5 5L20 6.5"/></svg>`,
    x: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
    chevron: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>`,
    alert: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 22 20H2L12 3.5Z"/><path d="M12 10v4M12 17.5v.5"/></svg>`,
    info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6v.4"/></svg>`,
    crown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8l4 4 5-7 5 7 4-4-2 11H5L3 8Z"/></svg>`,
    star: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3.6 2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 17l-5.3 2.8 1.1-5.9L3.5 9.8l5.9-.8L12 3.6Z"/></svg>`,
    shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6l7-3Z"/><path d="m9 12 2 2 4-4"/></svg>`,
    drop: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5s6 6.2 6 10.2a6 6 0 0 1-12 0C6 9.7 12 3.5 12 3.5Z"/></svg>`,
    code: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 7-5 5 5 5M15 7l5 5-5 5M13 4l-2 16"/></svg>`,
    play: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4.8 19 12 7 19.2V4.8Z"/></svg>`,
    refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-.7 4.5"/><path d="M20 5v6h-6"/></svg>`,
    edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L20 8l-4-4L4 16v4Z"/><path d="m14 6 4 4"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>`,
    external: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H10"/></svg>`,
    logout: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15"/><path d="M10 8 6 12l4 4M6 12h9"/></svg>`,
    flag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 21V4M6 5h11l-2 4 2 4H6"/></svg>`,
    filter: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16l-6 7v5l-4 2v-7L4 6Z"/></svg>`,
    bolt: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3 5 14h6l-1 7 8-11h-6l1-7Z"/></svg>`,
    eye: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>`,
    send: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 3 10.5 13.5M21 3l-6.8 18-3.7-7.5L3 9.8 21 3Z"/></svg>`,
    building: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V6l7-3v18M11 21h9V10l-9-3M15 12h2M15 16h2M7 9h1M7 13h1M7 17h1"/></svg>`,
    menu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`
  };
  function icon(name, cls) { return `<span class="ic ${cls || ""}" aria-hidden="true">${ICONS[name] || ""}</span>`; }

  /* ---------- avatar ---------- */
  function initials(name) { return (name || "?").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase(); }
  function avatarHtml(user, size) {
    const name = user && (user.name || user.username) || "?";
    const seedStr = (user && (user.id || user.username) || name);
    let h = 0; for (let i = 0; i < seedStr.length; i++) h = (h * 31 + seedStr.charCodeAt(i)) >>> 0;
    const cls = "av-" + (1 + (h % 5));
    return `<span class="avatar ${cls} ${size ? "avatar--" + size : ""}" title="${escapeHtml(name)}">${escapeHtml(initials(name))}</span>`;
  }

  /* ---------- status / difficulty renderers ---------- */
  function statusBadge(room) {
    const map = { live: ["badge--live", "Live now"], open: ["badge--open", "Open"], full: ["badge--full", "Full"], ended: ["badge--ended", "Ended"], draft: ["badge--draft", "Draft"], soon: ["badge--soon", "Starts soon"] };
    let key = room.status;
    if (room.status === "open" && room.players.length >= room.size) key = "full";
    const m = map[key] || ["badge--ended", key];
    return `<span class="badge ${m[0]}">${m[1]}</span>`;
  }
  function diffPill(d) { return `<span class="diff diff--${d}"><span class="diff__dot"></span>${d[0].toUpperCase() + d.slice(1)}</span>`; }
  function priceTag(room) {
    if (room.entryFeePaise > 0) return `<span class="badge badge--paid">${money(room.entryFeePaise)} entry</span>`;
    return `<span class="badge badge--free">Free</span>`;
  }

  /* ---------- toasts ---------- */
  function toast(message, opts) {
    opts = opts || {};
    let stack = qs(".toast-stack");
    if (!stack) { stack = el('<div class="toast-stack" role="status" aria-live="polite"></div>'); document.body.appendChild(stack); }
    const iconName = opts.type === "success" ? "check" : opts.type === "error" ? "alert" : opts.type === "dev" ? "code" : "info";
    const t = el(`<div class="toast toast--${opts.type || "info"}">${icon(iconName, "toast__icon")}<div>${escapeHtml(message)}${opts.detail ? `<div class="xs" style="opacity:.85;margin-top:2px">${escapeHtml(opts.detail)}</div>` : ""}</div></div>`);
    stack.appendChild(t);
    setTimeout(() => { t.classList.add("is-out"); setTimeout(() => t.remove(), 260); }, opts.ms || (opts.type === "dev" ? 8000 : 4200));
    return t;
  }

  /* ---------- confirm dialog ---------- */
  function confirmDialog(opts) {
    return new Promise(resolve => {
      const back = el(`<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">
        <div class="modal__head"><div class="modal__title">${escapeHtml(opts.title || "Are you sure?")}</div>
        <button class="icon-btn" data-x aria-label="Close">${icon("x")}</button></div>
        <div class="modal__body">${opts.body || ""}</div>
        <div class="modal__foot"><button class="btn btn--ghost" data-no>${escapeHtml(opts.cancelText || "Cancel")}</button>
        <button class="btn ${opts.danger ? "btn--danger" : "btn--primary"}" data-yes>${escapeHtml(opts.okText || "Confirm")}</button></div>
      </div></div>`);
      document.body.appendChild(back);
      requestAnimationFrame(() => back.classList.add("is-open"));
      function done(v) { back.classList.remove("is-open"); setTimeout(() => back.remove(), 220); resolve(v); }
      on(qs("[data-yes]", back), "click", () => done(true));
      on(qs("[data-no]", back), "click", () => done(false));
      on(qs("[data-x]", back), "click", () => done(false));
      on(back, "click", e => { if (e.target === back) done(false); });
    });
  }

  /* ---------- generic modal ---------- */
  function openModal(html, opts) {
    opts = opts || {};
    const back = el(`<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" style="${opts.width ? "width:min(" + opts.width + "px,100%)" : ""}">${html}</div></div>`);
    document.body.appendChild(back);
    requestAnimationFrame(() => back.classList.add("is-open"));
    on(back, "click", e => { if (e.target === back) closeModal(back); });
    qsa("[data-close]", back).forEach(b => on(b, "click", () => closeModal(back)));
    return back;
  }
  function closeModal(back) { const b = back || qs(".modal-backdrop"); if (!b) return; b.classList.remove("is-open"); setTimeout(() => b.remove(), 220); }

  /* ---------- shell: top bar + bottom nav ---------- */
  const TABS = [
    { id: "tournaments", label: "Tournaments", href: "tournaments.html", icon: "trophy" },
    { id: "arena", label: "Arena", href: "arena.html", icon: "arena" },
    { id: "duel", label: "Duel", href: "duel.html", icon: "swords" },
    { id: "learning", label: "Learning", href: "learning.html", icon: "book" },
    { id: "profile", label: "Profile", href: "profile.html", icon: "user" }
  ];

  function renderTopbar() {
    const u = S.currentUser();
    let existing = qs(".topbar"); if (existing) existing.remove();
    const actions = u
      ? `<a class="btn btn--sm btn--ghost hide-sm" href="create-room.html">${icon("plus")} Host</a>
         <div class="profile-chip" data-menu>
           <button class="icon-btn" aria-haspopup="true" aria-label="Account menu" style="width:auto;padding:0 6px;gap:6px;display:flex;align-items:center;border-radius:999px">
             ${avatarHtml(u, "sm")}
           </button>
           <div class="profile-menu">
             <div class="pm-head"><strong>${escapeHtml(u.name)}</strong><span class="xs faint">@${escapeHtml(u.username)}</span></div>
             <a href="profile.html">${icon("user")} Profile</a>
             <a href="host-dashboard.html">${icon("flag")} Host dashboard</a>
             ${u.isAdmin ? `<a href="admin.html">${icon("shield")} Admin</a>` : ""}
             <button data-logout>${icon("logout")} Log out</button>
           </div>
         </div>`
      : `<a class="btn btn--sm btn--ghost" href="login.html">Log in</a>
         <a class="btn btn--sm btn--primary" href="signup.html">Sign up</a>`;
    const bar = el(`<header class="topbar"><div class="wrap">
        <a class="brand" href="${u ? "arena.html" : "index.html"}"><span class="brand__mark">${ICONS.logo}</span><span class="brand__name">Hack<span>Agon</span></span></a>
        <span class="topbar__spacer"></span>
        <div class="topbar__actions">${actions}</div>
      </div></header>`);
    document.body.prepend(bar);
    on(qs("[data-logout]", bar), "click", () => { S.logout(); location.href = "index.html"; });
    const chip = qs("[data-menu]", bar);
    if (chip) {
      on(chip, "click", e => { e.stopPropagation(); chip.classList.toggle("open"); });
      on(document, "click", () => chip.classList.remove("open"));
    }
  }

  function renderBottomNav(active) {
    const u = S.currentUser();
    if (!u) return; // nav only after login (PRD §8)
    let nav = qs(".bottomnav"); if (nav) nav.remove();
    const items = TABS.map(t => `
      <a class="bottomnav__item ${active === t.id ? "is-active" : ""}" href="${t.href}" ${active === t.id ? 'aria-current="page"' : ""}>
        ${icon(t.icon)}<span>${t.label}</span>
      </a>`).join("");
    nav = el(`<nav class="bottomnav is-visible" aria-label="Main">${items.slice(0, 2)}
      <a class="bottomnav__host" href="#" data-host>${icon("plus")} Host</a>
      ${items.slice(2)}</nav>`);
    document.body.appendChild(nav);
    on(qs("[data-host]", nav), "click", e => { e.preventDefault(); hostChooser(); });
  }

  function hostChooser() {
    const u = S.currentUser();
    const orgNote = u && u.org ? "" : `<p class="xs faint" style="margin-top:6px">Running a big paid event for a college or club? Request organisation status from the tournament form.</p>`;
    openModal(`<div class="modal__head"><div class="modal__title">What are you hosting?</div><button class="icon-btn" data-close aria-label="Close">${icon("x")}</button></div>
      <div class="modal__body stack">
        <a class="card card--sticker tile" href="create-room.html"><div><div class="tile__title">A room</div><p class="small muted">Free or paid contest for friends, a class, or the public. Set it up in under 3 minutes.</p></div>${icon("chevron")}</a>
        <a class="card card--sticker tile" href="create-tournament.html"><div><div class="tile__title">A tournament</div><p class="small muted">Escrowed prize pool, entry fees, prize split, optional proctoring.</p>${u && u.org ? `<span class="badge badge--proctored" style="margin-top:6px">${icon("building")} ${escapeHtml(u.org.name)}</span>` : ""}</div>${icon("chevron")}</a>
        ${orgNote}
      </div>`, { width: 520 });
  }

  function mountShell(active, opts) {
    opts = opts || {};
    renderTopbar();
    if (opts.nav !== false) renderBottomNav(active);
  }

  /* ---------- page runner ------------------------------------
     Every page waits for the server bootstrap before rendering,
     so reads from Store are always against live MySQL data. */
  function serverDown(message) {
    const host = document.querySelector("#root") || document.querySelector(".page") || document.body;
    host.innerHTML = `<div class="card card--sticker" style="max-width:640px;margin:12vh auto">
      <div class="card__title">${icon("alert")} Can't reach the HackAgon server</div>
      <p class="lead">${escapeHtml(message || "The API didn't answer.")}</p>
      <p class="small muted">Start it with <code>cd server &amp;&amp; npm start</code>, then open
      <code>http://localhost:8080</code>. The database is MySQL &mdash; run <code>npm run setup</code> in
      <code>server/</code> once if this is a fresh checkout.</p>
      <div class="row" style="margin-top:var(--sp-4)"><button class="btn btn--primary" onclick="location.reload()">${icon("refresh")} Try again</button></div>
    </div>`;
  }

  function page(fn, opts) {
    opts = opts || {};
    return S.ready.then(async () => {
      if (S.state.error) { serverDown(S.state.error); return; }
      try {
        await fn();
      } catch (err) {
        console.error("[HackAgon] page error:", err);
        if (!opts.quiet) toast(err && err.message ? err.message : "Something broke on our side.", { type: "error" });
      }
    }).catch(err => {
      console.error("[HackAgon] boot error:", err);
      serverDown(err && err.message);
    });
  }

  /* Runs an async handler and surfaces API errors as toasts. */
  function act(fn, busyNode) {
    return async function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      if (busyNode) busyNode.disabled = true;
      try { return await fn(ev); }
      catch (err) {
        console.error("[HackAgon]", err);
        toast(err && err.message ? err.message : "That didn't work.", { type: "error", detail: err && err.errs ? Object.values(err.errs).join(" ") : "" });
      } finally { if (busyNode) busyNode.disabled = false; }
    };
  }

  /* Field-level errors from a 422 response. Keys are either the data-f name on
     the .field wrapper or the id of the control inside it. */
  function showErrs(errs, map) {
    Object.keys(errs || {}).forEach(k => {
      const node = (map && map[k]) || document.querySelector(`[data-f="${k}"]`) || document.querySelector(`#${k}`);
      if (!node) return;
      const field = node.classList.contains("field") ? node : node.closest(".field");
      if (!field) return;
      field.classList.add("is-invalid");
      let hint = field.querySelector(".error-text");
      if (!hint) { hint = document.createElement("span"); hint.className = "error-text"; field.appendChild(hint); }
      hint.textContent = errs[k];
    });
  }
  function clearErrs(root) {
    (root || document).querySelectorAll(".is-invalid").forEach(n => n.classList.remove("is-invalid"));
    (root || document).querySelectorAll(".field__err").forEach(n => n.remove());
    (root || document).querySelectorAll(".error-text").forEach(n => { n.textContent = ""; });
  }

  function requireAuth() {
    const u = S.currentUser();
    if (!u) { const back = location.pathname.split("/").pop() || "index.html"; location.href = "login.html?next=" + encodeURIComponent(back + location.search); return null; }
    return u;
  }

  /* ---------- room tile renderer (shared) ---------- */
  function roomTile(room) {
    const qCount = (room.questionIds || []).length;
    const full = room.players.length >= room.size;
    return `<a class="card card--sticker tile" href="${room.type === "tournament" ? "tournament-details.html" : "match.html"}?room=${room.id}">
      <div class="tile__top">${statusBadge(room)} ${room.tournamentMode ? `<span class="badge badge--proctored">${icon("camera")} Proctored</span>` : ""}</div>
      <div class="tile__title">${escapeHtml(room.name)}</div>
      <div class="tile__meta">
        <span>${icon("users")} ${room.players.length}/${room.size}</span>
        <span>${icon("clock")} ${room.durationMin}m</span>
        <span>${icon("code")} ${qCount} question${qCount === 1 ? "" : "s"}</span>
        <span>${escapeHtml(room.format)}</span>
      </div>
      <div class="row row--tight" style="gap:6px">${(room.topics || []).slice(0, 3).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>
      <div class="tile__foot">${priceTag(room)} ${room.prizePoolPaise ? `<span class="small"><strong>Prize ${money(room.prizePoolPaise)}</strong></span>` : `<span class="xs faint">by ${escapeHtml(room.hostName || "a host")}</span>`}</div>
    </a>`;
  }

  /* ---------- empty state ---------- */
  function emptyState(title, text, ctaHtml) {
    return `<div class="empty">
      <svg class="empty__art" viewBox="0 0 120 120" fill="none" stroke="#B4523A" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 92c0-16 12-24 12-40" stroke="#DD9A2B"/><path d="M34 52c-10 0-16-8-16-16 8 0 16 4 16 16Z" stroke="#2F5D50"/>
        <path d="M34 60c10-2 14-10 13-18-8 1-14 7-13 18Z" stroke="#2F5D50"/><path d="M20 92h70" stroke="#2A211B"/>
        <path d="M60 92V70M60 70c0-8 6-14 14-14M60 74c0-7-5-12-12-12" stroke="#2A211B"/>
        <circle cx="74" cy="56" r="4" stroke="#B4523A"/><circle cx="48" cy="62" r="3.5" stroke="#B4523A"/>
      </svg>
      <div class="empty__title">${escapeHtml(title)}</div>
      <p class="empty__text">${escapeHtml(text)}</p>
      ${ctaHtml || ""}
    </div>`;
  }

  /* ---------- tiny markdown renderer (for the AI coach) ------
     Escapes first, so model output can never inject markup. */
  function mdToHtml(src) {
    const code = [];
    let s = escapeHtml(String(src || ""));
    s = s.replace(/```([a-zA-Z0-9+#-]*)\n?([\s\S]*?)```/g, (m, lang, body) => {
      code.push(`<pre class="md__code"${lang ? ` data-lang="${lang}"` : ""}><code>${body.replace(/\n$/, "")}</code></pre>`);
      return `\u0000${code.length - 1}\u0000`;
    });
    s = s.replace(/`([^`\n]+)`/g, (m, t) => `<code class="md__inline">${t}</code>`);
    const lines = s.split("\n");
    const out = [];
    let list = null;
    const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
    for (const raw of lines) {
      const line = raw.trimEnd();
      const t = line.trim();
      if (!t) { closeList(); continue; }
      if (/^\u0000\d+\u0000$/.test(t)) { closeList(); out.push(t); continue; }
      const h = t.match(/^(#{1,4})\s+(.*)$/);
      if (h) { closeList(); out.push(`<strong class="md__h">${inline(h[2])}</strong>`); continue; }
      const ul = t.match(/^[-*+]\s+(.*)$/);
      if (ul) { if (list !== "ul") { closeList(); out.push('<ul class="md__ul">'); list = "ul"; } out.push(`<li>${inline(ul[1])}</li>`); continue; }
      const ol = t.match(/^\d+[.)]\s+(.*)$/);
      if (ol) { if (list !== "ol") { closeList(); out.push('<ol class="md__ol">'); list = "ol"; } out.push(`<li>${inline(ol[1])}</li>`); continue; }
      closeList();
      out.push(`<p class="md__p">${inline(t)}</p>`);
    }
    closeList();
    return out.join("").replace(/\u0000(\d+)\u0000/g, (m, i) => code[+i]);
  }
  function inline(t) {
    return t
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  }

  window.App = {
    qs, qsa, el, escapeHtml, on, money, icon, ICONS,
    initials, avatarHtml, statusBadge, diffPill, priceTag,
    toast, confirmDialog, openModal, closeModal,
    mountShell, renderTopbar, renderBottomNav, requireAuth, hostChooser,
    page, act, showErrs, clearErrs, serverDown, mdToHtml,
    roomTile, emptyState
  };

  // Small CSS injected once for shell-only bits (profile menu, icon sizing)
  const style = document.createElement("style");
  style.textContent = `
    .ic{display:inline-flex;width:1em;height:1em;flex:none}.ic>svg{width:100%;height:100%}
    .btn .ic,.bottomnav__item .ic{width:18px;height:18px}.bottomnav__item .ic{width:24px;height:24px}
    .toast__icon.ic{width:22px;height:22px}
    .profile-chip{position:relative}
    .profile-menu{position:absolute;right:0;top:calc(100% + 8px);min-width:220px;background:var(--surface);border:var(--bw-thick) solid var(--ink);border-radius:var(--r-md);box-shadow:var(--sh-lift);padding:var(--sp-2);display:none;z-index:80}
    .profile-chip.open .profile-menu{display:block}
    .profile-menu a,.profile-menu button{display:flex;align-items:center;gap:8px;width:100%;padding:.55rem .7rem;border-radius:var(--r-sm);color:var(--ink);text-decoration:none;font-weight:600;font-size:var(--fs-sm);text-align:left}
    .profile-menu a:hover,.profile-menu button:hover{background:var(--surface-sunk)}
    .pm-head{display:flex;flex-direction:column;padding:.4rem .7rem .55rem;border-bottom:var(--bw) dashed var(--border);margin-bottom:var(--sp-2)}
    .md__p{margin:.35rem 0;font-size:var(--fs-sm);line-height:1.55}
    .md__h{display:block;margin:.7rem 0 .25rem;font-size:var(--fs-sm);text-transform:uppercase;letter-spacing:.06em}
    .md__ul,.md__ol{margin:.3rem 0 .5rem 1.2rem;font-size:var(--fs-sm);line-height:1.55}
    .md__inline{font-family:var(--font-mono);background:var(--surface-sunk);padding:.05em .35em;border-radius:4px;font-size:.92em}
    .md__code{background:var(--surface-sunk);border:var(--bw) solid var(--border);border-radius:var(--r-md);padding:var(--sp-3);overflow:auto;font-family:var(--font-mono);font-size:var(--fs-xs);margin:.4rem 0 .6rem}
    .ai-box{border:var(--bw) dashed var(--border-strong);border-radius:var(--r-md);background:var(--surface-sunk);padding:var(--sp-3);margin-top:var(--sp-3)}
    .ai-box__head{display:flex;align-items:center;gap:6px;font-weight:700;font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
    .hide-sm{}
    @media(max-width:760px){.hide-sm{display:none!important}}
  `;
  document.head.appendChild(style);
})();
