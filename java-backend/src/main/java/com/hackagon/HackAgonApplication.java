package com.hackagon;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

import java.io.File;
import java.nio.file.Files;
import java.util.List;

/**
 * HackAgon Server — Java Spring Boot application
 * Replaces the Node.js/Express server with full feature parity.
 * All API endpoints match the original JS server exactly so the
 * browser frontend (api.js / store.js) works without any changes.
 */
@SpringBootApplication
public class HackAgonApplication {
    public static void main(String[] args) {
        loadEnv(new File("server/.env"));
        loadEnv(new File("../server/.env"));
        loadEnv(new File(".env"));
        loadEnv(new File("../.env"));
        SpringApplication.run(HackAgonApplication.class, args);
    }

    private static void loadEnv(File file) {
        if (!file.exists() || !file.isFile()) return;
        try {
            List<String> lines = Files.readAllLines(file.toPath());
            for (String line : lines) {
                line = line.trim();
                if (line.isEmpty() || line.startsWith("#")) continue;
                int eq = line.indexOf('=');
                if (eq > 0) {
                    String key = line.substring(0, eq).trim();
                    String val = line.substring(eq + 1).trim();
                    if ((val.startsWith("\"") && val.endsWith("\"")) || (val.startsWith("'") && val.endsWith("'"))) {
                        val = val.substring(1, val.length() - 1);
                    }
                    if (System.getProperty(key) == null && System.getenv(key) == null) {
                        System.setProperty(key, val);
                    }
                }
            }
        } catch (Exception ignored) {}
    }
}
