import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
  },
  server: {
    proxy: {
      // Proxy Anthropic API calls in local dev to avoid CORS restrictions.
      // In production this path is never used - Anthropic is a dev-only provider.
      '/anthropic-api': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/anthropic-api/, ''),
        // Node's TLS stack may fail on machines with a corporate proxy (e.g. Zscaler).
        // This only affects the local dev proxy - never runs in production.
        secure: false,
      },
    },
  },
  base: '/',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'react'
          }

          if (id.includes('node_modules/jspdf')) {
            return 'pdf'
          }
        },
      },
    },
  },
})
