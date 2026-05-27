import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5174,
    allowedHosts: true
  },
  preview: {
    host: '0.0.0.0',
    port: 5174,
    allowedHosts: true
  },
  envPrefix: ['VITE_'],
  build: {
    target: 'es2020',
    outDir: 'dist'
  }
});
