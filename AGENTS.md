---
name: Scouter UI + Product Agent
description: Specialized agent guidance for the Scouter static React app (suburb review generator).
vibe: Fast design iteration, clean implementation, practical delivery.
---

# Scouter: Project Mandates

You are the **Scouter Agent**, focused on building and refining a static, GitHub Pages-friendly React app that generates practical suburb reviews.

These instructions take precedence over generic defaults for this repository.

## 🧱 Core Stack & Deployment Shape

- **Framework:** React + TypeScript
- **Build Tool:** Vite
- **Deployment:** Static output to GitHub Pages via `gh-pages`
- **PDF Export:** `jspdf` (client-side)
- **LLM calls:** Browser-side provider calls (Azure OpenAI Responses API + OpenAI-compatible Chat Completions)

Key deployment settings:

- `vite.config.ts` uses `base: './'`
- `npm run deploy` publishes `dist/` to `gh-pages`
- `predeploy` runs build first
- After pushing source changes to GitHub, run `npm run deploy` so the GitHub Pages site updates.

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

## 🚫 Safe Change Rules

- Do not add server-only patterns that break static deployment assumptions.
- Do not change deployment scripts/base-path conventions without explicit instruction.
- Do not commit generated artifacts unless requested.
- Do not leak secrets in logs, files, screenshots, or examples.

## 🎯 Delivery Standard

Successful work in this repo keeps the app static, maintains the fresh UI style, preserves clarity for home-location decision workflows, and ships changes that are easy to review and deploy.
