import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  define: {
    global: 'globalThis',
  },
  optimizeDeps: {
    include: ['jsonld', 'jose', '@noble/ed25519', '@noble/hashes'],
  },
  resolve: {
    alias: {
      'node:buffer': 'buffer',
      'node:util': 'util',
      'node:url': 'url',
      'node:https': 'https',
      'node:http': 'http',
      'node:stream': 'stream-browserify',
      'node:path': 'path',
    },
  },
})
