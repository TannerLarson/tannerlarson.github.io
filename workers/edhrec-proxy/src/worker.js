const EDHREC_BASE = "https://json.edhrec.com/pages/commanders";
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CACHE_TTL_SECONDS = 12 * 60 * 60; // 12 hours
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;

/** @type {Map<string, { count: number, resetAt: number }>} */
const rateBuckets = new Map();

function parseAllowedOrigins(env) {
  const raw = env?.ALLOWED_ORIGINS || "https://tannerlarson.github.io";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function corsHeaders(origin, allowedOrigins) {
  const allowOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function jsonResponse(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

function clientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function checkRateLimit(ip) {
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT_MAX;
}

export default {
  async fetch(request, env) {
    const allowedOrigins = parseAllowedOrigins(env);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, allowedOrigins);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== "GET") {
      return jsonResponse({ error: "method not allowed" }, 405, cors);
    }

    const url = new URL(request.url);
    const slug = (url.searchParams.get("slug") || "").trim().toLowerCase();

    if (!slug || !SLUG_RE.test(slug)) {
      return jsonResponse(
        { error: "invalid slug; expected lowercase letters, digits, and hyphens" },
        400,
        cors
      );
    }

    if (!checkRateLimit(clientIp(request))) {
      return jsonResponse({ error: "rate limit exceeded" }, 429, cors);
    }

    const upstreamUrl = `${EDHREC_BASE}/${slug}.json`;
    const cache = caches.default;
    const cacheKey = new Request(upstreamUrl, { method: "GET" });

    const cached = await cache.match(cacheKey);
    if (cached) {
      const body = await cached.text();
      return new Response(body, {
        status: cached.status,
        headers: {
          "Content-Type": "application/json",
          "X-Cache": "HIT",
          ...cors,
        },
      });
    }

    let upstream;
    try {
      upstream = await fetch(upstreamUrl, {
        headers: {
          Accept: "application/json",
          "User-Agent": "tannerlarson-edhrec-proxy/1.0 (personal; github.io deckbuilder)",
        },
      });
    } catch {
      return jsonResponse({ error: "upstream fetch failed" }, 502, cors);
    }

    if (upstream.status === 403 || upstream.status === 404) {
      return jsonResponse({ error: "commander page not found" }, 404, cors);
    }

    if (!upstream.ok) {
      return jsonResponse(
        { error: `upstream returned ${upstream.status}` },
        502,
        cors
      );
    }

    const text = await upstream.text();
    const response = new Response(text, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`,
        "X-Cache": "MISS",
        ...cors,
      },
    });

    // Store a CORS-free copy keyed by upstream URL for reuse.
    const toCache = new Response(text, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`,
      },
    });
    await cache.put(cacheKey, toCache);

    return response;
  },
};
