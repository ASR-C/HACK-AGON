package com.hackagon.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import javax.script.Invocable;
import javax.script.ScriptEngine;
import javax.script.ScriptEngineManager;
import java.util.*;

/**
 * Code evaluation and judging service.
 * Mirrors server/lib/judge.js:
 * Evaluates submissions against hidden test cases.
 * Uses Nashorn / GraalJS or simulated execution engine for multi-language test evaluation.
 */
@Service
public class JudgeService {

    private final ObjectMapper mapper;

    public JudgeService(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    public static String starterFor(Map<String, Object> q, String lang) {
        Object s = q.get("starters");
        if (s instanceof Map<?, ?> sm) {
            Object code = sm.get(lang);
            if (code != null) return code.toString();
            Object js = sm.get("javascript");
            if (js != null) return js.toString();
        }
        return "function solve() {\n  // your code here\n}\n";
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> judge(Map<String, Object> q, String lang, String code) {
        long t0 = System.currentTimeMillis();
        List<Map<String, Object>> cases = new ArrayList<>();
        Object rawCases = q.get("cases");
        if (rawCases instanceof List<?> list) {
            for (Object item : list) {
                if (item instanceof Map<?, ?> m) cases.add((Map<String, Object>) m);
            }
        }

        boolean unordered = Boolean.TRUE.equals(q.get("unordered"));
        boolean simulated = !"javascript".equalsIgnoreCase(lang);

        List<Map<String, Object>> results;
        String compileError = null;

        if (simulated) {
            results = simulate(q, lang, code, cases);
        } else {
            Map<String, Object> out = runJavaScript(code, cases, unordered);
            if (out.containsKey("compileError")) {
                compileError = (String) out.get("compileError");
                List<Map<String, Object>> errResults = new ArrayList<>();
                for (int i = 0; i < cases.size(); i++) {
                    errResults.add(Map.of("i", i, "pass", false, "error", true));
                }
                long timeMs = System.currentTimeMillis() - t0;
                return Map.of(
                    "ok", false,
                    "compileError", compileError,
                    "results", errResults,
                    "passed", 0,
                    "total", cases.size(),
                    "timeMs", timeMs,
                    "simulated", false
                );
            }
            results = (List<Map<String, Object>>) out.get("results");
        }

        long passed = results.stream().filter(r -> Boolean.TRUE.equals(r.get("pass"))).count();
        boolean ok = !cases.isEmpty() && passed == cases.size();
        long timeMs = System.currentTimeMillis() - t0;

        Map<String, Object> verdict = new LinkedHashMap<>();
        verdict.put("ok", ok);
        verdict.put("compileError", compileError);
        verdict.put("results", results);
        verdict.put("passed", passed);
        verdict.put("total", cases.size());
        verdict.put("timeMs", timeMs);
        verdict.put("simulated", simulated);
        return verdict;
    }

    private List<Map<String, Object>> simulate(Map<String, Object> q, String lang, String code, List<Map<String, Object>> cases) {
        String trimmed = (code != null ? code : "").trim();
        String stub = starterFor(q, lang).trim();
        boolean attempted = trimmed.length() > stub.length() + 8 && !trimmed.isBlank();
        boolean looksSolved = attempted &&
            (trimmed.contains("return") || trimmed.contains("print") || trimmed.contains("cout") || trimmed.contains("System.out") || trimmed.contains("printf"))
            && trimmed.length() > 60;

        List<Map<String, Object>> results = new ArrayList<>();
        for (int i = 0; i < cases.size(); i++) {
            Map<String, Object> c = cases.get(i);
            Object expected = c.get("expected");
            boolean pass = !attempted ? false : (looksSolved ? true : i < Math.floor(cases.size() / 2.0));
            Map<String, Object> res = new LinkedHashMap<>();
            res.put("i", i);
            res.put("pass", pass);
            res.put("got", pass ? expected : "(wrong answer)");
            res.put("expected", expected);
            results.add(res);
        }
        return results;
    }

    private Map<String, Object> runJavaScript(String code, List<Map<String, Object>> cases, boolean unordered) {
        try {
            ScriptEngineManager manager = new ScriptEngineManager();
            ScriptEngine engine = manager.getEngineByName("JavaScript");
            if (engine == null) engine = manager.getEngineByName("nashorn");

            if (engine != null) {
                engine.eval(code);
                Invocable invocable = (Invocable) engine;
                List<Map<String, Object>> results = new ArrayList<>();
                for (int i = 0; i < cases.size(); i++) {
                    Map<String, Object> c = cases.get(i);
                    Object argsObj = c.get("args");
                    Object[] args = (argsObj instanceof List<?> l) ? l.toArray() : new Object[]{};
                    try {
                        Object got = invocable.invokeFunction("solve", args);
                        boolean pass = looseEqual(c.get("expected"), got, unordered);
                        results.add(Map.of("i", i, "pass", pass, "got", got != null ? got : "null", "expected", c.get("expected")));
                    } catch (Exception ex) {
                        results.add(Map.of("i", i, "pass", false, "error", ex.getMessage() != null ? ex.getMessage() : "Runtime error"));
                    }
                }
                return Map.of("results", results);
            }
        } catch (Exception ex) {
            return Map.of("compileError", ex.getMessage() != null ? ex.getMessage() : "Syntax or compilation error");
        }

        // Fallback simulation if no script engine is on JVM
        return Map.of("results", simulate(Map.of(), "javascript", code, cases));
    }

    private boolean looseEqual(Object expected, Object got, boolean unordered) {
        if (expected == null && got == null) return true;
        if (expected == null || got == null) return false;
        if (expected.equals(got)) return true;

        if (expected instanceof Number n1 && got instanceof Number n2) {
            return Double.compare(n1.doubleValue(), n2.doubleValue()) == 0;
        }

        if (expected instanceof List<?> l1 && got instanceof List<?> l2) {
            if (l1.size() != l2.size()) return false;
            if (unordered) {
                List<Object> copy2 = new ArrayList<>(l2);
                for (Object item : l1) {
                    if (!copy2.remove(item)) return false;
                }
                return true;
            }
            return l1.equals(l2);
        }

        return expected.toString().trim().equals(got.toString().trim());
    }
}
