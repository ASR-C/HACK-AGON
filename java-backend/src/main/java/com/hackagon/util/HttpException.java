package com.hackagon.util;

import lombok.Getter;

/**
 * Maps to the Node.js HttpError class.
 * Thrown anywhere in the service/controller layer and caught
 * by the global exception handler which serialises it to JSON.
 */
@Getter
public class HttpException extends RuntimeException {
    private final int status;
    private final Object extra;

    public HttpException(int status, String message) {
        super(message);
        this.status = status;
        this.extra = null;
    }

    public HttpException(int status, String message, Object extra) {
        super(message);
        this.status = status;
        this.extra = extra;
    }

    public int getStatus() { return status; }
    public Object getExtra() { return extra; }

    // Factory helpers matching the Node.js bad/notFound/forbidden shortcuts
    public static HttpException bad(String msg) { return new HttpException(400, msg); }
    public static HttpException notFound(String msg) { return new HttpException(404, msg != null ? msg : "Not found."); }
    public static HttpException forbidden(String msg) { return new HttpException(403, msg != null ? msg : "Not allowed."); }
    public static HttpException conflict(String msg) { return new HttpException(409, msg); }
}
