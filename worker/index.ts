import { nanoid } from 'nanoid'

export interface Env {
  REVIEWS: KVNamespace
  ALLOWED_ORIGIN: string
}

const MAX_PAYLOAD_BYTES = 100_000   // 100 KB hard limit
const TTL_SECONDS = 60 * 60 * 24 * 365  // 1 year

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const origin = request.headers.get('Origin') ?? '*'
    const allowedOrigin = env.ALLOWED_ORIGIN ?? '*'

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(allowedOrigin) })
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

      const id = nanoid(10)   // e.g. "V1StGXR8_Z"
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
}
