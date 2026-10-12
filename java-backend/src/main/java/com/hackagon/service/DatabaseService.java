package com.hackagon.service;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Thin wrapper around JdbcTemplate providing the same three-method API
 * as the Node.js db.js module: q() for lists, one() for single rows,
 * and run() for mutations.
 */
@Service
public class DatabaseService {

    private final JdbcTemplate jdbc;

    public DatabaseService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Execute a SELECT that returns multiple rows as List<Map>. */
    public List<Map<String, Object>> q(String sql, Object... args) {
        return jdbc.queryForList(sql, args);
    }

    /** Execute a SELECT that returns at most one row, or null if not found. */
    public Optional<Map<String, Object>> one(String sql, Object... args) {
        List<Map<String, Object>> rows = jdbc.queryForList(sql, args);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    /** Execute an INSERT / UPDATE / DELETE. Returns the number of affected rows. */
    public int run(String sql, Object... args) {
        return jdbc.update(sql, args);
    }

    /** Ping the database and return the MySQL version string. */
    public String ping() {
        return jdbc.queryForObject("SELECT version()", String.class);
    }

    public JdbcTemplate raw() { return jdbc; }
}
