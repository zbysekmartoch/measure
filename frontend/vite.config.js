import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 50101,
    proxy: {
      // Forward all /api requests to the backend running on :50100
      '/api': {
        target: 'http://localhost:50100',
        changeOrigin: true
      },
      // Forward DAP WebSocket proxy
      '/dap': {
        target: 'ws://localhost:50100',
        ws: true
      }
    }
  }
})
