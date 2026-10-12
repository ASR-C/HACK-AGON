package com.hackagon.controller;

import com.hackagon.util.HttpException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Catches HttpException (and generic Exception) and returns the same
 * JSON error shape as the Node.js error handler:
 *   { ok: false, error: "...", errs?: {...} }
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(HttpException.class)
    public ResponseEntity<Map<String, Object>> handleHttp(HttpException ex) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("ok", false);
        body.put("error", ex.getMessage());
        if (ex.getExtra() != null) body.put("extra", ex.getExtra());
        return ResponseEntity.status(ex.getStatus()).body(body);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleGeneric(Exception ex) {
        int status = 500;
        if (ex instanceof org.springframework.web.bind.MethodArgumentNotValidException) status = 400;
        System.err.println("[HackAgon] Unhandled: " + ex.getMessage());
        ex.printStackTrace();
        return ResponseEntity.status(status).body(Map.of("ok", false, "error", ex.getMessage() != null ? ex.getMessage() : "Something broke on our side."));
    }
}
