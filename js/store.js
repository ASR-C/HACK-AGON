/* ============================================================
   HackAgon — store.js
   Server-backed data layer. The Express/MySQL API is the source
   of truth; this file keeps a read cache so pages can render
   synchronously, and every mutation is a request to the server.

   Reads  -> synchronous, from the cache filled by boot()
   Writes -> async, they hit /api and then refresh the cache

   Money is integer paise end to end. Hidden test cases never
   reach the browser: judging happens on the server.
   ============================================================ */

(function () {
  const API = window.API;

  /* ---------- content seed, filled from GET /api/bootstrap ----------
     Mutated in place (never reassigned) so pages that captured a reference
     to Store.SEED during load still see the live data after boot. */
  const SEED = {
    questions: [], books: [], achievements: [], topics: [], languages: [],
    prizePresets: [], platformRooms: [], ALL_LANGS: []
  };

  /* ---------- read cache ---------- */
  const state = {
    me: null, rooms: [], questions: [], mistakes: [], notifications: [],
    achievements: [], users: [], ledger: [], payments: [], payouts: [],
    snapshots: [], violations: [], disputes: [], pendingBooks: [],
    server: { mail: { enabled: false, exposeOtp: false }, ai: { enabled: false } },
    lastOtp: null, booted: false, error: null
  };

  /* ---------- small helpers (unchanged surface) ---------- */
  function uid(prefix) { return (prefix || "id") + "_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }
  const now = () => Date.now();
  const clone = o => JSON.parse(JSON.stringify(o));
  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
    if (a && b && typeof a === "object") {
      const ka = Object.keys(a), kb = Object.keys(b);
      return ka.length === kb.length && ka.every(k => deepEqual(a[k], b[k]));
    }
    return false;
  }

  /* ---------- money ---------- */
  const inrToPaise = n => Math.round((Number(n) || 0) * 100);
  const paiseToInr = p => (Number(p) || 0) / 100;
  function formatInr(paise) {
    const n = paiseToInr(paise);
    return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: n % 1 ? 2 : 0 });
  }
  const platformFee = pool => Math.round((Number(pool) || 0) * 0.01); // 1% of the pool

  /* ============================================================
     BOOT
     ============================================================ */
  let ready = null;
  function boot(force) {
    if (ready && !force) return ready;
    ready = (async () => {
      try {
        const b = await API.get("/bootstrap");
        Object.assign(SEED, b.seed);
        state.questions = SEED.questions.slice();
        state.rooms = b.rooms || [];
        state.me = b.me || null;
        state.server = b.server || state.server;
        state.booted = true;
        state.error = null;
        if (b.token) API.setToken(b.token);
        if (state.me) await refreshMe();
        else { state.achievements = (await API.get("/achievements", { anon: true }).catch(() => ({ achievements: [] }))).achievements || []; }
      } catch (e) {
        state.error = e.message;
        state.booted = true;
        console.error("[HackAgon] bootstrap failed:", e.message);
      }
      return state;
    })();
    return ready;
  }

  async function refreshMe() {
    if (!API.getToken()) { state.me = null; return null; }
    try {
      const r = await API.get("/auth/me");
      state.me = r.user;
      state.mistakes = r.mistakes || [];
      state.notifications = r.notifications || [];
      state.achievements = r.achievements || [];
      return state.me;
    } catch (e) {
      if (e.status === 401) { state.me = null; API.setToken(null); }
      return state.me;
    }
  }

  async function refreshRooms(filter) {
    const qs = filter ? "?" + new URLSearchParams(filter).toString() : "";
    const r = await API.get("/rooms" + qs);
    state.rooms = r.rooms || [];
    return state.rooms;
  }

  function upsertRoom(room) {
    if (!room) return room;
    const i = state.rooms.findIndex(r => r.id === room.id);
    if (i > -1) state.rooms[i] = room; else state.rooms.unshift(room);
    return room;
  }

  /* ============================================================
     QUESTIONS (read cache)
     ============================================================ */
  const allQuestions = () => state.questions.filter(q => !q.retired);
  function listQuestions(f) {
    f = f || {};
    return allQuestions().filter(q => {
      if (f.language && !(q.languages || []).includes(f.language)) return false;
      if (f.topic && !(q.topics || []).includes(f.topic)) return false;
      if (f.difficulty && q.difficulty !== f.difficulty) return false;
      if (f.ids && !f.ids.includes(q.id)) return false;
      if (f.q) {
        const t = (q.title + " " + (q.topics || []).join(" ")).toLowerCase();
        if (!t.includes(f.q.toLowerCase())) return false;
      }
      return true;
    });
  }
  /* Retired questions stay resolvable so a running room never loses content. */
  const getQuestion = id => state.questions.find(q => q.id === id) || null;
  function starterFor(q, lang) {
    const s = (q && q.starters) || {};
    return s[lang] || s.javascript || "function solve() {\n  // your code here\n}\n";
  }
  const isRetired = id => !!((getQuestion(id) || {}).retired);

  /* Local pre-flight validation for instant feedback; the server re-checks. */
  function validateQuestion(d) {
    const errs = {};
    if (!d.title || String(d.title).trim().length < 3) errs.title = "Give the question a title of 3+ characters.";
    if (!d.statement || String(d.statement).trim().length < 20) errs.statement = "Write a statement players can actually solve from (20+ characters).";
    if (!d.topics || !d.topics.length) errs.topics = "Pick at least one topic.";
    if (!d.languages || !d.languages.length) errs.languages = "Pick at least one language.";
    if (!(d.points > 0)) errs.points = "Points must be above zero.";
    if (!d.cases || !d.cases.length) errs.cases = "Add at least one hidden test case.";
    if (!d.samples || !d.samples.length) errs.samples = "Add at least one visible sample.";
    return errs;
  }

  /* ============================================================
     AUTH + OTP
     ============================================================ */
  const currentUser = () => state.me;
  const getUserById = id => (state.me && state.me.id === id ? state.me : (state.users.find(u => u.id === id) || null));

  function ageFromDob(dob) {
    if (!dob) return 0;
    const b = new Date(dob), t = new Date();
    let a = t.getFullYear() - b.getFullYear();
    const m = t.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a--;
    return a;
  }
  function validateNewUser(d) {
    const errs = {};
    if (!d.name || d.name.trim().length < 2) errs.name = "Tell us what to call you.";
    if (!/^[a-z0-9_]{3,20}$/i.test(d.username || "")) errs.username = "3–20 characters, letters, numbers or underscore.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email || "")) errs.email = "That email doesn't look right.";
    if (!/^[0-9]{10}$/.test(String(d.mobile || "").replace(/\D/g, "").slice(-10))) errs.mobile = "Enter a 10-digit mobile number.";
    if (!d.password || d.password.length < 8) errs.password = "Use at least 8 characters.";
    if (!d.dob) errs.dob = "We need your date of birth.";
    else if (ageFromDob(d.dob) < 13) errs.dob = "You need to be 13 or older to play.";
    return errs;
  }

  /* Creates the account and emails the code in one call. */
  async function signup(d) {
    const r = await API.post("/auth/signup", d, { anon: true });
    state.lastOtp = Object.assign({ email: r.email, purpose: "signup", userId: r.userId }, r.otp);
    return r;
  }

  async function login(identifier, password) {
    const r = await API.post("/auth/login", { identifier, password }, { anon: true });
    if (r.token) { API.setToken(r.token); state.me = r.user; await refreshMe(); }
    else if (r.otp) state.lastOtp = Object.assign({ email: r.email, purpose: "signup", userId: r.userId }, r.otp);
    return r;
  }

  function logout() { API.setToken(null); state.me = null; state.mistakes = []; state.notifications = []; }

  async function verifyOtp(otpId, code) {
    const r = await API.post("/auth/verify", { otpId, code }, { anon: true });
    if (r.token) { API.setToken(r.token); state.me = r.user; await refreshMe(); }
    return r;
  }
  async function resendOtp(otpId) {
    const r = await API.post("/auth/resend", { otpId }, { anon: true });
    if (r.otp) state.lastOtp = Object.assign({}, state.lastOtp, r.otp);
    return r.otp;
  }
  /* Cooldown is measured locally against the last code we were given. */
  function canResend() { const o = state.lastOtp; return !!(o && now() >= (o.resendAt || 0)); }
  function resendInSecs() { const o = state.lastOtp; return o ? Math.max(0, Math.ceil(((o.resendAt || 0) - now()) / 1000)) : 0; }
  function rememberOtp(meta) { state.lastOtp = Object.assign({}, state.lastOtp, meta); }
  /* Server-side metadata for a code: expiry, tries, masked target. Never the code. */
  async function otpMeta(otpId) {
    const r = await API.get("/auth/otp/" + encodeURIComponent(otpId) + "/meta", { anon: true });
    state.lastOtp = Object.assign({}, state.lastOtp, r.meta, { id: r.meta.otpId });
    return r.meta;
  }

  async function forgotPassword(email) {
    const r = await API.post("/auth/forgot", { email }, { anon: true });
    if (r.otp) state.lastOtp = Object.assign({ email, purpose: "forgot" }, r.otp);
    return r;
  }
  async function resetPassword(otpId, code, password) {
    const r = await API.post("/auth/reset", { otpId, code, password }, { anon: true });
    if (r.token) { API.setToken(r.token); state.me = r.user; await refreshMe(); }
    return r;
  }
  async function changePassword(oldPassword, newPassword) {
    return API.post("/auth/password", { oldPassword, newPassword });
  }
  async function updateUser(patch) {
    const r = await API.patch("/auth/me", patch);
    state.me = r.user;
    return r.user;
  }
  async function savePayout(data) { const r = await API.post("/auth/payout", data); state.me.payout = r.payout; return r.payout; }
  async function verifyPayout(holderName) { const r = await API.post("/auth/payout/verify", { holderName }); state.me.payout = r.payout; return r; }
  /* The server mails the code to the NEW address, so proving you own it comes first. */
  async function changeContact(email, mobile) {
    const r = await API.post("/auth/me/contact", { email, mobile });
    state.lastOtp = Object.assign({ email, mobile, purpose: "contact", userId: state.me.id }, r.otp);
    return r.otp;
  }
  async function confirmContact(otpId, code) {
    const r = await API.post("/auth/me/contact/confirm", { otpId, code });
    state.me = r.user;
    return r.user;
  }

  /* ============================================================
     ROOMS
     ============================================================ */
  const getRoom = id => state.rooms.find(r => r.id === id) || null;
  function listRooms(f) {
    f = f || {};
    return state.rooms.filter(r => {
      if (f.type && r.type !== f.type) return false;
      if (f.status && ![].concat(f.status).includes(r.status)) return false;
      if (f.topic && !(r.topics || []).includes(f.topic)) return false;
      if (f.lang && !(r.langs || []).includes(f.lang)) return false;
      if (f.hostId && r.hostId !== f.hostId) return false;
      if (f.q && !r.name.toLowerCase().includes(f.q.toLowerCase())) return false;
      return true;
    }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }
  const getPlayer = (roomId, userId) => { const r = getRoom(roomId); return r && (r.players || []).find(p => p.userId === userId); };
  const isLocked = (roomId, userId) => { const p = getPlayer(roomId, userId); return !!(p && p.locked); };

  function scoreboard(roomId) {
    const r = getRoom(roomId); if (!r) return [];
    return (r.players || []).filter(p => !p.eliminated && !p.locked)
      .slice().sort((a, b) => (b.score - a.score) || ((a.lastCorrectAt || Infinity) - (b.lastCorrectAt || Infinity)))
      .map((p, i) => Object.assign({}, p, { rank: i + 1 }));
  }

  async function createRoom(d) { const r = await API.post("/rooms", d); return upsertRoom(r.room); }
  async function fetchRoom(id) {
    const r = await API.get("/rooms/" + id);
    return upsertRoom(r.room);
  }
  async function updateRoom(id, patch) { return upsertRoom((await API.patch("/rooms/" + id, patch)).room); }
  async function joinRoom(id) { const r = await API.post(`/rooms/${id}/join`); return upsertRoom(r.room); }
  async function joinByCode(code) {
    const found = await API.get("/rooms/code/" + encodeURIComponent(String(code).trim().toUpperCase()));
    upsertRoom(found.room);
    const r = await API.post(`/rooms/${found.room.id}/join`);
    return upsertRoom(r.room);
  }
  async function leaveRoom(id) { return upsertRoom((await API.post(`/rooms/${id}/leave`)).room); }
  async function startRoom(id) { return upsertRoom((await API.post(`/rooms/${id}/start`)).room); }
  async function eliminatePlayer(id, userId, reason) { return upsertRoom((await API.post(`/rooms/${id}/eliminate`, { userId, reason })).room); }
  async function finaliseRoom(id) {
    const r = await API.post(`/rooms/${id}/finalise`);
    const room = r.room ? upsertRoom(r.room) : await fetchRoom(id);
    return { board: r.board || (room && room.finalBoard) || [], room, alreadyLocked: !!r.alreadyLocked };
  }
  async function getBoard(id) { return API.get(`/rooms/${id}/board`); }
  async function raiseDispute(id, reason) { return API.post(`/rooms/${id}/disputes`, { reason }); }

  /* ============================================================
     PLAY — judging happens on the server
     ============================================================ */
  async function submitCode(roomId, questionId, lang, code) {
    const r = await API.post("/play/submit", { roomId, questionId, lang, code });
    upsertRoom((await API.get("/rooms/" + roomId)).room);
    if (r.board) { const room = getRoom(roomId); if (room) room.board = r.board; }
    return r;
  }
  async function practice(questionId, lang, code) {
    const r = await API.post("/play/practice", { questionId, lang, code });
    if (r.mistakeSolved) await refreshMe();
    return r;
  }
  async function fetchMistakes() {
    const r = await API.get("/play/mistakes");
    state.mistakes = r.mistakes;
    (r.questions || []).forEach(q => {
      const i = state.questions.findIndex(x => x.id === q.id);
      if (i > -1) state.questions[i] = Object.assign({}, state.questions[i], q);
      else state.questions.push(q);
    });
    return state.mistakes;
  }
  const listMistakes = () => state.mistakes;
  async function recomputeAchievements() { const r = await API.get("/play/achievements"); state.achievements = r.achievements; return r.newly; }
  const getAchievements = () => state.achievements;
  const notificationsFor = () => state.notifications;

  /* ============================================================
     PROCTORING
     ============================================================ */
  async function recordViolation(roomId, type) {
    const r = await API.post(`/proctor/${roomId}/violations`, { type });
    const p = getPlayer(roomId, state.me && state.me.id);
    if (p) { p.locked = true; p.lockReason = r.lockReason; p.violations = r.violations; }
    return r;
  }
  async function lockPlayer(roomId, userId, reason) {
    const r = await API.post(`/proctor/${roomId}/lock`, { userId, reason });
    const p = getPlayer(roomId, userId); if (p) { p.locked = true; p.lockReason = reason; }
    return r;
  }
  async function unlockPlayer(roomId, userId) {
    const r = await API.post(`/proctor/${roomId}/unlock`, { userId });
    const p = getPlayer(roomId, userId); if (p) { p.locked = false; p.lockReason = ""; }
    return r;
  }
  async function listViolations(roomId) {
    const r = await API.get(`/proctor/${roomId}/violations`);
    state.violations = r.violations;
    return r;
  }
  async function setCamera(roomId, camState) { return API.post(`/proctor/${roomId}/camera`, { state: camState }); }
  async function recordSnapshot(roomId, dataUrl) { return API.post(`/proctor/${roomId}/snapshots`, { image: dataUrl }); }
  async function listSnapshots(roomId) { const r = await API.get(`/proctor/${roomId}/snapshots`); state.snapshots = r.snapshots; return r.snapshots; }
  const snapshotUrl = (roomId, snapId) => `${API.BASE}/proctor/${roomId}/snapshots/${snapId}?token=${encodeURIComponent(API.getToken() || "")}`;

  /* ============================================================
     MONEY
     ============================================================ */
  async function fundPrize(roomId) { return upsertRoom((await API.post(`/money/rooms/${roomId}/fund`)).room); }
  async function payEntry(roomId) { const r = await API.post(`/money/rooms/${roomId}/entry`); return upsertRoom(r.room); }
  async function settlePayouts(roomId) { return API.post(`/money/rooms/${roomId}/settle`); }
  async function refundAll(roomId, reason) { return API.post(`/money/rooms/${roomId}/refund`, { reason }); }
  async function moneySummary(roomId) { return (await API.get(`/money/rooms/${roomId}/summary`)).summary; }
  async function myMoney() { return API.get("/money/me/ledger"); }
  async function listLedger() { state.ledger = (await API.get("/money/ledger")).ledger; return state.ledger; }
  async function listPayments(status) { state.payments = (await API.get("/money/payments" + (status ? "?status=" + status : ""))).payments; return state.payments; }
  async function listPayouts(status) { state.payouts = (await API.get("/money/payouts" + (status ? "?status=" + status : ""))).payouts; return state.payouts; }
  async function moneyTotals() { return (await API.get("/money/totals")).totals; }

  /* ============================================================
     LIBRARY
     ============================================================ */
  function listBooks(subject) {
    const all = SEED.books || [];
    return subject ? all.filter(b => b.subject.toLowerCase() === String(subject).toLowerCase()) : all;
  }
  const bookSubjects = () => Array.from(new Set(listBooks().map(b => b.subject)));
  /* Re-pull the approved shelf; SEED is mutated in place so old references stay live. */
  async function refreshBooks() {
    const r = await API.get("/books");
    SEED.books = r.books || [];
    return SEED.books;
  }
  async function submitBook(b) { return (await API.post("/books", b)).book; }

  /* ============================================================
     ADMIN
     ============================================================ */
  const requireAdmin = () => !!(state.me && state.me.isAdmin);
  async function listUsers(q) {
    state.users = (await API.get("/admin/users" + (q ? "?q=" + encodeURIComponent(q) : ""))).users;
    return state.users;
  }
  async function grantAdmin(userId, val) { return (await API.post(`/admin/users/${userId}/admin`, { isAdmin: val !== false })).user; }
  async function markVerified(userId) { return (await API.post(`/admin/users/${userId}/verify`)).user; }
  async function fetchAdminQuestions() {
    const r = await API.get("/admin/questions");
    state.questions = r.questions;
    return r.questions;
  }
  async function saveQuestion(d) {
    const r = await API.post("/admin/questions", d);
    const i = state.questions.findIndex(q => q.id === r.question.id);
    if (i > -1) state.questions[i] = r.question; else state.questions.push(r.question);
    return r.question;
  }
  async function setRetired(id, retired) {
    await API.post(`/admin/questions/${id}/${retired ? "retire" : "restore"}`);
    const q = getQuestion(id); if (q) q.retired = !!retired;
    return q;
  }
  const retireQuestion = id => setRetired(id, true);
  const restoreQuestion = id => setRetired(id, false);
  async function deleteQuestion(id) {
    await API.del("/admin/questions/" + id);
    state.questions = state.questions.filter(q => q.id !== id);
  }
  async function listPendingBooks(status) {
    state.pendingBooks = (await API.get("/admin/books" + (status ? "?status=" + status : ""))).books;
    return state.pendingBooks;
  }
  async function decideBook(id, status, note) { return (await API.post(`/admin/books/${id}/decide`, { status, note })).book; }
  async function listDisputes(status) {
    const r = await API.get("/admin/disputes" + (status ? "?status=" + status : ""));
    state.disputes = r.disputes;
    return r;
  }
  async function resolveDispute(id, resolution) { return (await API.post(`/admin/disputes/${id}/resolve`, { resolution })).dispute; }
  async function proctoringFor(roomId) { return API.get(`/admin/rooms/${roomId}/proctoring`); }

  /* ============================================================
     AI COACH (Groq)
     ============================================================ */
  const aiHint = questionId => API.post("/ai/hint", { questionId });
  const aiExplain = (questionId, lang, code) => API.post("/ai/explain", { questionId, lang, code });
  const aiCoach = (topic, question, mistakeId) => API.post("/ai/coach", { topic, question, mistakeId });

  /* ============================================================
     TIME FORMATTING
     ============================================================ */
  function fmtDuration(ms) {
    ms = Math.max(0, ms);
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(sec).padStart(2, "0");
  }
  const fmtClock = t => new Date(t).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const fmtDate = t => new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  function ago(t) {
    const s = Math.floor((now() - t) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return Math.floor(s / 86400) + "d ago";
  }

  /* No-op: the server persists. Kept so old call sites don't throw. */
  const save = () => {};

  boot();

  window.Store = {
    /* lifecycle */
    boot, refreshMe, refreshRooms, fetchRoom, save, state, SEED,
    /* helpers */
    uid, now, clone, deepEqual,
    inrToPaise, paiseToInr, formatInr, platformFee,
    fmtDuration, fmtClock, fmtDate, ago,
    /* questions */
    allQuestions, listQuestions, getQuestion, starterFor, isRetired, validateQuestion,
    /* auth */
    currentUser, getUserById, validateNewUser, ageFromDob,
    signup, login, logout, verifyOtp, resendOtp, canResend, resendInSecs, rememberOtp, otpMeta,
    forgotPassword, resetPassword, changePassword, updateUser, savePayout, verifyPayout,
    changeContact, confirmContact,
    /* rooms */
    getRoom, listRooms, getPlayer, isLocked, scoreboard,
    createRoom, updateRoom, joinRoom, joinByCode, leaveRoom, startRoom, getBoard,
    eliminatePlayer, finaliseRoom, raiseDispute,
    /* play */
    submitCode, practice, fetchMistakes, listMistakes, recomputeAchievements, getAchievements, notificationsFor,
    /* proctoring */
    recordViolation, lockPlayer, unlockPlayer, listViolations, setCamera, recordSnapshot, listSnapshots, snapshotUrl,
    /* money */
    fundPrize, payEntry, settlePayouts, refundAll, moneySummary, myMoney,
    listLedger, listPayments, listPayouts, moneyTotals,
    /* library */
    listBooks, bookSubjects, submitBook, refreshBooks,
    /* admin */
    requireAdmin, listUsers, grantAdmin, markVerified,
    fetchAdminQuestions, saveQuestion, retireQuestion, restoreQuestion, deleteQuestion,
    listPendingBooks, decideBook, listDisputes, resolveDispute, proctoringFor,
    /* ai */
    aiHint, aiExplain, aiCoach
  };

  /* `ready` is reassigned on every boot, so expose it as a live getter. */
  Object.defineProperty(window.Store, "ready", { get: () => ready || boot(), enumerable: true });
})();
