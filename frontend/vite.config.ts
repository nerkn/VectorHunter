import { defineConfig, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { writeFileSync, mkdirSync } from 'fs'

function saveGrayPlugin(): Plugin {
  return {
    name: 'save-gray',
    configureServer(server) {
      server.middlewares.use('/save-gray', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('POST only')
          return
        }
        const chunks: Buffer[] = []
        const filename = req.headers['x-filename'] as string || 'frame.gray'
        req.on('data', (chunk: Buffer) => chunks.push(chunk))
        req.on('end', () => {
          const dir = path.resolve(__dirname, 'docs/frames')
          mkdirSync(dir, { recursive: true })
          writeFileSync(path.join(dir, filename), Buffer.concat(chunks))
          res.statusCode = 200
          res.end('ok')
        })
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