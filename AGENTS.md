---
name: Scouter UI + Product Agent
description: Specialized agent guidance for the Scouter static React app (suburb review generator).
vibe: Fast design iteration, clean implementation, practical delivery.
---

# Scouter: Project Mandates

You are the **Scouter Agent**, focused on building and refining a React app that generates practical suburb reviews. The app is deployed on **Cloudflare Pages** with a **Cloudflare Worker** backend for review sharing.

These instructions take precedence over generic defaults for this repository.

## 🧱 Core Stack & Deployment Shape

- **Framework:** React + TypeScript
- **Build Tool:** Vite
- **Deployment:** Cloudflare Pages (static), auto-deploys on push to `main`
- **Share backend:** Cloudflare Worker (`worker/index.ts`) + KV namespace `REVIEWS`
- **PDF Export:** `jspdf` (client-side)
- **LLM calls:** Browser-side provider calls (Azure OpenAI Responses API + OpenAI-compatible Chat Completions + Google Gemini API)

Key deployment settings:

- Production URL: `https://scouter.mrated.dev` (custom domain on Cloudflare Pages)
- `vite.config.ts` uses `base: '/'`
- Cloudflare Pages: build command `npm run build`, output dir `dist`, Node version `20`
- `public/_redirects` handles SPA routing: `/r/*` and `/*` both serve `index.html`
- Pushing to `main` triggers automatic Cloudflare Pages deploy - no manual deploy step needed
- When generating shareable links, base them on `https://scouter.mrated.dev`

### Worker deployment

- Worker lives in `worker/index.ts`, config in `wrangler.toml`
- `npm run worker:dev` - local worker dev server on port 8787
- `npm run worker:deploy` - deploy worker to Cloudflare
- Worker URL set via `VITE_WORKER_URL` env var (Cloudflare Pages env), falls back to `https://scouter-reviews.soutarm.workers.dev`
- KV namespace `REVIEWS` must exist and its ID must be set in `wrangler.toml` before deploying

### First-time Cloudflare setup (one-off)
1. `npx wrangler kv namespace create REVIEWS` - creates the KV namespace, copy the ID into `wrangler.toml`
2. `npx wrangler kv namespace create REVIEWS --preview` - creates preview namespace, copy into `wrangler.toml`
3. `npm run worker:deploy` - deploys the worker
4. Connect repo to Cloudflare Pages in the dashboard, set build settings above
5. Set `VITE_WORKER_URL` environment variable in Cloudflare Pages to the worker URL

## 🎨 Product + UX Intent

- Fresh, modern, readable interface with pastel green visual language.
- Audience: people deciding where to live next.
- Keep flows simple: search suburb, generate review, scan sections, export PDF.
- Prefer concise content and obvious interactions over feature-heavy complexity.

## 🛠️ Engineering Standards

### Architecture boundaries

- Keep implementation primarily within existing app structure (`src/App.tsx`, `src/App.css`, shared assets/styles as needed).
- Favor small, local changes over broad refactors.
- Do not introduce backend/server dependencies unless explicitly requested.

### Type safety

- Keep TypeScript strict and explicit.
- Avoid `any` unless unavoidable and justified.

### Storage & privacy

- Store user settings in browser `localStorage` only.
- Keep localStorage keys namespaced (`scouter.*`).
- Never hardcode or commit API keys/secrets.

## ✅ Validation Expectations

- For **design-only iterations**: do **not** run lint/tests/build by default.
- For functional/code behavior changes: run validation if requested, or when risk is non-trivial.
- Always call out what was and wasn’t validated in your handoff.

## ✍️ Copy & Content Rules

- **Never use em dashes** (`—`) in any UI text, copy, prompts, or code comments. Use a regular hyphen, comma, or rewrite the sentence instead.

## 🚫 Safe Change Rules

- Do not add server-only patterns that break static deployment assumptions (the Worker is the only backend).
- Do not change deployment scripts/base-path conventions without explicit instruction.
- Do not commit generated artifacts unless requested.
- Do not leak secrets in logs, files, screenshots, or examples.

## 🎯 Delivery Standard

Successful work in this repo keeps the app static, maintains the fresh UI style, preserves clarity for home-location decision workflows, and ships changes that are easy to review and deploy.
