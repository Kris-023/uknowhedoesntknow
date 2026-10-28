import { defineConfig } from 'vite';

// Relative base so the bundle works under any GitHub Pages path (/<repo>/) without config.
export default defineConfig({
  base: './',
  // allowedHosts: Vite rejects unknown Host headers (DNS-rebinding guard); the LAN name must be listed.
  server: { port: 5190, strictPort: false, allowedHosts: ['odessa.fritz.box'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
});
