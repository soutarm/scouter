// Cloudflare Pages Function: injects per-review Open Graph / Twitter meta tags
// into the SPA shell for /r/:id share links, so pasting a link into Slack,
// iMessage, Twitter etc. shows the suburb name and a short description
// instead of the generic site preview. Real visitors still get the normal
// SPA (this only rewrites <head> tags on top of the same index.html).

const WORKER_BASE_URL = 'https://scouter-reviews.soutarm.workers.dev'

type SharedReview = {
  suburb?: unknown
  state?: unknown
  summary?: unknown
  scores?: { overall?: unknown }
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const truncate = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value

class MetaTagInjector {
  private readonly title: string
  private readonly description: string
  private readonly url: string

  constructor(title: string, description: string, url: string) {
    this.title = title
    this.description = description
    this.url = url
  }

  element(element: Element) {
    element.append(
      `<meta name="description" content="${escapeHtml(this.description)}">` +
      `<meta property="og:type" content="website">` +
      `<meta property="og:site_name" content="Scouter">` +
      `<meta property="og:title" content="${escapeHtml(this.title)}">` +
      `<meta property="og:description" content="${escapeHtml(this.description)}">` +
      `<meta property="og:url" content="${escapeHtml(this.url)}">` +
      `<meta name="twitter:card" content="summary">` +
      `<meta name="twitter:title" content="${escapeHtml(this.title)}">` +
      `<meta name="twitter:description" content="${escapeHtml(this.description)}">`,
      { html: true },
    )
  }
}

class TitleReplacer {
  private readonly title: string

  constructor(title: string) {
    this.title = title
  }

  element(element: Element) {
    element.setInnerContent(this.title)
  }
}

export const onRequestGet: PagesFunction = async (context) => {
  const response = await context.next()

  const id = context.params.id
  const reviewId = Array.isArray(id) ? id[0] : id
  if (!reviewId || !/^[A-Za-z0-9_-]{6,20}$/.test(reviewId)) return response

  let review: SharedReview | null = null
  try {
    const res = await fetch(`${WORKER_BASE_URL}/reviews/${encodeURIComponent(reviewId)}`, {
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) review = await res.json()
  } catch {
    return response
  }

  const suburb = typeof review?.suburb === 'string' ? review.suburb.trim() : ''
  const state = typeof review?.state === 'string' ? review.state.trim() : ''
  const summary = typeof review?.summary === 'string' ? review.summary.trim() : ''
  if (!suburb || !state) return response

  const overall = typeof review?.scores?.overall === 'number' ? review.scores.overall : undefined
  const title = `${suburb}, ${state} · Scouter`
  const scorePrefix = overall !== undefined ? `Overall score ${overall.toFixed(1)}/10. ` : ''
  const description = truncate(
    `${scorePrefix}${summary || `Scouter's AI-generated suburb review for ${suburb}, ${state}.`}`,
    200,
  )
  const url = new URL(context.request.url).toString()

  return new HTMLRewriter()
    .on('title', new TitleReplacer(title))
    .on('head', new MetaTagInjector(title, description, url))
    .transform(response)
}
