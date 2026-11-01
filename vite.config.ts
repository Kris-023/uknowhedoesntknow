/// <reference types="vitest/config" />
import basicSsl from '@vitejs/plugin-basic-ssl';
import { configDefaults } from 'vitest/config';
import { defineConfig, loadEnv } from 'vite';

// Relative base so the bundle works under any GitHub Pages path (/<repo>/) without config.
export default defineConfig(({ mode }) => {
  // LAN dev: comma-separated host names allowed to reach the dev server,
  // e.g. UKHDK_ALLOWED_HOSTS=my-pc.lan npm run dev:lan (also read from a gitignored .env.local).
  const allowedHosts = (loadEnv(mode, process.cwd(), '').UKHDK_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  return {
    base: './',
    // `npm run dev:lan`: HTTPS with a throwaway self-signed certificate. Trystero needs WebCrypto,
    // which browsers only offer in secure contexts (https or localhost), not on http://<LAN-IP>.
    plugins: mode === 'lan' ? [basicSsl()] : [],
    // allowedHosts: Vite rejects unknown Host headers (DNS-rebinding guard); the LAN name must be listed.
    // Empty list keeps Vite's default.
    // Local tool folders under .claude/ may hold copies of the tests; only this project's own are run.
    test: { exclude: [...configDefaults.exclude, '.claude/**'] },
    server: { port: 5190, strictPort: false, allowedHosts },
    build: {
      target: 'es2022',
      // three alone is ~570 kB minified and cannot be split further.
      chunkSizeWarningLimit: 600,
      // Libraries change far less often than game code; separate chunks stay cached across deploys.
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: 'three', test: /node_modules[\\/]three[\\/]/ },
              // The noise suppressor is loaded on demand; keep it out of the eager vendor chunk.
              { name: 'vendor', test: /node_modules[\\/](?!@sapphi-red)/ },
            ],
          },
        },
      },
    },
  };
});
