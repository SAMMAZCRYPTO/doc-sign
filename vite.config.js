import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('pdf-lib')) return 'vendor-pdf';
            if (id.includes('jszip')) return 'vendor-zip';
            if (id.includes('react') || id.includes('react-dom')) return 'vendor-react';
            return 'vendor'; // all other node_modules
          }
        }
      }
    }
  }
})
