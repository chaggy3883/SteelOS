import { fileURLToPath, URL } from 'node:url'
import fs from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const DB_JSON_PATH = fileURLToPath(new URL('./db.json', import.meta.url))

// Flash-drive/portable-dev persistence: this app's "database" is otherwise
// just browser localStorage (see STORAGE_KEY in src/api/localData.js), which
// is tied to one browser profile on one machine — it does not travel with
// the project folder when the repo lives on a USB drive moved between
// laptops. Browser JS has no synchronous (or even ambient) filesystem
// access, so there is no way to make the client itself write to a real file
// on disk directly. This dev-server-only middleware is the actual mechanism
// that can: it runs in Node (via `npm run dev`), so it has real `fs` access,
// and the browser talks to it over plain HTTP like any other endpoint. This
// only exists while the Vite dev server is running — it is not part of the
// production build and does nothing in a static/hosted deployment.
function localDbFilePlugin() {
  return {
    name: 'local-db-file-sync',
    configureServer(server) {
      server.middlewares.use('/__db-sync', (req, res) => {
        if (req.method === 'GET') {
          try {
            const raw = fs.readFileSync(DB_JSON_PATH, 'utf-8')
            res.setHeader('Content-Type', 'application/json')
            res.end(raw)
          } catch (e) {
            res.setHeader('Content-Type', 'application/json')
            res.end('{}')
          }
          return
        }
        if (req.method === 'POST') {
          let body = ''
          req.on('data', (chunk) => { body += chunk })
          req.on('end', () => {
            try {
              // Parse-then-restringify so a malformed/partial request body
              // can never corrupt db.json into invalid JSON on disk.
              const parsed = JSON.parse(body || '{}')
              fs.writeFileSync(DB_JSON_PATH, JSON.stringify(parsed, null, 2))
              res.statusCode = 204
              res.end()
            } catch (e) {
              res.statusCode = 400
              res.end('Invalid JSON body')
            }
          })
          return
        }
        res.statusCode = 405
        res.end('Method not allowed')
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), localDbFilePlugin()],
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
