import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // 监听全部网卡，局域网可通过 192.168.1.136:5173 访问
    port: 5173,
    proxy: { '/api': 'http://localhost:8010' },
  },
})
