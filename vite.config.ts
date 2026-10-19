import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:8788',
      // Local helper that runs ingest/sync.py (npm run dev:sync).
      '/local-sync': { target: 'http://127.0.0.1:8789', rewrite: (p) => p.replace(/^\/local-sync/, '') },
    },
  },
})
