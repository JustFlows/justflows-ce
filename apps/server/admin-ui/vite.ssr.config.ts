import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { hideReactRouterVersion } from "./hide-react-router-version.ts";

const adminUiRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [hideReactRouterVersion(), react()],
  root: adminUiRoot,
  build: {
    outDir: "dist/server",
    emptyOutDir: true,
    ssr: "src/entry-server.tsx",
    rolldownOptions: {
      output: {
        entryFileNames: "entry-server.js",
        // Keep the distribution self-contained while giving server libraries
        // and application areas their own modules instead of one giant entry.
        codeSplitting: {
          groups: [
            { name: "ssr-react", test: /node_modules[\\/](?:react|react-dom|react-router|react-router-dom)[\\/]/, priority: 30 },
            { name: "ssr-katex", test: /node_modules[\\/]katex[\\/]/, priority: 25 },
            { name: "ssr-motion", test: /node_modules[\\/](?:framer-motion|motion-dom|motion-utils)[\\/]/, priority: 25 },
            { name: "ssr-blocks", test: /packages[\\/]blocks[\\/](?:src|dist)[\\/]/, priority: 24 },
            { name: "ssr-validation", test: /node_modules[\\/](?:zod|sanitize-html|htmlparser2|domhandler|domutils|entities|dom-serializer|domelementtype)[\\/]/, priority: 23 },
            { name: "ssr-builder", test: /admin-ui[\\/]src[\\/]components[\\/]builder[\\/]/, priority: 20 },
            { name: "ssr-pages", test: /admin-ui[\\/]src[\\/]pages[\\/]/, priority: 10 },
            { name: "ssr-vendor", test: /node_modules[\\/]/, priority: 5, maxSize: 400 * 1024 },
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
  ssr: {
    noExternal: true,
  },
});
