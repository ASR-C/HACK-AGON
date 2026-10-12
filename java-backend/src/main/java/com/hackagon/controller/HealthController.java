package com.hackagon.controller;

import com.hackagon.service.DatabaseService;
import com.hackagon.util.IdUtil;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * Health check endpoints.
 * /health -> simple 200 OK string (Docker / AWS ALB)
 * /api/health -> JSON diagnostics for frontend / dev tools
 */
@RestController
public class HealthController {

    private final DatabaseService db;
    private final boolean exposeOtp;
    private final String dbName;
    private final boolean groqConfigured;
    private final String groqModel;

    public HealthController(DatabaseService db,
                            @Value("${hackagon.expose-otp:false}") boolean exposeOtp,
                            @Value("${spring.datasource.name:hackagon}") String dbName,
                            @Value("${hackagon.groq.api-key:}") String groqKey,
                            @Value("${hackagon.groq.model:openai/gpt-oss-120b}") String groqModel) {
        this.db = db;
        this.exposeOtp = exposeOtp;
        this.dbName = dbName;
        this.groqConfigured = groqKey != null && !groqKey.isBlank();
        this.groqModel = groqModel;
    }

    @GetMapping("/health")
    public ResponseEntity<String> health() {
        try {
            db.one("SELECT 1");
        } catch (Exception ex) {
            System.err.println("Health check database error: " + ex.getMessage());
        }
        return ResponseEntity.ok("ok");
    }

    @GetMapping("/api/health")
    public Map<String, Object> apiHealth() {
        String version = null;
        String dbError = null;
        try {
            version = db.ping();
        } catch (Exception ex) {
            dbError = ex.getMessage();
        }

        return Map.of(
            "ok", dbError == null,
            "time", IdUtil.now(),
            "db", dbError != null
                ? Map.of("connected", false, "error", dbError)
                : Map.of("connected", true, "version", version != null ? version : "unknown", "name", dbName),
            "mail", Map.of("enabled", true, "exposeOtp", exposeOtp),
            "ai", Map.of("enabled", groqConfigured, "model", groqModel)
        );
    }
}
