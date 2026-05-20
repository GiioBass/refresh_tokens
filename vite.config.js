import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Usar true para permitir todos los hosts en versiones recientes de Vite
    allowedHosts: true,
    host: true, // Escuchar en todas las interfaces
    proxy: {
      '/api/logs': {
        target: 'http://localhost:3005',
        changeOrigin: true,
      }
    }
  }
})
