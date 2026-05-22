import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  clearScreen: false,

  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
    allowedHosts: [
      'dashboard-web-production-f5b4.up.railway.app',
      'localhost',
      '127.0.0.1'
    ]
  },

  preview: {
    host: '0.0.0.0',
    port: 5174,
    allowedHosts: [
      'dashboard-web-production-f5b4.up.railway.app',
      'localhost',
      '127.0.0.1'
    ]
  },

  envPrefix: ['VITE_', 'TAURI_'],

  build: {
    target: 'es2020',
    outDir: 'dist'
  }
})