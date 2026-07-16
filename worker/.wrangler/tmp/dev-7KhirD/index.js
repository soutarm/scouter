var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// index.ts
var MAX_PAYLOAD_BYTES = 1e5;
var MAX_ANTHROPIC_PAYLOAD_BYTES = 15e4;
var TTL_SECONDS = 60 * 60 * 24 * 365;
var BENCHMARKS_KV_KEY = "benchmarks:au";
var BENCHMARKS_TTL_SECONDS = 60 * 60 * 24 * 8;
var ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
var nanoid = /* @__PURE__ */ __name((size = 10) => {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return Array.from(bytes).map((b) => ALPHABET[b % ALPHABET.length]).join("");
}, "nanoid");
var resolveCorsOrigin = /* @__PURE__ */ __name((request, configuredOrigin = "*") => {
  const requestOrigin = request.headers.get("Origin");
  if (!requestOrigin || configuredOrigin === "*") return "*";
  const allowedOrigins = configuredOrigin.split(",").map((origin) => origin.trim()).filter(Boolean);
  const isLocalDev = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(requestOrigin);
  if (allowedOrigins.includes(requestOrigin) || isLocalDev) return requestOrigin;
  return allowedOrigins[0] ?? "*";
}, "resolveCorsOrigin");
var corsHeaders = /* @__PURE__ */ __name((origin) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
}), "corsHeaders");
var json = /* @__PURE__ */ __name((data, status = 200, origin = "*") => new Response(JSON.stringify(data), {
  status,
  headers: {
    "Content-Type": "application/json",
    ...corsHeaders(origin)
  }
}), "json");
var BENCHMARK_PROMPT = `You are an Australian property market data analyst.

Return the most recent available 12-month dwelling price growth and 5-year cumulative dwelling price growth for each Australian state and territory, based on the latest CoreLogic Home Value Index and PropTrack Home Price Index data you are aware of.

Use your most up-to-date training data. State clearly in the "source" field which index and approximate reporting period your figures are drawn from.

Return JSON only. No markdown fences. Exact shape required:

{
  "source": "PropTrack HPI [Month Year] / CoreLogic HVI [Month Year]",
  "states": {
    "NSW": { "annual12m": 6.5, "cumulative5yr": 32 },
    "VIC": { "annual12m": 2.5, "cumulative5yr": 18 },
    "QLD": { "annual12m": 17.5, "cumulative5yr": 65 },
    "SA":  { "annual12m": 13.9, "cumulative5yr": 58 },
    "WA":  { "annual12m": 21.5, "cumulative5yr": 72 },
    "TAS": { "annual12m": 3.5,  "cumulative5yr": 30 },
    "ACT": { "annual12m": 1.0,  "cumulative5yr": 22 },
    "NT":  { "annual12m": 16.9, "cumulative5yr": 40 }
  }
}

Rules:
- annual12m: percentage as a plain number (e.g. 6.5 means +6.5%)
- cumulative5yr: 5-year cumulative percentage as a plain number
- All 8 states/territories must be present
- No extra fields`;
var refreshBenchmarks = /* @__PURE__ */ __name(async (env) => {
  if (!env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY not set - cannot refresh benchmarks");
    return null;
  }
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: BENCHMARK_PROMPT }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json",
            maxOutputTokens: 512
          }
        }),
        signal: AbortSignal.timeout(3e4)
      }
    );
    if (!res.ok) {
      console.error(`Gemini benchmark fetch failed: ${res.status}`);
      return null;
    }
    const payload = await res.json();
    const text = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
    if (!text) return null;
    const parsed = JSON.parse(text);
    const required = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "ACT", "NT"];
    for (const state of required) {
      const entry = parsed.states?.[state];
      if (!entry || typeof entry.annual12m !== "number" || typeof entry.cumulative5yr !== "number") {
        console.error(`Benchmark validation failed: missing or invalid entry for ${state}`);
        return null;
      }
    }
    return parsed;
  } catch (err) {
    console.error("Benchmark refresh error:", err);
    return null;
  }
}, "refreshBenchmarks");
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const allowedOrigin = resolveCorsOrigin(request, env.ALLOWED_ORIGIN);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(allowedOrigin) });
    }
    if (request.method === "GET" && url.pathname === "/benchmarks") {
      const cached = await env.REVIEWS.get(BENCHMARKS_KV_KEY);
      if (!cached) {
        return json({ error: "Benchmarks not yet available" }, 503, allowedOrigin);
      }
      return new Response(cached, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=86400",
          ...corsHeaders(allowedOrigin)
        }
      });
    }
    if (request.method === "POST" && url.pathname === "/llm/anthropic") {
      const contentLength = Number(request.headers.get("Content-Length") ?? 0);
      if (contentLength > MAX_ANTHROPIC_PAYLOAD_BYTES) {
        return json({ error: "Payload too large" }, 413, allowedOrigin);
      }
      let payload;
      try {
        payload = await request.json();
      } catch {
        return json({ error: "Invalid JSON" }, 400, allowedOrigin);
      }
      const hasNewFormat = payload.system && payload.userMessage;
      const hasLegacyFormat = payload.prompt;
      if (!payload.apiKey || !payload.model || !hasNewFormat && !hasLegacyFormat) {
        return json({ error: "apiKey, model and (system+userMessage or prompt) are required" }, 400, allowedOrigin);
      }
      const anthropicBody = hasNewFormat ? {
        model: payload.model,
        temperature: 0.2,
        max_tokens: payload.maxTokens ?? 9e3,
        system: [
          {
            type: "text",
            text: payload.system,
            cache_control: { type: "ephemeral" }
          }
        ],
        messages: [{ role: "user", content: payload.userMessage }]
      } : {
        model: payload.model,
        temperature: 0.2,
        max_tokens: payload.maxTokens ?? 9e3,
        messages: [{ role: "user", content: payload.prompt }]
      };
      let anthropicRes;
      try {
        anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": payload.apiKey,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify(anthropicBody),
          signal: AbortSignal.timeout(55e3)
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown upstream request error";
        return json({ error: `Anthropic upstream request failed: ${message}` }, 502, allowedOrigin);
      }
      return new Response(await anthropicRes.text(), {
        status: anthropicRes.status,
        headers: {
          "Content-Type": anthropicRes.headers.get("Content-Type") ?? "application/json",
          ...corsHeaders(allowedOrigin)
        }
      });
    }
    if (request.method === "POST" && url.pathname === "/reviews") {
      const contentLength = Number(request.headers.get("Content-Length") ?? 0);
      if (contentLength > MAX_PAYLOAD_BYTES) {
        return json({ error: "Payload too large" }, 413, allowedOrigin);
      }
      let body;
      try {
        body = await request.text();
      } catch {
        return json({ error: "Could not read request body" }, 400, allowedOrigin);
      }
      if (body.length > MAX_PAYLOAD_BYTES) {
        return json({ error: "Payload too large" }, 413, allowedOrigin);
      }
      let parsed;
      try {
        parsed = JSON.parse(body);
        if (!parsed.suburb || !parsed.state || !parsed.summary) {
          return json({ error: "Invalid review shape" }, 400, allowedOrigin);
        }
      } catch {
        return json({ error: "Invalid JSON" }, 400, allowedOrigin);
      }
      const id = nanoid(10);
      await env.REVIEWS.put(id, body, { expirationTtl: TTL_SECONDS });
      return json({ id }, 201, allowedOrigin);
    }
    const getMatch = url.pathname.match(/^\/reviews\/([A-Za-z0-9_-]{6,20})$/);
    if (request.method === "GET" && getMatch) {
      const id = getMatch[1];
      const value = await env.REVIEWS.get(id);
      if (!value) {
        return json({ error: "Review not found" }, 404, allowedOrigin);
      }
      return new Response(value, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=3600",
          ...corsHeaders(allowedOrigin)
        }
      });
    }
    return json({ error: "Not found" }, 404, allowedOrigin);
  },
  // ── Cron handler - runs weekly to refresh benchmark data ──────────────────
  async scheduled(_event, env, _ctx) {
    console.log("Benchmark cron: starting refresh");
    const benchmarks = await refreshBenchmarks(env);
    if (!benchmarks) {
      console.error("Benchmark cron: refresh failed, keeping existing cached value");
      return;
    }
    const payload = {
      fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
      source: benchmarks.source,
      states: benchmarks.states
    };
    await env.REVIEWS.put(BENCHMARKS_KV_KEY, JSON.stringify(payload), {
      expirationTtl: BENCHMARKS_TTL_SECONDS
    });
    console.log(`Benchmark cron: stored benchmarks (source: ${benchmarks.source})`);
  }
};

// ../../../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-Tc79QT/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = index_default;

// ../../../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-Tc79QT/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
