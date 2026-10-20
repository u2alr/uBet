import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const proxy = {
  '/api': 'http://localhost:8788',
  // Local helper that runs ingest/sync.py (npm run dev:sync).
  '/local-sync': { target: 'http://127.0.0.1:8789', rewrite: (p: string) => p.replace(/^\/local-sync/, '') },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy },
  // `npm run preview` serves the production build, which is what to judge speed on: the dev server ships React's
  // development build, which is several times slower.
  preview: { proxy },
})
