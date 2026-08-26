import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const adminUiRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: adminUiRoot,
  build: {
    outDir: "dist/server",
    emptyOutDir: true,
    ssr: "src/entry-server.tsx",
    rolldownOptions: {
      output: { entryFileNames: "entry-server.js" },
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
