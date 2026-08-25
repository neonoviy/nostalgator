import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import dotenv from 'dotenv'

dotenv.config()

const deepLinkPlugin = {
  name: 'deep-link-fallback',
  configureServer(server) {
    const fs = require('fs')
    const path = require('path')
    const indexPath = path.resolve(__dirname, 'src/client/index.html')

    server.middlewares.use((req, res, next) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/thumbnails/') || req.url.startsWith('/originals/')) {
        return next()
      }

      const urlPath = req.url.split('?')[0]

      const yearMonthMatch = urlPath.match(/^\/(\d{4})(\/\d{2}\.\d{2})?$/)
      if (yearMonthMatch) {
        res.statusCode = 301
        res.setHeader('Location', req.url + '/')
        res.end()
        return
      }

      const deepLinkMatch = urlPath.match(/^\/(\d{4}\/[^\/]+\/.+\.(jpg|jpeg|png|gif|webp|mp4|mov|avi|mkv))$/)
      if (deepLinkMatch) {
        fs.readFile(indexPath, 'utf-8', (err, content) => {
          if (err) return next()
          res.setHeader('Content-Type', 'text/html')
          res.end(content)
        })
        return
      }

      next()
    })
  }
}

export default defineConfig({
  plugins: [vue(), deepLinkPlugin],
  appType: 'spa',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/client/src')
    }
  },
  server: {
    port: parseInt(process.env.CLIENT_PORT) || 3000,
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.SERVER_PORT || 3001}`,
        changeOrigin: true,
        secure: false,
        timeout: 30000,
        proxyTimeout: 30000
      },
      '/thumbnails': {
        target: `http://localhost:${process.env.SERVER_PORT || 3001}`,
        changeOrigin: true,
        secure: false,
        timeout: 30000,
        proxyTimeout: 30000
      },
      '/originals': {
        target: `http://localhost:${process.env.SERVER_PORT || 3001}`,
        changeOrigin: true,
        secure: false,
        timeout: 30000,
        proxyTimeout: 30000
      },
      '/ws': {
        target: `http://localhost:${process.env.SERVER_PORT || 3001}`,
        changeOrigin: true,
        ws: true,
        secure: false,
        timeout: 30000,
        proxyTimeout: 30000,
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            if (err.code !== 'ECONNABORTED' && err.code !== 'ECONNRESET') {
              console.error('Proxy error intercepted:', err.message)
            }
          })
          proxy.on('proxyReqWs', (proxyReq, req, socket, _options, head) => {
            socket.on('error', (err) => {
              if (err.code === 'ECONNABORTED' || err.code === 'ECONNRESET') {
                return
              }
              console.error('socket error', err)
            })
          })
        }
      }
    }
  },
  build: {
    outDir: '../../dist',
    assetsDir: 'assets'
  },
  root: './src/client'
})
