import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig(({ isSsrBuild }) => ({
  base: '/',
  plugins: [react(), ...(!isSsrBuild ? [inspectAttr()] : [])],
  server: {
    port: 3000,
    host: true,
  },
  build: isSsrBuild ? {
    rollupOptions: { output: { entryFileNames: 'entry-server.js' } },
  } : {
    rollupOptions: {
      output: {
        // Content-hashed names are REQUIRED: vercel.json serves /assets/* with
        // `max-age=31536000, immutable`, so a stable name like assets/app.js
        // pinned returning visitors to a year-old bundle. Deploys appeared to do
        // nothing — the server HTML updated while the browser kept executing old
        // JavaScript. SSR picks the hashed names up automatically because
        // server/runtime.mjs serves the built index.html rather than hardcoding
        // asset paths.
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        manualChunks(id) {
          if (id.includes('/src/locales/')) return 'app-locales';
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@supabase')) return 'vendor-supabase';
          if (id.includes('lucide-react')) return 'vendor-icons';
          if (id.includes('@radix-ui') || id.includes('cmdk') || id.includes('vaul')) return 'vendor-ui';
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('react-router') || id.includes('/scheduler/')) return 'vendor-react';
          return undefined;
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
