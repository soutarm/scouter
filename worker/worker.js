const MAX_PAYLOAD_BYTES = 100_000
const TTL_SECONDS = 60 * 60 * 24 * 365

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const nanoid = (size = 10) => {
  const bytes = crypto.getRandomValues(new Uint8Array(size))
  return Array.from(bytes).map((b) => ALPHABET[b % ALPHABET.length]).join('')
}

const corsHeaders = (origin) => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
})

const json = (data, status = 200, origin = '*') =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  })

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const allowedOrigin = env.ALLOWED_ORIGIN ?? '*'

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(allowedOrigin) })
    }

    if (request.method === 'POST' && url.pathname === '/reviews') {
      let body
      try {
        body = await request.text()
      } catch {
        return json({ error: 'Could not read request body' }, 400, allowedOrigin)
      }
      if (body.length > MAX_PAYLOAD_BYTES) {
        return json({ error: 'Payload too large' }, 413, allowedOrigin)
      }
      let parsed
      try {
        parsed = JSON.parse(body)
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

    const getMatch = url.pathname.match(/^\/reviews\/([A-Za-z0-9_-]{6,20})$/)
    if (request.method === 'GET' && getMatch) {
      const value = await env.REVIEWS.get(getMatch[1])
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
