import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  define: {
    // react-draggable (bundled by react-grid-layout) reads process.env.DRAGGABLE_DEBUG
    // directly; Vite doesn't polyfill bare `process` like webpack/CRA did, so any drag
    // interaction threw "process is not defined" and aborted before resizing/moving.
    'process.env': {}
  }
});
