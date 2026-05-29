import { defineConfig, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { writeFileSync, mkdirSync, readdirSync, readFileSync, existsSync } from 'fs'

function saveGrayPlugin(): Plugin {
  return {
    name: 'save-gray',
    configureServer(server) {
      server.middlewares.use('/save-gray', (req, res) => {
        const baseDir = path.resolve(__dirname, 'docs/frames')

        const safePath = (p: string) => {
          const resolved = path.resolve(baseDir, p)
          if (!resolved.startsWith(baseDir)) return null
          return resolved
        }

        if (req.method === 'POST') {
          const chunks: Buffer[] = []
          const filename = req.headers['x-filename'] as string || 'frame.gray'
          const folder = req.headers['x-folder'] as string || ''
          req.on('data', (chunk: Buffer) => chunks.push(chunk))
          req.on('end', () => {
            const dir = folder ? safePath(folder) : baseDir
            if (!dir) { res.statusCode = 400; res.end('bad path'); return }
            mkdirSync(dir, { recursive: true })
            writeFileSync(path.join(dir, filename), Buffer.concat(chunks))
            res.statusCode = 200
            res.end('ok')
          })
          return
        }

        if (req.method === 'GET') {
          const url = new URL(req.url || '', 'http://localhost')
          const action = url.pathname.replace(/^\/save-gray\/?/, '').replace(/^\/+/, '')

          if (action === 'sessions') {
            const entries = existsSync(baseDir) ? readdirSync(baseDir, { withFileTypes: true }) : []
            const sessions = entries
              .filter((e: any) => e.isDirectory())
              .map((e: any) => e.name)
              .sort()
              .reverse()
            const rootGray = entries.filter((e: any) => e.isFile() && e.name.endsWith('.gray')).length
            if (rootGray > 0) sessions.push('_root')
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(sessions))
            return
          }

          if (action === 'list') {
            const session = url.searchParams.get('session') || ''
            const dir = session && session !== '_root' ? safePath(session) : baseDir
            if (!dir || !existsSync(dir)) { res.statusCode = 404; res.end('not found'); return }
            const files = readdirSync(dir).sort()
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(files))
            return
          }

          if (action === 'file') {
            const session = url.searchParams.get('session') || ''
            const file = url.searchParams.get('file')
            if (!file) { res.statusCode = 400; res.end('no file'); return }
            const dir = session && session !== '_root' ? safePath(session) : baseDir
            if (!dir) { res.statusCode = 400; res.end('bad path'); return }
            const fp = safePath(session && session !== '_root' ? session + '/' + file : file)
            if (!fp || !existsSync(fp)) { res.statusCode = 404; res.end('not found'); return }
            const buf = readFileSync(fp)
            if (file.endsWith('.json')) res.setHeader('Content-Type', 'application/json')
            else res.setHeader('Content-Type', 'application/octet-stream')
            res.end(buf)
            return
          }
        }

        res.statusCode = 405
        res.end('POST/GET only')
      })
    }
  }
}

export default defineConfig({
  plugins: [react(), saveGrayPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true
      }
    }
  }
})