export interface Env {
  REVIEWS: KVNamespace
  ALLOWED_ORIGIN: string
  GEMINI_API_KEY: string
}

const MAX_PAYLOAD_BYTES = 100_000   // 100 KB hard limit
const TTL_SECONDS = 60 * 60 * 24 * 365  // 1 year
const BENCHMARKS_KV_KEY = 'benchmarks:au'
const BENCHMARKS_TTL_SECONDS = 60 * 60 * 24 * 8  // 8 days (longer than weekly cron)

// Inline nanoid-style ID generator (no npm dependency needed)
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const nanoid = (size = 10): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(size))
  return Array.from(bytes).map((b) => ALPHABET[b % ALPHABET.length]).join('')
}

const corsHeaders = (origin: string) => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
})

const json = (data: unknown, status = 200, origin = '*') =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin),
    },
  })

// ── Benchmark prompt ──────────────────────────────────────────────────────────

const BENCHMARK_PROMPT = `You are an Australian property market data analyst.

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
- No extra fields`

// ── Benchmark refresh via Gemini ──────────────────────────────────────────────

type BenchmarkPayload = {
  source: string
  states: Record<string, { annual12m: number; cumulative5yr: number }>
}

const refreshBenchmarks = async (env: Env): Promise<BenchmarkPayload | null> => {
  if (!env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY not set - cannot refresh benchmarks')
    return null
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: BENCHMARK_PROMPT }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
            maxOutputTokens: 512,
          },
        }),
        signal: AbortSignal.timeout(30_000),
      },
    )

    if (!res.ok) {
      console.error(`Gemini benchmark fetch failed: ${res.status}`)
      return null
    }

    const payload = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim()
    if (!text) return null

    const parsed = JSON.parse(text) as BenchmarkPayload

    // Validate shape - all 8 states must be present with numeric values
    const required = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT']
    for (const state of required) {
      const entry = parsed.states?.[state]
      if (!entry || typeof entry.annual12m !== 'number' || typeof entry.cumulative5yr !== 'number') {
        console.error(`Benchmark validation failed: missing or invalid entry for ${state}`)
        return null
      }
    }

    return parsed
  } catch (err) {
    console.error('Benchmark refresh error:', err)
    return null
  }
}

// ── Fetch handler ─────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const allowedOrigin = env.ALLOWED_ORIGIN ?? '*'

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(allowedOrigin) })
    }

    // GET /benchmarks - return cached benchmarks (or 503 if not yet populated)
    if (request.method === 'GET' && url.pathname === '/benchmarks') {
      const cached = await env.REVIEWS.get(BENCHMARKS_KV_KEY)
      if (!cached) {
        return json({ error: 'Benchmarks not yet available' }, 503, allowedOrigin)
      }
      return new Response(cached, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=86400',
          ...corsHeaders(allowedOrigin),
        },
      })
    }

    // POST /reviews — store a new review, return { id }
    if (request.method === 'POST' && url.pathname === '/reviews') {
      const contentLength = Number(request.headers.get('Content-Length') ?? 0)
      if (contentLength > MAX_PAYLOAD_BYTES) {
        return json({ error: 'Payload too large' }, 413, allowedOrigin)
      }

      let body: string
      try {
        body = await request.text()
      } catch {
        return json({ error: 'Could not read request body' }, 400, allowedOrigin)
      }

      if (body.length > MAX_PAYLOAD_BYTES) {
        return json({ error: 'Payload too large' }, 413, allowedOrigin)
      }

      // Validate it is parseable JSON with the minimum shape we expect
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(body) as Record<string, unknown>
        if (!parsed.suburb || !parsed.state || !parsed.summary) {
          return json({ error: 'Invalid review shape' }, 400, allowedOrigin)
        }
      } catch {
        return json({ error: 'Invalid JSON' }, 400, allowedOrigin)
      }

      const id = nanoid(10)
      await env.REVIEWS.put(id, body, { expirationTtl: TTL_SECONDS })

      return json({ id }, 201, allowedOrigin)
    }

    // GET /reviews/:id — retrieve a stored review
    const getMatch = url.pathname.match(/^\/reviews\/([A-Za-z0-9_-]{6,20})$/)
    if (request.method === 'GET' && getMatch) {
      const id = getMatch[1]
      const value = await env.REVIEWS.get(id)
      if (!value) {
        return json({ error: 'Review not found' }, 404, allowedOrigin)
      }
      return new Response(value, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=3600',
          ...corsHeaders(allowedOrigin),
        },
      })
    }

    return json({ error: 'Not found' }, 404, allowedOrigin)
  },

  // ── Cron handler - runs weekly to refresh benchmark data ──────────────────
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    console.log('Benchmark cron: starting refresh')

    const benchmarks = await refreshBenchmarks(env)
    if (!benchmarks) {
      console.error('Benchmark cron: refresh failed, keeping existing cached value')
      return
    }

    const payload = {
      fetchedAt: new Date().toISOString(),
      source: benchmarks.source,
      states: benchmarks.states,
    }

    await env.REVIEWS.put(BENCHMARKS_KV_KEY, JSON.stringify(payload), {
      expirationTtl: BENCHMARKS_TTL_SECONDS,
    })

    console.log(`Benchmark cron: stored benchmarks (source: ${benchmarks.source})`)
  },
}
