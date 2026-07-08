import path from 'path';
import { execFileSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

function buildInfo(): string {
  let sha = 'dev';
  try {
    sha = execFileSync('git', ['rev-parse', '--short', 'HEAD']).toString().trim();
  } catch {
    // Not a git checkout (e.g. CI tarball) — keep the fallback.
  }
  return `${sha} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

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
      define: {
        __BUILD_INFO__: JSON.stringify(buildInfo()),
      },
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
