import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hideReactRouterVersion } from "./hide-react-router-version.ts";

const adminUiRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [hideReactRouterVersion(), react()],
  optimizeDeps: {
    rolldownOptions: {
      plugins: [hideReactRouterVersion()],
    },
  },
  root: adminUiRoot,
  base: "/",
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "react-vendor",
              test: /node_modules[\\/](?:react|react-dom|react-router|react-router-dom)[\\/]/,
              priority: 30,
            },
            // Keep heavy, rarely-changing libraries out of the builder chunk
            // so they cache independently across admin releases.
            {
              name: "katex-vendor",
              test: /node_modules[\\/]katex[\\/]/,
              priority: 25,
            },
            {
              name: "motion-vendor",
              test: /node_modules[\\/](?:framer-motion|motion-dom|motion-utils)[\\/]/,
              priority: 25,
            },
            {
              name: "blocks-core",
              test: /packages[\\/]blocks[\\/](?:src|dist)[\\/]/,
              priority: 24,
            },
            {
              name: "validation-vendor",
              test: /node_modules[\\/](?:zod|sanitize-html|htmlparser2|domhandler|domutils|entities|dom-serializer|domelementtype)[\\/]/,
              priority: 23,
            },
            /**
             * Admin source is not grouped: each lazy route in App.tsx gets its
             * own chunk, and builder code splits with the pages that use it.
             * A group here would also capture the shared modules it imports
             * (i18n, router helpers), which the entry needs, and so turn the
             * whole group into part of every first load.
             */
          ],
        },
      },
    },
  },
  resolve: {
    alias: {
      "@components": path.resolve(adminUiRoot, "src/components"),
      "@lib": path.resolve(adminUiRoot, "../src/lib"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
