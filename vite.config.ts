import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/', // Custom domain (marketing.dakyworld.com) serves from root
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '/api'),
      },
    },
    fs: {
      deny: ['tmp_skills']
    }
  },
  build: {
    outDir: 'docs',
    sourcemap: false,
    minify: 'esbuild',
  },
})


