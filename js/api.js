/* ============================================================
   HackAgon — api.js
   Thin fetch wrapper for the Express/MySQL back end. Holds the
   JWT, normalises errors into { message, errs, ...extra }, and
   gives every page one place to talk to the server.
   ============================================================ */

(function () {
  const TOKEN_KEY = "hackagon.token";
  // Same origin when served by the Node server; override for a split dev setup.
  const BASE = (window.HACKAGON_API || "") + "/api";

  const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } };
  const setToken = t => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) { /* private mode */ } };

  class ApiError extends Error {
    constructor(status, message, extra) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      Object.assign(this, extra || {});
    }
  }

  async function request(method, path, body, opts) {
    opts = opts || {};
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const token = opts.anon ? null : getToken();
    if (token) headers.Authorization = "Bearer " + token;

    let res;
    try {
      res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      throw new ApiError(0, "Can't reach the HackAgon server. Is `npm start` running in server/?");
    }

    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : {}; } catch (e) { json = { error: text.slice(0, 200) }; }

    if (!res.ok) {
      const { error, errs, ...extra } = json || {};
      if (res.status === 401 && !opts.anon) setToken(null);
      throw new ApiError(res.status, error || ("Request failed (" + res.status + ")"), { errs, ...extra });
    }
    return json;
  }

  window.API = {
    BASE,
    getToken, setToken,
    get: (p, opts) => request("GET", p, undefined, opts),
    post: (p, body, opts) => request("POST", p, body === undefined ? {} : body, opts),
    patch: (p, body, opts) => request("PATCH", p, body === undefined ? {} : body, opts),
    del: (p, opts) => request("DELETE", p, undefined, opts),
    ApiError
  };
})();
