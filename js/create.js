/* ============================================================
   HackAgon — create.js
   Shared room / tournament creation form with the question
   side panel. Every field starts with an editable default.
   ============================================================ */

(function () {
  const S = window.Store, SEED = S.SEED;
  const { qs, qsa, on, el, icon, toast, escapeHtml, money } = window.App;

  function init(opts) {
    const isT = !!opts.tournament;
    const root = qs("#createForm");

    const state = {
      name: "", format: "Solo", size: 10, squadSize: 4, langs: ["java"], topics: ["arrays"],
      questionIds: [], durationMin: 60, timePerQ: null, visibility: "Public",
      prizePool: "", entryFee: "", tournamentMode: false, snapshotSecs: 25,
      splitPreset: "top3", customSplit: { 1: "", 2: "", 3: "", 4: "", 5: "" }, minPlayers: 2,
      publish: true
    };
    // auto-pick default: 5 questions by default topic
    state.questionIds = autoPick(state.topics, 5);

    function autoPick(topics, n) {
      const pool = S.listQuestions().filter(q => q.topics.some(t => topics.includes(t)));
      const ordered = pool.slice().sort((a, b) => rank(a.difficulty) - rank(b.difficulty));
      return ordered.slice(0, n).map(q => q.id);
    }
    function rank(d) { return { easy: 0, medium: 1, hard: 2 }[d] || 0; }

    /* ---------- form markup ---------- */
    root.innerHTML = `
      <div class="split split--sidebar" style="grid-template-columns:minmax(0,1fr) 320px;align-items:start">
        <div class="stack stack-5">
          <div class="field" data-f="name">
            <label class="label" for="f-name">Room name <span class="req">*</span></label>
            <input class="input" id="f-name" maxlength="50" placeholder="${isT ? "e.g. Monsoon Clash 2026" : "e.g. Friday night arrays"}" />
            <span class="hint">3&ndash;50 characters. This is what players see in the list.</span>
            <span class="error-text"></span>
          </div>

          <div class="grid grid-2">
            <div class="field">
              <span class="label">Format</span>
              <div class="seg" id="f-format">
                ${["Solo", "Duo", "Squad", "Duel"].map((f, i) => `<label class="seg__opt"><input type="radio" name="format" value="${f}" ${i === 0 ? "checked" : ""}><span>${f}</span></label>`).join("")}
              </div>
              <span class="hint" id="formatHint">Individual ranking.</span>
            </div>
            <div class="field" data-f="size">
              <label class="label" for="f-size" id="sizeLabel">Players</label>
              <input class="input" id="f-size" type="number" min="2" max="100" value="10" />
              <div class="field hide" id="squadWrap" style="margin-top:8px">
                <label class="label" for="f-squad">Squad size (3&ndash;5)</label>
                <input class="input" id="f-squad" type="number" min="3" max="5" value="4" />
              </div>
              <span class="error-text"></span>
            </div>
          </div>

          <div class="grid grid-2">
            <div class="field">
              <span class="label">Languages <span class="req">*</span></span>
              <div class="stack stack-2" id="f-langs">
                ${SEED.languages.map((l, i) => `<label class="check"><input type="checkbox" value="${l.id}" ${l.id === "java" ? "checked" : ""}><span class="check__box">${icon("check")}</span><span class="check__text">${l.label}</span></label>`).join("")}
              </div>
              <span class="error-text" data-err="langs"></span>
            </div>
            <div class="field">
              <span class="label">Topics</span>
              <div class="stack stack-2" id="f-topics" style="max-height:220px;overflow:auto">
                ${SEED.topics.map(t => `<label class="check"><input type="checkbox" value="${t.id}" ${t.id === "arrays" ? "checked" : ""}><span class="check__box">${icon("check")}</span><span class="check__text">${t.label}</span></label>`).join("")}
              </div>
              <span class="hint">Used for auto-picking questions.</span>
            </div>
          </div>

          <div class="card card--well">
            <div class="row row--between" style="margin-bottom:var(--sp-3)">
              <div><span class="label">Questions <span class="req">*</span></span><span class="hint">Pick from the bank, or auto-pick by topic.</span></div>
              <div class="row row--tight">
                <button class="btn btn--sm btn--ghost" type="button" id="autoPickBtn">${icon("bolt")} Auto-pick 5</button>
                <button class="btn btn--sm btn--primary" type="button" id="openPanelBtn">${icon("search")} Browse bank</button>
              </div>
            </div>
            <div id="qList" class="stack stack-2"></div>
            <span class="error-text" data-err="questions"></span>
          </div>

          <div class="grid grid-3">
            <div class="field" data-f="duration">
              <label class="label" for="f-duration">Total duration (min)</label>
              <input class="input" id="f-duration" type="number" min="15" max="360" value="60" />
              <span class="hint">15 min to 6 hours.</span>
              <span class="error-text"></span>
            </div>
            <div class="field">
              <label class="label" for="f-timeperq">Time per question</label>
              <select class="select" id="f-timeperq"><option value="">None</option>${[5, 10, 15, 20, 30, 45, 60, 90, 120].map(v => `<option value="${v}">${v} min</option>`).join("")}</select>
              <span class="hint">Optional per-question cap.</span>
            </div>
            <div class="field">
              <span class="label">Visibility</span>
              <div class="seg" id="f-vis">
                <label class="seg__opt"><input type="radio" name="vis" value="Public" checked><span>Public</span></label>
                <label class="seg__opt"><input type="radio" name="vis" value="Private"><span>Private</span></label>
              </div>
              <div class="hide" id="inviteWrap" style="margin-top:8px"><span class="hint">Invite code:</span> <code class="mono" id="inviteCode" style="font-weight:700"></code></div>
            </div>
          </div>

          <div class="card card--flat" style="border:var(--bw) solid var(--border-strong)">
            <div class="row row--between">
              <div>
                <span class="label">Tournament mode (anti-cheat)</span>
                <p class="hint">Webcam + tab-lock for the whole match. Players must accept before joining.</p>
              </div>
              <label class="switch"><input type="checkbox" id="f-tmode"><span class="switch__track"></span></label>
            </div>
            <div class="hide" id="tmodeOpts" style="margin-top:var(--sp-4)">
              <div class="field" style="max-width:240px">
                <label class="label" for="f-snapshot">Snapshot every (sec)</label>
                <input class="input" id="f-snapshot" type="number" min="20" max="30" value="25" />
                <span class="hint">20&ndash;30 seconds.</span>
              </div>
            </div>
          </div>

          ${isT ? moneyBlock() : ""}
        </div>

        <aside class="stack stack-4" style="position:sticky;top:calc(var(--topbar-h) + 16px)">
          <div class="card card--sticker">
            <div class="card__title">Ready to publish?</div>
            <div class="stack stack-2" id="summary" style="margin-top:var(--sp-3)"></div>
            <button class="btn btn--primary btn--block" type="button" id="publishBtn" style="margin-top:var(--sp-4)">${isT ? "Fund &amp; open registration" : "Publish room"}</button>
            <button class="btn btn--ghost btn--block" type="button" id="draftBtn" style="margin-top:var(--sp-2)">Save as draft</button>
            <p class="xs faint" style="margin-top:var(--sp-3)">${isT ? "A paid tournament stays a draft until the full prize pool clears." : "Settings lock once the contest starts."}</p>
          </div>
        </aside>
      </div>

      <!-- question side panel -->
      <div class="sheet-backdrop" id="sheetBack"></div>
      <aside class="sheet" id="sheet" aria-label="Question bank">
        <div class="sheet__head"><div class="card__title">Question bank</div><button class="icon-btn" id="closeSheet" aria-label="Close">${icon("x")}</button></div>
        <div class="sheet__body">
          <div class="stack stack-3">
            <select class="select" id="p-lang"><option value="">Any language</option>${SEED.languages.map(l => `<option value="${l.id}">${l.label}</option>`).join("")}</select>
            <select class="select" id="p-topic"><option value="">Any topic</option>${SEED.topics.map(t => `<option value="${t.id}">${t.label}</option>`).join("")}</select>
            <div class="chips" id="p-diff">
              <button class="chip is-active" data-d="">Any</button><button class="chip" data-d="easy">Easy</button><button class="chip" data-d="medium">Medium</button><button class="chip" data-d="hard">Hard</button>
            </div>
          </div>
          <div class="stack stack-2" id="panelList" style="margin-top:var(--sp-4)"></div>
        </div>
        <div class="sheet__foot"><span class="small" id="panelCount"></span><button class="btn btn--primary" id="doneSheet">Done</button></div>
      </aside>
    `;

    function moneyBlock() {
      return `
      <div class="card card--flat" style="border:var(--bw) solid var(--border-strong)">
        <div class="card__title" style="margin-bottom:var(--sp-3)">Money</div>
        <div class="grid grid-2">
          <div class="field" data-f="prize">
            <label class="label" for="f-prize">Prize pool (₹)</label>
            <input class="input" id="f-prize" type="number" min="0" step="1" placeholder="0 for none" />
            <span class="hint">You fund this up front via Razorpay.</span>
            <span class="error-text"></span>
          </div>
          <div class="field" data-f="entry">
            <label class="label" for="f-entry">Entry fee (₹)</label>
            <input class="input" id="f-entry" type="number" min="0" step="1" placeholder="0 for free" />
            <span class="hint">Held in escrow. No platform fee on entry.</span>
            <span class="error-text"></span>
          </div>
        </div>
        <div class="grid grid-2" style="margin-top:var(--sp-4)">
          <div class="field">
            <span class="label">Prize split</span>
            <select class="select" id="f-split">${SEED.prizePresets.map(p => `<option value="${p.id}" ${p.id === "top3" ? "selected" : ""}>${p.label}</option>`).join("")}</select>
          </div>
          <div class="field" style="max-width:160px">
            <label class="label" for="f-min">Min players</label>
            <input class="input" id="f-min" type="number" min="2" max="100" value="2" />
          </div>
        </div>
        <div id="customSplit" class="hide" style="margin-top:var(--sp-4)">
          <span class="label">Custom % per rank (must total 100)</span>
          <div class="row" style="margin-top:8px">
            ${[1, 2, 3, 4, 5].map(r => `<div class="field" style="width:70px"><label class="xs" for="cs-${r}">#${r}</label><input class="input" id="cs-${r}" type="number" min="0" max="100" placeholder="0"></div>`).join("")}
          </div>
          <span class="hint" id="splitTotal" style="margin-top:6px">Total: 0%</span>
        </div>
        <div class="escrow" style="margin-top:var(--sp-4);font-size:var(--fs-xs);color:var(--text-faint)">Platform fee is 1% of the prize pool, deducted before payouts. Splits lock once registration opens.</div>
      </div>`;
    }

    /* ---------- wiring ---------- */
    const fmtHints = { Solo: "Individual ranking.", Duo: "Teams of two; team score is the sum of members.", Squad: "Teams of 3&ndash;5; a question counts once per team.", Duel: "One versus one on the same set; first to pass all wins." };
    on(qs("#f-format"), "change", e => {
      state.format = e.target.value;
      qs("#formatHint").innerHTML = fmtHints[state.format];
      qs("#sizeLabel").textContent = state.format === "Solo" ? "Players" : "Teams";
      qs("#squadWrap").classList.toggle("hide", state.format !== "Squad");
      qs("#f-size").max = state.format === "Solo" ? 100 : 50;
      sync();
    });
    on(qs("#f-name"), "input", e => { state.name = e.target.value; sync(); });
    on(qs("#f-size"), "input", e => { state.size = Number(e.target.value); sync(); });
    on(qs("#f-squad"), "input", e => { state.squadSize = Number(e.target.value); sync(); });
    on(qs("#f-langs"), "change", () => { state.langs = qsa("#f-langs input:checked").map(i => i.value); sync(); });
    on(qs("#f-topics"), "change", () => { state.topics = qsa("#f-topics input:checked").map(i => i.value); sync(); });
    on(qs("#f-duration"), "input", e => { state.durationMin = Number(e.target.value); sync(); });
    on(qs("#f-timeperq"), "change", e => { state.timePerQ = e.target.value ? Number(e.target.value) : null; sync(); });
    on(qs("#f-vis"), "change", e => {
      state.visibility = e.target.value;
      qs("#inviteWrap").classList.toggle("hide", state.visibility !== "Private");
      if (state.visibility === "Private") qs("#inviteCode").textContent = "issued on publish";
      sync();
    });
    on(qs("#f-tmode"), "change", e => { state.tournamentMode = e.target.checked; qs("#tmodeOpts").classList.toggle("hide", !state.tournamentMode); sync(); });
    on(qs("#f-snapshot"), "input", e => { state.snapshotSecs = Math.min(30, Math.max(20, Number(e.target.value) || 25)); });

    if (isT) {
      on(qs("#f-prize"), "input", e => { state.prizePool = e.target.value; sync(); });
      on(qs("#f-entry"), "input", e => { state.entryFee = e.target.value; sync(); });
      on(qs("#f-split"), "change", e => { state.splitPreset = e.target.value; qs("#customSplit").classList.toggle("hide", state.splitPreset !== "custom"); sync(); });
      on(qs("#customSplit"), "input", () => {
        [1, 2, 3, 4, 5].forEach(r => { state.customSplit[r] = qs("#cs-" + r).value; });
        const total = [1, 2, 3, 4, 5].reduce((a, r) => a + (Number(state.customSplit[r]) || 0), 0);
        qs("#splitTotal").textContent = "Total: " + total + "%" + (total === 100 ? " — good." : " — must equal 100.");
        sync();
      });
      on(qs("#f-min"), "input", e => { state.minPlayers = Number(e.target.value); sync(); });
    }

    on(qs("#autoPickBtn"), "click", () => {
      state.questionIds = autoPick(state.topics.length ? state.topics : SEED.topics.map(t => t.id), 5);
      renderQList(); renderPanel(); sync();
      toast("Auto-picked 5 questions by topic.", { type: "success" });
    });

    /* ---------- question list + panel ---------- */
    function renderQList() {
      const box = qs("#qList");
      if (!state.questionIds.length) { box.innerHTML = `<p class="small faint">No questions yet. Browse the bank or auto-pick.</p>`; return; }
      box.innerHTML = state.questionIds.map((id, idx) => {
        const q = S.getQuestion(id);
        return `<div class="listrow">
          <span class="rank mono xs" style="width:22px">${idx + 1}</span>
          <div class="listrow__main"><div class="listrow__title">${escapeHtml(q.title)}</div><div class="listrow__sub">${window.App.diffPill(q.difficulty)} <span class="tag" style="margin-left:4px">${q.points} pts</span> <span class="xs faint">${q.topics.join(", ")}</span></div></div>
          <div class="row row--tight">
            <button class="icon-btn" type="button" data-up="${idx}" aria-label="Move up" ${idx === 0 ? "disabled" : ""} style="width:32px;height:32px">${icon("chevron").replace('viewBox="0 0 24 24"', 'viewBox="0 0 24 24" style="transform:rotate(-90deg)"')}</button>
            <button class="icon-btn" type="button" data-down="${idx}" aria-label="Move down" ${idx === state.questionIds.length - 1 ? "disabled" : ""} style="width:32px;height:32px">${icon("chevron").replace('viewBox="0 0 24 24"', 'viewBox="0 0 24 24" style="transform:rotate(90deg)"')}</button>
            <button class="icon-btn" type="button" data-rm="${idx}" aria-label="Remove" style="width:32px;height:32px;color:var(--danger)">${icon("x")}</button>
          </div>
        </div>`;
      }).join("");
    }
    on(qs("#qList"), "click", e => {
      const up = e.target.closest("[data-up]"), down = e.target.closest("[data-down]"), rm = e.target.closest("[data-rm]");
      if (up) { const i = +up.dataset.up; [state.questionIds[i - 1], state.questionIds[i]] = [state.questionIds[i], state.questionIds[i - 1]]; }
      else if (down) { const i = +down.dataset.down; [state.questionIds[i + 1], state.questionIds[i]] = [state.questionIds[i], state.questionIds[i + 1]]; }
      else if (rm) { state.questionIds.splice(+rm.dataset.rm, 1); }
      else return;
      renderQList(); renderPanel(); sync();
    });

    const pf = { lang: "", topic: "", diff: "" };
    function renderPanel() {
      const list = S.listQuestions({ language: pf.lang, topic: pf.topic, difficulty: pf.diff });
      qs("#panelList").innerHTML = list.map(q => {
        const checked = state.questionIds.includes(q.id);
        return `<label class="card card--flat check" style="border:var(--bw) solid ${checked ? "var(--forest)" : "var(--border)"};align-items:flex-start">
          <input type="checkbox" data-q="${q.id}" ${checked ? "checked" : ""}>
          <span class="check__box">${icon("check")}</span>
          <span style="flex:1"><strong class="small">${escapeHtml(q.title)}</strong>
            <span class="row row--tight" style="margin:4px 0">${window.App.diffPill(q.difficulty)}<span class="tag">${q.points} pts</span></span>
            <span class="xs faint">${escapeHtml(q.topics.join(" · "))}</span>
            <span class="xs muted" style="display:block;margin-top:4px">${escapeHtml(q.statement.replace(/<[^>]+>/g, "").slice(0, 110))}…</span>
          </span>
        </label>`;
      }).join("") || `<p class="small faint">Nothing matches those filters.</p>`;
      qs("#panelCount").textContent = state.questionIds.length + " selected";
    }
    on(qs("#panelList"), "change", e => {
      const id = e.target.dataset.q; if (!id) return;
      if (e.target.checked) { if (!state.questionIds.includes(id)) state.questionIds.push(id); }
      else state.questionIds = state.questionIds.filter(x => x !== id);
      renderQList(); renderPanel(); sync();
    });
    on(qs("#p-lang"), "change", e => { pf.lang = e.target.value; renderPanel(); });
    on(qs("#p-topic"), "change", e => { pf.topic = e.target.value; renderPanel(); });
    on(qs("#p-diff"), "click", e => {
      const b = e.target.closest("[data-d]"); if (!b) return;
      qsa("#p-diff .chip").forEach(c => c.classList.remove("is-active")); b.classList.add("is-active");
      pf.diff = b.dataset.d; renderPanel();
    });
    on(qs("#openPanelBtn"), "click", () => { qs("#sheet").classList.add("is-open"); qs("#sheetBack").classList.add("is-open"); renderPanel(); });
    on(qs("#closeSheet"), "click", closeSheet); on(qs("#doneSheet"), "click", closeSheet); on(qs("#sheetBack"), "click", closeSheet);
    function closeSheet() { qs("#sheet").classList.remove("is-open"); qs("#sheetBack").classList.remove("is-open"); }

    /* ---------- summary + validation ---------- */
    function validate() {
      const errs = {};
      if (!state.name || state.name.trim().length < 3 || state.name.trim().length > 50) errs.name = "Give it a name between 3 and 50 characters.";
      if (!state.langs.length) errs.langs = "Pick at least one language.";
      if (!state.topics.length && !state.questionIds.length) errs.questions = "Pick at least one topic or one question.";
      if (!state.durationMin || state.durationMin < 15 || state.durationMin > 360) errs.duration = "Duration must be 15 minutes to 6 hours.";
      if (state.format === "Solo" && (state.size < 2 || state.size > 100)) errs.size = "Solo rooms take 2 to 100 players.";
      if (isT) {
        const pool = Number(state.prizePool) || 0, fee = Number(state.entryFee) || 0;
        if (pool < 0 || fee < 0) errs.prize = "Amounts can't be negative.";
        if (state.splitPreset === "custom") {
          const total = [1, 2, 3, 4, 5].reduce((a, r) => a + (Number(state.customSplit[r]) || 0), 0);
          if (total !== 100) errs.prize = "Custom split must add up to exactly 100%.";
        }
      }
      return errs;
    }
    function paintErrors(errs) {
      qsa("[data-f]", root).forEach(f => f.classList.remove("is-invalid"));
      qsa(".error-text", root).forEach(t => { if (!t.dataset.keep) t.textContent = ""; });
      Object.keys(errs).forEach(k => {
        const f = qs('[data-f="' + k + '"]', root);
        if (f) { f.classList.add("is-invalid"); const t = qs(".error-text", f); if (t) t.textContent = errs[k]; }
        const alt = qs('[data-err="' + k + '"]', root); if (alt) { alt.textContent = errs[k]; alt.style.display = "block"; }
      });
    }
    function sync() {
      const pool = S.inrToPaise(Number(state.prizePool) || 0), fee = S.inrToPaise(Number(state.entryFee) || 0);
      const rows = [
        ["Format", state.format], ["Capacity", state.format === "Squad" ? state.size + " teams of " + state.squadSize : state.size + (state.format === "Solo" ? " players" : " teams")],
        ["Languages", state.langs.map(id => (SEED.languages.find(l => l.id === id) || {}).label).join(", ") || "—"],
        ["Questions", state.questionIds.length], ["Duration", state.durationMin + " min"],
        ["Visibility", state.visibility], ["Proctored", state.tournamentMode ? "On" : "Off"]
      ];
      if (isT) { rows.push(["Prize pool", pool ? money(pool) : "None"], ["Entry fee", fee ? money(fee) : "Free"], ["Platform fee", pool ? money(S.platformFee(pool)) : "—"]); }
      qs("#summary").innerHTML = rows.map(r => `<div class="row row--between" style="font-size:var(--fs-sm)"><span class="faint">${r[0]}</span><strong>${escapeHtml(String(r[1]))}</strong></div>`).join("");
      /* Don't disable the publish button on an invalid form: submit() paints the
         reason next to each field, and a dead button tells the user nothing. */
      qs("#publishBtn").setAttribute("aria-invalid", Object.keys(validate()).length ? "true" : "false");
    }

    function buildData(publish) {
      const pool = S.inrToPaise(Number(state.prizePool) || 0), fee = S.inrToPaise(Number(state.entryFee) || 0);
      let split = null;
      if (isT) {
        if (state.splitPreset === "custom") { split = {}; [1, 2, 3, 4, 5].forEach(r => { const v = Number(state.customSplit[r]) || 0; if (v) split[r] = v; }); }
        else split = (SEED.prizePresets.find(p => p.id === state.splitPreset) || {}).split || { 1: 100 };
      }
      return {
        type: isT ? "tournament" : "room", name: state.name, format: state.format,
        size: state.size, squadSize: state.format === "Squad" ? state.squadSize : null,
        langs: state.langs, topics: state.topics, questionIds: state.questionIds,
        durationMin: state.durationMin, timePerQ: state.timePerQ, visibility: state.visibility,
        prizePoolPaise: pool, entryFeePaise: fee, tournamentMode: state.tournamentMode,
        snapshotSecs: state.snapshotSecs, prizePreset: isT ? state.splitPreset : null, split,
        minPlayers: isT ? state.minPlayers : 2, publish, funded: false
      };
    }

    async function submit(publish) {
      const errs = validate();
      paintErrors(errs);
      if (Object.keys(errs).length) { toast("A few fields need fixing before you publish.", { type: "error" }); return; }
      const data = buildData(publish);
      const room = await S.createRoom(data);
      if (!publish) { toast("Saved as draft. Find it under Tournaments → My drafts.", { type: "success" }); location.href = "host-dashboard.html?room=" + room.id; return; }

      if (isT && room.prizePoolPaise > 0) {
        // mock Razorpay funding gate (PRD: can't open registration until pool clears)
        const back = window.App.openModal(`
          <div class="modal__head"><div class="modal__title">Fund the prize pool</div></div>
          <div class="modal__body stack">
            <p class="small muted">Razorpay checkout (simulated in this build). The full pool is collected now and held by the platform until results lock.</p>
            <div class="row row--between card card--well"><span>Prize pool</span><strong>${money(room.prizePoolPaise)}</strong></div>
            <div class="row row--between card card--well"><span>Platform fee (1%, from pool)</span><strong>${money(S.platformFee(room.prizePoolPaise))}</strong></div>
            <p class="xs faint">Entry fees, if any, are collected from players at registration and carry no fee.</p>
          </div>
          <div class="modal__foot"><button class="btn btn--ghost" data-close>Cancel</button><button class="btn btn--success" id="payNow">${icon("rupee")} Pay ${money(room.prizePoolPaise)}</button></div>`, { width: 460 });
        on(qs("#payNow", back), "click", window.App.act(async () => {
          await S.fundPrize(room.id);
          window.App.closeModal(back);
          toast("Pool funded. Registration is open.", { type: "success" });
          location.href = "tournament-details.html?room=" + room.id;
        }, qs("#payNow", back)));
      } else {
        if (room.status !== "open") await S.updateRoom(room.id, { status: "open" });
        toast("Published. Players can join now.", { type: "success" });
        location.href = (room.type === "tournament" ? "tournament-details.html" : "match.html") + "?room=" + room.id;
      }
    }
    on(qs("#publishBtn"), "click", window.App.act(() => submit(true), qs("#publishBtn")));
    on(qs("#draftBtn"), "click", window.App.act(() => submit(false), qs("#draftBtn")));

    renderQList(); sync();
  }

  function mount(opts) { return window.App.page(() => init(opts)); }

  window.CreateForm = { init, mount };})();
