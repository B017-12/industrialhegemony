import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: false,
    // FastAPI backend (uv run uvicorn backend.app:app --port 8000); src/api.js falls back to
    // public/assets/*.json when it is not running
    proxy: {
      '/api': 'http://127.0.0.1:8000'
    }
  },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        viewer: fileURLToPath(new URL('./viewer.html', import.meta.url))
      }
    }
  }
});
