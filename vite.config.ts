import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

// Relative base so the bundle works under any GitHub Pages path (/<repo>/) without config.
export default defineConfig(({ mode }) => ({
  base: './',
  // `npm run dev:lan`: HTTPS with a throwaway self-signed certificate. Trystero needs WebCrypto,
  // which browsers only offer in secure contexts (https or localhost), not on http://<LAN-IP>.
  plugins: mode === 'lan' ? [basicSsl()] : [],
  // allowedHosts: Vite rejects unknown Host headers (DNS-rebinding guard); the LAN name must be listed.
  server: { port: 5190, strictPort: false, allowedHosts: ['odessa.fritz.box'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
}));
