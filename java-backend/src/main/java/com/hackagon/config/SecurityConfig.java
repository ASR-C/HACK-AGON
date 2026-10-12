package com.hackagon.config;

import com.hackagon.service.JwtService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.lang.NonNull;

import java.io.IOException;
import java.util.List;
import java.util.Map;

/**
 * JWT-based stateless security configuration.
 * Mirrors the auth.required / auth.optional middleware from the Node.js server.
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    private final JwtService jwtService;

    public SecurityConfig(JwtService jwtService) {
        this.jwtService = jwtService;
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(c -> c.disable())
            .cors(c -> c.configurationSource(corsConfigurationSource()))
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                // Public endpoints (auth.optional or no auth)
                .requestMatchers(HttpMethod.POST, "/api/auth/signup", "/api/auth/login",
                        "/api/auth/verify", "/api/auth/resend", "/api/auth/forgot", "/api/auth/reset").permitAll()
                .requestMatchers(HttpMethod.GET, "/api/auth/otp/*/meta").permitAll()
                .requestMatchers(HttpMethod.GET, "/api/bootstrap", "/api/achievements",
                        "/api/books", "/api/questions", "/api/questions/**", "/api/taxonomies",
                        "/api/ai/status", "/api/health", "/health").permitAll()
                .requestMatchers(HttpMethod.GET, "/api/rooms/**").permitAll()
                // All other /api/** require authentication
                .requestMatchers("/api/**").authenticated()
                // Static files
                .anyRequest().permitAll()
            )
            .addFilterBefore(jwtAuthFilter(), UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }

    /**
     * JWT authentication filter — reads Bearer token from Authorization header,
     * validates it and puts the claims into Spring Security context.
     */
    @Bean
    public OncePerRequestFilter jwtAuthFilter() {
        return new OncePerRequestFilter() {
            @Override
            protected void doFilterInternal(@NonNull HttpServletRequest req,
                                            @NonNull HttpServletResponse res,
                                            @NonNull FilterChain chain)
                    throws IOException, jakarta.servlet.ServletException {
                String header = req.getHeader("Authorization");
                if (header != null && header.startsWith("Bearer ")) {
                    String token = header.substring(7);
                    try {
                        Map<String, Object> claims = jwtService.validateAndExtract(token);
                        if (claims != null) {
                            // Attach user info as request attribute (accessible in controllers)
                            req.setAttribute("userId", claims.get("sub"));
                            req.setAttribute("userClaims", claims);
                            List<SimpleGrantedAuthority> authorities = List.of(
                                new SimpleGrantedAuthority("ROLE_USER")
                            );
                            UsernamePasswordAuthenticationToken auth =
                                new UsernamePasswordAuthenticationToken(claims.get("sub"), null, authorities);
                            SecurityContextHolder.getContext().setAuthentication(auth);
                        }
                    } catch (Exception ignored) {
                        // Invalid token — leave SecurityContext empty; endpoint decides if 401
                    }
                }
                chain.doFilter(req, res);
            }
        };
    }

    @Bean
    public org.springframework.web.cors.CorsConfigurationSource corsConfigurationSource() {
        org.springframework.web.cors.CorsConfiguration configuration = new org.springframework.web.cors.CorsConfiguration();
        configuration.setAllowedOriginPatterns(List.of("*"));
        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(List.of("*"));
        configuration.setAllowCredentials(true);
        org.springframework.web.cors.UrlBasedCorsConfigurationSource source = new org.springframework.web.cors.UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }
}
