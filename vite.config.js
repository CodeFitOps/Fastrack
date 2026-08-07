import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // A packaged app loads from file:// or a custom scheme, not a web root.
  base: './',
  build: {
    // Native shells ship their own WebView; no legacy browser targets needed.
    target: 'es2022',
    rollupOptions: {
      // Optional native deps: only the shell you actually build installs these,
      // so the web/dev build must not try to resolve them.
      external: [
        '@tauri-apps/plugin-store',
        '@tauri-apps/plugin-notification',
        '@capacitor/preferences',
        '@capacitor/local-notifications',
      ],
    },
  },
});
