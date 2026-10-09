import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: { outDir: 'dist', assetsDir: 'assets' },
  server: { port: 3000, host: '0.0.0.0' },
  // Allow tunnel/proxy hosts (e.g. *.trycloudflare.com) used by the
  // public preview; otherwise vite preview answers 403 to foreign Hosts.
  preview: { host: '0.0.0.0', allowedHosts: true }
});
