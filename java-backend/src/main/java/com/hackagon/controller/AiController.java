package com.hackagon.controller;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hackagon.service.DatabaseService;
import com.hackagon.service.DomainService;
import com.hackagon.service.JudgeService;
import com.hackagon.service.RepoService;
import com.hackagon.util.HttpException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.*;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * AI coach and coding assistant controller.
 * Calls Groq API using java.net.http.HttpClient.
 * Mirrors server/routes/ai.js and server/lib/groq.js.
 */
@RestController
@RequestMapping("/api/ai")
public class AiController extends BaseController {

    private final DomainService domain;
    private final RepoService repo;
    private final JudgeService judgeService;
    private final ObjectMapper mapper;
    private final HttpClient httpClient;

    private final String groqKey;
    private final String groqModel;

    private static final String SYSTEM_PROMPT =
        "You are HackAgon's coding coach for Indian college students practising data structures and algorithms. " +
        "Be concrete, encouraging and brief. Plain English, short sentences, no filler. " +
        "Never paste a full working solution unless the student explicitly asks after failing twice. " +
        "Never reveal hidden test case outputs. Describe the shape of the failing input and the class of bug. " +
        "Answer in markdown with at most three short sections. Keep code snippets under 15 lines.";

    private final Map<String, List<Long>> rateLimits = new ConcurrentHashMap<>();

    public AiController(DatabaseService db, DomainService domain, RepoService repo,
                        JudgeService judgeService, ObjectMapper mapper,
                        @Value("${hackagon.groq.api-key:}") String groqKey,
                        @Value("${hackagon.groq.model:openai/gpt-oss-120b}") String groqModel) {
        super(db);
        this.domain = domain;
        this.repo = repo;
        this.judgeService = judgeService;
        this.mapper = mapper;
        this.groqKey = groqKey;
        this.groqModel = groqModel != null && !groqModel.isBlank() ? groqModel : "llama-3.3-70b-versatile";
        this.httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    }

    private void throttle(String userId) {
        long now = System.currentTimeMillis();
        List<Long> hits = rateLimits.computeIfAbsent(userId, k -> new ArrayList<>());
        synchronized (hits) {
            hits.removeIf(t -> now - t > 60000);
            if (hits.size() >= 12) {
                throw new HttpException(429, "That's a lot of coaching in one minute. Give it a moment.");
            }
            hits.add(now);
        }
    }

    private boolean isConfigured() {
        return groqKey != null && !groqKey.isBlank();
    }

    private String chat(List<Map<String, String>> messages, int maxTokens) {
        if (!isConfigured()) {
            throw new HttpException(503, "The AI coach isn't configured on this server yet (GROQ_API_KEY).");
        }

        try {
            List<Map<String, String>> fullMessages = new ArrayList<>();
            fullMessages.add(Map.of("role", "system", "content", SYSTEM_PROMPT));
            fullMessages.addAll(messages);

            Map<String, Object> reqBody = Map.of(
                "model", groqModel,
                "messages", fullMessages,
                "max_tokens", maxTokens,
                "temperature", 0.4
            );

            HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("https://api.groq.com/openai/v1/chat/completions"))
                .header("Authorization", "Bearer " + groqKey.trim())
                .header("Content-Type", "application/json")
                .timeout(Duration.ofSeconds(30))
                .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(reqBody)))
                .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() >= 400) {
                System.err.println("[Groq Error] " + response.body());
                throw new HttpException(502, "Groq AI service error: " + response.statusCode());
            }

            Map<String, Object> respMap = mapper.readValue(response.body(), new TypeReference<Map<String, Object>>(){});
            List<?> choices = (List<?>) respMap.get("choices");
            if (choices != null && !choices.isEmpty()) {
                Map<?, ?> first = (Map<?, ?>) choices.get(0);
                Map<?, ?> message = (Map<?, ?>) first.get("message");
                if (message != null && message.get("content") != null) {
                    return message.get("content").toString().trim();
                }
            }
            return "No response generated.";
        } catch (HttpException ex) {
            throw ex;
        } catch (Exception ex) {
            System.err.println("[Groq Call Exception] " + ex.getMessage());
            throw new HttpException(502, "Could not reach AI provider: " + ex.getMessage());
        }
    }

    // ---------- hint ----------

    @PostMapping("/hint")
    public Map<String, Object> hint(@RequestBody Map<String, Object> body, HttpServletRequest req) {
        Map<String, Object> user = requireUser(req);
        String userId = (String) user.get("id");
        throttle(userId);

        String questionId = body != null && body.get("questionId") != null ? body.get("questionId").toString() : "";
        Optional<Map<String, Object>> row = domain.getQuestionRow(questionId, true);
        if (row.isEmpty()) throw HttpException.notFound("No question with that id.");
        Map<String, Object> q = repo.shapeQuestionAdmin(row.get());

        long attempts = db.one("SELECT COUNT(*) AS c FROM submissions WHERE user_id = ? AND question_id = ? AND ok = 0", userId, q.get("id"))
            .map(m -> ((Number) m.get("c")).longValue()).orElse(0L);

        String statement = q.get("statement") != null ? q.get("statement").toString().replaceAll("<[^>]+>", "") : "";
        String topics = q.get("topics") != null ? q.get("topics").toString() : "";
        String approach = q.get("approach") != null ? q.get("approach").toString() : "n/a";

        String userPrompt = "Question: " + q.get("title") + "\n" + statement + "\nTopics: " + topics + "\nDifficulty: " + q.get("difficulty") +
            "\nThe student has failed " + attempts + " time(s). Give " +
            (attempts >= 2 ? "the approach outline plus a short skeleton" : "one hint that points at the right data structure or recurrence, without code") +
            ".\nOfficial approach (for your reference, do not copy verbatim): " + approach;

        String answer = chat(List.of(Map.of("role", "user", "content", userPrompt)), 1400);
        return Map.of("ok", true, "hint", answer, "model", groqModel, "attempts", attempts);
    }

    // ---------- explain ----------

    @PostMapping("/explain")
    public Map<String, Object> explain(@RequestBody Map<String, Object> body, HttpServletRequest req) {
        Map<String, Object> user = requireUser(req);
        throttle((String) user.get("id"));

        String questionId = body != null && body.get("questionId") != null ? body.get("questionId").toString() : "";
        String lang = body != null && body.get("lang") != null ? body.get("lang").toString() : "javascript";
        String code = body != null && body.get("code") != null ? body.get("code").toString() : "";

        Optional<Map<String, Object>> row = domain.getQuestionRow(questionId, true);
        if (row.isEmpty()) throw HttpException.notFound("No question with that id.");
        Map<String, Object> q = repo.shapeQuestionAdmin(row.get());

        if (code.trim().isEmpty()) throw HttpException.bad("There's no code to explain.");
        if (code.length() > 20000) throw HttpException.bad("That code is too long to review.");

        Map<String, Object> verdict = judgeService.judge(q, lang, code);
        List<?> rawCases = (List<?>) q.get("cases");

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> results = (List<Map<String, Object>>) verdict.get("results");
        List<String> failDescs = new ArrayList<>();
        if (results != null) {
            for (Map<String, Object> r : results) {
                if (!Boolean.TRUE.equals(r.get("pass"))) {
                    int i = ((Number) r.get("i")).intValue();
                    Object args = (rawCases != null && i < rawCases.size() && rawCases.get(i) instanceof Map<?, ?> m) ? m.get("args") : "{}";
                    String err = r.get("error") != null ? " — threw: " + r.get("error") : " — wrong answer";
                    failDescs.add("case " + (i + 1) + " with input " + args + err);
                    if (failDescs.size() >= 2) break;
                }
            }
        }
        String failingDesc = failDescs.isEmpty() ? "all cases passed" : String.join("; ", failDescs);

        String prompt = "Language: " + lang + "\nStudent code:\n```" + lang + "\n" +
            (code.length() > 8000 ? code.substring(0, 8000) : code) +
            "\n```\nPassed " + verdict.get("passed") + "/" + verdict.get("total") + " hidden cases. Failing: " + failingDesc +
            ".\nExplain the bug class and the fix to make. Do not state the expected outputs." +
            (verdict.get("compileError") != null ? " Compile/runtime error: " + verdict.get("compileError") : "");

        String answer = chat(List.of(Map.of("role", "user", "content", prompt)), 1600);
        return Map.of(
            "ok", true,
            "explanation", answer,
            "verdict", Map.of(
                "passed", verdict.get("passed"),
                "total", verdict.get("total"),
                "ok", verdict.get("ok"),
                "simulated", verdict.get("simulated"),
                "compileError", verdict.get("compileError") != null ? verdict.get("compileError") : ""
            ),
            "model", groqModel
        );
    }

    // ---------- coach ----------

    @PostMapping("/coach")
    public Map<String, Object> coach(@RequestBody Map<String, Object> body, HttpServletRequest req) {
        Map<String, Object> user = requireUser(req);
        throttle((String) user.get("id"));

        String topic = body != null && body.get("topic") != null ? body.get("topic").toString() : null;
        String text = body != null && body.get("question") != null ? body.get("question").toString().trim() : "";
        String mistakeId = body != null && body.get("mistakeId") != null ? body.get("mistakeId").toString() : null;

        String context = "";
        if (mistakeId != null) {
            Optional<Map<String, Object>> m = db.one("SELECT * FROM mistakes WHERE id = ? AND user_id = ?", mistakeId, user.get("id"));
            if (m.isPresent()) {
                Optional<Map<String, Object>> qRow = domain.getQuestionRow(m.get().get("question_id").toString(), false);
                if (qRow.isPresent()) {
                    Map<String, Object> q = repo.shapeQuestionPublic(qRow.get());
                    context = "They previously failed \"" + q.get("title") + "\" (" + q.get("topics") + ", " + q.get("difficulty") + ").";
                }
            }
        }

        if (text.isEmpty() && topic == null) throw HttpException.bad("Ask something, or name a topic.");

        String prompt = context + "\nTopic: " + (topic != null ? topic : "general") + "\nStudent asks: " +
            (!text.isEmpty() ? text : "Give me a short study plan for this topic and one practice question to try.");

        String answer = chat(List.of(Map.of("role", "user", "content", prompt)), 1600);
        return Map.of(
            "ok", true,
            "answer", answer,
            "model", groqModel,
            "provider", "groq",
            "configured", isConfigured()
        );
    }

    @GetMapping("/status")
    public Map<String, Object> status() {
        return Map.of("ok", true, "enabled", isConfigured(), "model", groqModel);
    }
}
