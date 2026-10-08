/* Server-side judge.
   JavaScript is really executed inside a vm context with a wall-clock timeout.
   `vm` is NOT a security sandbox — in the product build this is replaced by
   Judge0 (PRD 2), which runs each submission in a throwaway container.
   Other languages use the same deterministic simulation the demo build used
   and every such verdict is flagged simulated:true so the UI can say so. */

const vm = require("vm");
const { looseEqual, safe, now } = require("./util");

const RUN_TIMEOUT_MS = 2000;

function starterFor(q, lang) {
  const s = q.starters || {};
  return s[lang] || s.javascript || "function solve() {\n  // your code here\n}\n";
}

function runJavaScript(code, cases, unordered) {
  const sandbox = { console: { log() {} }, Math, JSON, Date, Object, Array, String, Number, Boolean, Map, Set, Infinity, NaN, parseInt, parseFloat, isNaN };
  const ctx = vm.createContext(sandbox);
  let fn;
  try {
    vm.runInContext(code + "\n;globalThis.__solve = (typeof solve === 'function') ? solve : null;", ctx, { timeout: RUN_TIMEOUT_MS });
    fn = sandbox.__solve;
  } catch (err) {
    return { compileError: String((err && err.message) || err) };
  }
  if (typeof fn !== "function") return { compileError: "No function named solve() was found." };

  const results = cases.map((c, i) => {
    try {
      const got = fn(...JSON.parse(JSON.stringify(c.args)));
      return { i, pass: looseEqual(c.expected, got, unordered), got: safe(got), expected: safe(c.expected) };
    } catch (err) {
      return { i, pass: false, error: String((err && err.message) || err) };
    }
  });
  return { results };
}

function simulate(q, lang, code, cases) {
  const trimmed = (code || "").trim();
  const stub = starterFor(q, lang).trim();
  const attempted = trimmed.length > stub.length + 8 && !/^\s*$/.test(trimmed);
  const looksSolved = attempted && /(return|print|cout|System\.out|printf)/.test(trimmed) && trimmed.length > 60;
  return cases.map((c, i) => {
    const pass = !attempted ? false : (looksSolved ? true : i < Math.floor(cases.length / 2));
    return { i, pass, got: pass ? safe(c.expected) : "(wrong answer)", expected: safe(c.expected) };
  });
}

/* q must include cases + unordered; hidden tests never leave the server. */
function judge(q, lang, code) {
  const t0 = now();
  const cases = q.cases || [];
  let results, compileError = null;
  const simulated = lang !== "javascript";

  if (simulated) {
    results = simulate(q, lang, code, cases);
  } else {
    const out = runJavaScript(code, cases, q.unordered);
    if (out.compileError) {
      return {
        ok: false, compileError: out.compileError,
        results: cases.map((c, i) => ({ i, pass: false, error: true })),
        passed: 0, total: cases.length, timeMs: now() - t0, simulated: false
      };
    }
    results = out.results;
  }

  const passed = results.filter(r => r.pass).length;
  return {
    ok: cases.length > 0 && passed === cases.length,
    compileError, results, passed, total: cases.length,
    timeMs: now() - t0, simulated
  };
}

module.exports = { judge, starterFor, RUN_TIMEOUT_MS };
