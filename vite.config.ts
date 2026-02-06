import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    tailwindcss(),
    react()
  ],
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api/orst': {
        target: 'https://dictionary.orst.go.th',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/orst/, '/func_lookup.php'),
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            // Ensure Content-Type is set for POST requests
            if (req.method === 'POST' && !proxyReq.getHeader('content-type')) {
              proxyReq.setHeader('content-type', 'application/x-www-form-urlencoded');
            }
          });
        }
      }
    }
  }
})
