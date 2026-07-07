import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// ollama.com does not send CORS headers, so the browser cannot call it
// directly; the dev/preview server proxies /ollama-cloud/* to it instead.
const ollamaCloudProxy = {
  '/ollama-cloud': {
    target: 'https://ollama.com',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/ollama-cloud/, ''),
  },
};

export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: ollamaCloudProxy,
      },
      preview: {
        proxy: ollamaCloudProxy,
      },
      plugins: [react(), tailwindcss()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
