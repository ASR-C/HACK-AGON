package com.hackagon.controller;

import com.hackagon.service.DatabaseService;
import com.hackagon.util.HttpException;
import jakarta.servlet.http.HttpServletRequest;

import java.util.Map;
import java.util.Optional;

/**
 * Shared helpers for all controllers.
 * requireUser() mirrors the auth.required middleware from the Node.js server.
 */
public abstract class BaseController {

    protected final DatabaseService db;

    protected BaseController(DatabaseService db) {
        this.db = db;
    }

    /** Read current user from request attributes (set by JwtAuthFilter). */
    protected String currentUserId(HttpServletRequest req) {
        Object id = req.getAttribute("userId");
        return id != null ? id.toString() : null;
    }

    /** Throws 401 if no authenticated user. Mirrors auth.required middleware. */
    protected String requireUserId(HttpServletRequest req) {
        String id = currentUserId(req);
        if (id == null) throw new HttpException(401, "Authentication required.");
        return id;
    }

    /** Fetch current user row and throw 401 if missing. */
    protected Map<String, Object> requireUser(HttpServletRequest req) {
        String userId = requireUserId(req);
        Optional<Map<String, Object>> user = db.one(
            "SELECT id,name,username,email,mobile,is_admin,org,stats,created_at,payout FROM users WHERE id = ?", userId);
        if (user.isEmpty()) throw new HttpException(401, "Account not found.");
        return shapeUser(user.get());
    }

    /** Fetch optional current user (auth.optional middleware). */
    protected Optional<Map<String, Object>> optionalUser(HttpServletRequest req) {
        String userId = currentUserId(req);
        if (userId == null) return Optional.empty();
        return db.one("SELECT id,name,username,email,mobile,is_admin,org,stats,created_at,payout FROM users WHERE id = ?", userId)
                 .map(this::shapeUser);
    }

    protected Map<String, Object> shapeUser(Map<String, Object> r) {
        java.util.Map<String, Object> out = new java.util.LinkedHashMap<>();
        out.put("id",        r.get("id"));
        out.put("name",      r.get("name"));
        out.put("username",  r.get("username"));
        out.put("email",     r.get("email"));
        out.put("isAdmin",   com.hackagon.util.IdUtil.toBool(r.get("is_admin")));
        out.put("verified",  com.hackagon.util.IdUtil.toBool(r.get("verified")));
        out.put("org",       r.get("org"));
        out.put("stats",     r.get("stats"));
        out.put("payout",    r.get("payout"));
        out.put("createdAt", com.hackagon.util.IdUtil.toLong(r.get("created_at")));
        return out;
    }
}
