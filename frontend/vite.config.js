import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Forward all /api requests to the backend running on :3000
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      // Forward DAP WebSocket proxy
      '/dap': {
        target: 'ws://localhost:3000',
        ws: true
      }
    }
  }
})
