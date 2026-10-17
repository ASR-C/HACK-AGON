/* ============================================================
   HackAgon  bot-duel.js
   Self-contained bot duel engine. Renders a full practice match
   UI (question card, code editor, live scoreboard) and simulates
   a bot opponent that solves questions at a pace controlled by
   the chosen difficulty level. The user's code is judged by the
   real server; the bot's "solving" is a client-side simulation.

   Bot behaviour by difficulty
   easy   -> bot takes 55-90 % of the time limit per question
   medium -> bot takes 30-55 % of the time limit per question
   hard   -> bot takes 10-30 % of the time limit per question
   ============================================================ */

(function () {
  window.BotDuel = { start };

  const BOT_NAMES = [
    "AlgoBot", "ByteWarden", "NullPointer", "StackBot",
    "LogicCore", "RecurBot", "BinaryBee", "HeapHunter"
  ];
  const BOT_AVATARS = ["🤖", "⚡", "👾", "🛡️", "🧠", "🎯", "🐝", "🐺"];

  const DIFF_CONFIG = {
    easy:   { minFrac: 0.55, maxFrac: 0.90 },
    medium: { minFrac: 0.30, maxFrac: 0.55 },
    hard:   { minFrac: 0.10, maxFrac: 0.30 }
  };

  const qs  = (sel, ctx) => (ctx || document).querySelector(sel);
  const on  = (el, ev, fn) => el && el.addEventListener(ev, fn);
  const esc = s => String(s == null ? "" : s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");

  function fmtDuration(ms) {
    ms = Math.max(0, ms);
    const s = Math.floor(ms / 1000), m = Math.floor(s / 60), sec = s % 60;
    return m + ":" + String(sec).padStart(2, "0");
  }

  function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

  function start(opts) {
    const { botDifficulty, questionIds, durationMin, lang: initLang, root, me } = opts;
    const S  = window.Store;
    const Ap = window.App;
    const { icon, toast, mdToHtml, act, diffPill } = Ap;

    const botIdx   = Math.floor(Math.random() * BOT_NAMES.length);
    const botName  = BOT_NAMES[botIdx];
    const botEmoji = BOT_AVATARS[botIdx];

    let curQ     = 0;
    let lang     = initLang || "javascript";
    let lastCode = "";
    let ended    = false;

    const userProgress = { score: 0, solved: [], lastCorrectAt: null };
    const botProgress  = { score: 0, solved: [], lastCorrectAt: null };

    let clockTimer     = null;
    let botTimers      = [];
    let progressTimers = [];

    const startTs = Date.now();
    const endTs   = startTs + durationMin * 60000;

    /* ---- styles ---- */
    if (!document.getElementById("bd-styles")) {
      const sEl = document.createElement("style");
      sEl.id = "bd-styles";
      sEl.textContent = `
        .bot-typing-bar{height:6px;border-radius:3px;background:var(--border);position:relative;overflow:hidden;}
        .bot-typing-bar::after{content:"";position:absolute;top:0;left:-40%;width:40%;height:100%;
          background:var(--primary);animation:bt-slide 1.4s ease-in-out infinite;border-radius:3px;}
        @keyframes bt-slide{0%{left:-40%}100%{left:100%}}
        .bd-diff-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;
          border-radius:99px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;}
        .bd-diff-easy{background:#d1fae5;color:#065f46;}
        .bd-diff-medium{background:#fef3c7;color:#92400e;}
        .bd-diff-hard{background:#fee2e2;color:#991b1b;}
      `;
      document.head.appendChild(sEl);
    }

    /* ---- helpers ---- */
    function diffBadge(d) {
      const cls = { easy:"bd-diff-easy", medium:"bd-diff-medium", hard:"bd-diff-hard" }[d] || "";
      return `<span class="bd-diff-badge ${cls}">${capitalize(d)}</span>`;
    }

    function buildLangOptions(qId) {
      const q = S.getQuestion(qId);
      const allowed = (q && q.languages) ? q.languages : ["javascript","python","java","cpp","c"];
      const labels  = { javascript:"JavaScript", python:"Python", java:"Java", cpp:"C++", c:"C" };
      return allowed.map(l =>
        `<option value="${l}"${l === lang ? " selected" : ""}>${labels[l] || l}</option>`
      ).join("");
    }

    /* ---- build UI ---- */
    function buildUI() {
      root.innerHTML = `
<div class="match-top">
  <div>
    <div class="row row--tight">
      <span class="badge badge--accent">🤖 Bot Duel</span>
      <span class="badge" style="background:var(--surface);border:1px solid var(--border)">Unranked · Practice</span>
    </div>
    <h2 style="margin-top:4px">vs <strong>${esc(botName)}</strong> ${botEmoji} &nbsp;${diffBadge(botDifficulty)}</h2>
  </div>
  <div class="row" style="align-items:center;gap:12px">
    <div class="qnav" id="bd-qnav"></div>
    <div class="timer" id="bd-timer">--:--</div>
  </div>
</div>

<div class="match-grid">
  <div class="stack stack-4">
    <div class="card card--sticker qcard" id="bd-qcard"></div>
    <div class="editor">
      <div class="editor__bar">
        <div class="editor__lang">
          ${icon("code")}
          <select id="bd-langSel">${buildLangOptions(questionIds[curQ])}</select>
        </div>
        <div class="row row--tight">
          <button class="btn btn--sm btn--ghost" id="bd-hintBtn">${icon("bolt")} Hint</button>
          <button class="btn btn--sm btn--accent" id="bd-submitBtn">${icon("play")} Run tests</button>
        </div>
      </div>
      <div class="editor__body">
        <div class="editor__gutter" id="bd-gutter">1</div>
        <textarea id="bd-code" spellcheck="false" aria-label="code editor"></textarea>
      </div>
    </div>
    <div class="judge" id="bd-judge">
      <div class="judge__row"><span class="faint small">Run your code to see pass / fail per test case.</span></div>
    </div>
    <div id="bd-coachBox"></div>
  </div>

  <aside class="stack stack-4">
    <div class="card card--sticker">
      <div class="card__title" style="margin-bottom:var(--sp-3)">Live scoreboard</div>
      <div id="bd-board" class="stack stack-2"></div>
    </div>
    <div class="card card--well small">
      <div class="row row--tight" style="margin-bottom:6px">
        ${icon("bolt")}<strong>${esc(botName)} ${botEmoji}</strong>
        <span style="margin-left:auto">${diffBadge(botDifficulty)}</span>
      </div>
      <p class="xs muted" id="bd-botStatusText">Thinking</p>
      <div id="bd-botTyping" style="margin-top:8px;display:none">
        <div class="bot-typing-bar"></div>
      </div>
    </div>
  </aside>
</div>`;

      initEditor();
      renderQ();
      renderBoard();
      startClock();
      scheduleBotMoves();
    }

    /* ---- editor ---- */
    function initEditor() {
      const ta = qs("#bd-code");
      ta.value = S.starterFor(S.getQuestion(questionIds[curQ]), lang);
      syncGutter();

      on(ta, "input", syncGutter);
      on(ta, "keydown", e => {
        if (e.key === "Tab") {
          e.preventDefault();
          const st = ta.selectionStart;
          ta.value = ta.value.slice(0, st) + "    " + ta.value.slice(ta.selectionEnd);
          ta.selectionStart = ta.selectionEnd = st + 4;
          syncGutter();
        }
      });
      on(qs("#bd-langSel"), "change", e => {
        lang = e.target.value;
        ta.value = S.starterFor(S.getQuestion(questionIds[curQ]), lang);
        syncGutter();
      });
      on(document, "click", e => {
        const b = e.target.closest("#bd-submitBtn,#bd-hintBtn,#bd-explainBtn");
        if (!b) return;
        if (ended) { toast("The duel is over.", { type: "error" }); return; }
        const fn = b.id === "bd-submitBtn" ? submitRun
                 : b.id === "bd-hintBtn"   ? hintRun
                 :                            explainRun;
        act(fn, b)();
      });
    }

    function syncGutter() {
      const ta = qs("#bd-code"); if (!ta) return;
      const n  = ta.value.split("\n").length;
      const g  = qs("#bd-gutter"); if (!g) return;
      g.innerHTML = Array.from({ length: n }, (_, i) => i + 1).join("<br>");
    }

    /* ---- question card ---- */
    function renderQ() {
      const q = S.getQuestion(questionIds[curQ]); if (!q) return;
      qs("#bd-qcard").innerHTML = `
        <div class="row row--between">
          <div class="row row--tight">${diffPill(q.difficulty)}<span class="tag">${q.points} pts</span><span class="tag">${(q.cases||[]).length} hidden tests</span></div>
          <span class="xs faint">Q${curQ+1} of ${questionIds.length}</span>
        </div>
        <h3 style="margin-top:var(--sp-3)">${esc(q.title)}</h3>
        <p class="stmt" style="margin-block:var(--sp-3)">${q.statement}</p>
        <div class="stack stack-2">${(q.samples||[]).map(s =>
          `<div class="sample"><strong>Input</strong>  ${esc(s.input)}\n<strong>Output</strong> ${esc(s.output)}\n<span class="faint">${esc(s.why)}</span></div>`
        ).join("")}</div>
        <div class="row row--tight" style="margin-top:var(--sp-3)">${(q.topics||[]).map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div>`;

      qs("#bd-qnav").innerHTML = questionIds.map((qid, i) => {
        const solved = userProgress.solved.includes(qid);
        return `<button class="${solved ? "solved" : ""}${i===curQ ? " current" : ""}" data-q="${i}">${i+1}</button>`;
      }).join("");

      qs("#bd-qnav").querySelectorAll("button").forEach(b => on(b, "click", () => {
        curQ = +b.dataset.q;
        const ta = qs("#bd-code");
        if (ta) { ta.value = S.starterFor(S.getQuestion(questionIds[curQ]), lang); syncGutter(); }
        const ls = qs("#bd-langSel"); if (ls) ls.innerHTML = buildLangOptions(questionIds[curQ]);
        qs("#bd-judge").innerHTML = '<div class="judge__row"><span class="faint small">Run your code to see results.</span></div>';
        qs("#bd-coachBox").innerHTML = "";
        renderQ();
      }));
      const cb = qs("#bd-coachBox"); if (cb) cb.innerHTML = "";
    }

    /* ---- submission ---- */
    async function submitRun() {
      if (ended) return;
      const q = S.getQuestion(questionIds[curQ]);
      const code = qs("#bd-code").value;
      lastCode = code;
      qs("#bd-judge").innerHTML = '<div class="judge__row"><span class="judge__status pending"></span> judging on server</div>';
      const cb = qs("#bd-coachBox"); if (cb) cb.innerHTML = "";

      let res;
      try { res = await S.practice(q.id, lang, code); }
      catch (e) {
        qs("#bd-judge").innerHTML = `<div class="judge__row"><span class="judge__status fail">error</span> ${esc(String(e.message||e))}</div>`;
        return;
      }

      const v = res.verdict;
      if (v.compileError) {
        qs("#bd-judge").innerHTML = `<div class="judge__row"><span class="judge__status fail">error</span> ${esc(v.compileError)}</div>`;
      } else {
        qs("#bd-judge").innerHTML =
          v.results.map(r =>
            `<div class="judge__row"><span class="judge__status ${r.pass?"pass":"fail"}">${r.pass?"pass":"fail"}</span><span class="small">Test case ${r.i+1}</span><span class="xs faint" style="margin-left:auto">${r.pass?"":(r.error?esc(String(r.error).slice(0,60)):"wrong answer")}</span></div>`
          ).join("") +
          `<div class="judge__row"><strong class="small">${v.passed}/${v.total} passed</strong><span class="xs faint" style="margin-left:auto">${v.timeMs} ms${v.simulated?"  simulated":""}</span></div>`;
      }

      if (v.ok && !userProgress.solved.includes(q.id)) {
        userProgress.solved.push(q.id);
        userProgress.score += q.points;
        userProgress.lastCorrectAt = Date.now();
        toast("All cases passed! 🎉", { type: "success" });
        renderBoard(); renderQ();
        const next = questionIds.findIndex((qid, i) => i > curQ && !userProgress.solved.includes(qid));
        if (next > -1) {
          curQ = next;
          const ta = qs("#bd-code");
          if (ta) { ta.value = S.starterFor(S.getQuestion(questionIds[curQ]), lang); syncGutter(); }
          const ls = qs("#bd-langSel"); if (ls) ls.innerHTML = buildLangOptions(questionIds[curQ]);
          qs("#bd-judge").innerHTML = '<div class="judge__row"><span class="faint small">Run your code to see results.</span></div>';
          renderQ();
        } else if (userProgress.solved.length === questionIds.length) {
          finishDuel("user-clean");
        }
      } else if (!v.ok) {
        qs("#bd-judge").insertAdjacentHTML("beforeend",
          `<div class="judge__row"><button class="btn btn--sm btn--ghost" id="bd-explainBtn" style="margin-left:auto">${icon("bolt")} Ask the coach why</button></div>`);
      }
    }

    async function hintRun() {
      const q = S.getQuestion(questionIds[curQ]);
      const box = qs("#bd-coachBox");
      box.innerHTML = `<div class="ai-box"><div class="ai-box__head">${icon("bolt")} Coach is thinking</div></div>`;
      const r = await S.aiHint(q.id);
      box.innerHTML = `<div class="ai-box"><div class="ai-box__head">${icon("bolt")} Coach hint <span class="xs faint" style="margin-left:auto">${esc(r.model||"")}</span></div>${mdToHtml(r.hint)}</div>`;
    }

    async function explainRun() {
      const q = S.getQuestion(questionIds[curQ]);
      const box = qs("#bd-coachBox");
      box.innerHTML = `<div class="ai-box"><div class="ai-box__head">${icon("bolt")} Coach is reading your submission</div></div>`;
      const r = await S.aiExplain(q.id, lang, lastCode || qs("#bd-code").value);
      box.innerHTML = `<div class="ai-box"><div class="ai-box__head">${icon("bolt")} Coach review <span class="xs faint" style="margin-left:auto">${r.verdict.passed}/${r.verdict.total} cases</span></div>${mdToHtml(r.explanation)}</div>`;
    }

    /* ---- scoreboard ---- */
    function renderBoard() {
      const rows = [
        { id: me.id,  name: me.name,  score: userProgress.score, solved: userProgress.solved, isBot: false },
        { id: "bot",  name: botName,  score: botProgress.score,  solved: botProgress.solved,  isBot: true,  emoji: botEmoji }
      ].sort((a, b) => (b.score - a.score) || ((a.lastCorrectAt||Infinity)-(b.lastCorrectAt||Infinity)));
      rows.forEach((r, i) => { r.rank = i + 1; });
      qs("#bd-board").innerHTML = rows.map(row => `
        <div class="row row--between ${row.id===me.id?"is-me":""}"
             style="padding:6px 8px;border-radius:8px;${row.id===me.id?"background:color-mix(in srgb,var(--terracotta) 12%,transparent)":""}">
          <span class="row row--tight">
            ${row.isBot
              ? `<span style="font-size:1.4rem;line-height:1">${row.emoji}</span>`
              : Ap.avatarHtml(row, "sm")}
            <span class="small"><span class="rank mono">${row.rank}</span> ${esc(row.name)}
              ${row.isBot ? diffBadge(botDifficulty) : ""}</span>
          </span>
          <div class="row row--tight" style="gap:8px">
            <span class="xs faint">${row.solved.length}/${questionIds.length} solved</span>
            <strong class="mono">${row.score}</strong>
          </div>
        </div>`).join("");
    }

    /* ---- clock ---- */
    function startClock() {
      clockTimer = setInterval(() => {
        const t = qs("#bd-timer"); if (!t) return;
        const left = endTs - Date.now();
        t.textContent = left > 0 ? fmtDuration(left) : "0:00";
        t.classList.toggle("warn", left < 60000 && left > 0);
        if (left <= 0 && !ended) finishDuel("time");
      }, 500);
    }

    /* ---- bot simulation ---- */
    function scheduleBotMoves() {
      const cfg = DIFF_CONFIG[botDifficulty] || DIFF_CONFIG.medium;
      questionIds.forEach((qId, idx) => {
        const q = S.getQuestion(qId); if (!q) return;
        const qMs      = (q.timeLimitMin || durationMin) * 60000;
        const matchMs  = endTs - Date.now();
        const budgetMs = Math.min(qMs, matchMs * 0.85);
        const frac     = cfg.minFrac + Math.random() * (cfg.maxFrac - cfg.minFrac);
        const delay    = Math.floor(budgetMs * frac) + idx * 4000;
        const typeDelay = Math.max(delay - 15000, 1000);

        progressTimers.push(setTimeout(() => {
          const st = qs("#bd-botStatusText");
          const td = qs("#bd-botTyping");
          if (st) st.textContent = "Working on Q" + (idx+1) + "";
          if (td) td.style.display = "block";
        }, typeDelay));

        botTimers.push(setTimeout(() => {
          if (ended || botProgress.solved.includes(qId)) return;
          botProgress.solved.push(qId);
          botProgress.score += q.points;
          botProgress.lastCorrectAt = Date.now();
          renderBoard();
          const st = qs("#bd-botStatusText");
          const td = qs("#bd-botTyping");
          if (st) st.textContent = "Solved Q" + (idx+1) + " ✓";
          if (td) td.style.display = "none";
          if (botProgress.solved.length === questionIds.length) {
            toast(botName + " solved everything! 🤖", { type: "info" });
            finishDuel("bot-clean");
          }
        }, delay));
      });
    }

    /* ---- end screen ---- */
    function finishDuel(reason) {
      if (ended) return;
      ended = true;
      clearInterval(clockTimer);
      botTimers.forEach(clearTimeout);
      progressTimers.forEach(clearTimeout);

      const userWon =
        reason === "user-clean" ||
        (reason === "time" && (
          userProgress.score > botProgress.score ||
          (userProgress.score === botProgress.score && (userProgress.lastCorrectAt||0) < (botProgress.lastCorrectAt||Infinity))
        ));
      const botWon = !userWon && (reason === "bot-clean" || botProgress.score >= userProgress.score);

      const label = userWon ? "You Won! 🏆" : botWon ? botName + " Won 🤖" : "It's a Tie!";
      const color = userWon ? "var(--forest)" : botWon ? "var(--stamp)" : "var(--turmeric)";
      const detail = reason === "user-clean" ? "You solved all questions first!"
                   : reason === "bot-clean"  ? botName + " finished all questions first."
                   : "Time's up · scores are final.";

      const allRows = [
        { name: me.name, score: userProgress.score, solved: userProgress.solved, isBot: false },
        { name: botName, score: botProgress.score,  solved: botProgress.solved,  isBot: true }
      ].sort((a,b) => b.score - a.score);
      allRows.forEach((r,i) => { r.rank = i+1; });

      root.innerHTML = `
<div class="wrap--narrow" style="max-width:760px;margin-inline:auto">
  <div class="center" style="margin-bottom:var(--sp-5)">
    <span class="eyebrow">final whistle · bot duel</span>
    <h1 class="squiggle" style="color:${color}">${label}</h1>
    <p class="lead" style="margin-top:var(--sp-3)">${detail}</p>
  </div>
  <div class="table-wrap"><table class="table"><thead><tr>
    <th>#</th><th>Player</th><th>Solved</th><th>Score</th>
  </tr></thead><tbody>
    ${allRows.map(r => `<tr${r.isBot?"":' class="is-me"'}>
      <td class="rank">${r.rank}</td>
      <td>${r.isBot ? botEmoji + " " : ""}${esc(r.name)} ${r.isBot ? diffBadge(botDifficulty) : ""}</td>
      <td>${r.solved.length}/${questionIds.length}</td>
      <td class="mono">${r.score}</td>
    </tr>`).join("")}
  </tbody></table></div>
  <div class="row" style="justify-content:center;margin-top:var(--sp-5);flex-wrap:wrap;gap:12px">
    <a class="btn btn--primary" href="duel.html">Play again</a>
    <a class="btn btn--ghost"   href="arena.html">Back to Arena</a>
    <a class="btn btn--ghost"   href="learning.html">Review mistakes</a>
  </div>
</div>`;

      if (userWon) {
        document.body.insertAdjacentHTML("beforeend", `
<div class="winscreen"><div class="cert">
  <div class="cert__seal">${icon("trophy").replace('class="ic"','style="width:92px;height:92px;color:var(--turmeric-d)"')}</div>
  <div class="cert__rank">#1</div>
  <h2>You beat ${esc(botName)}!</h2>
  <p class="small muted">${userProgress.solved.length} of ${questionIds.length} solved  ${userProgress.score} pts</p>
  <button class="btn btn--primary" style="margin-top:var(--sp-4)" onclick="this.closest('.winscreen').remove()">Play again</button>
</div></div>`);
      }
    }

    buildUI();
  }
})();
