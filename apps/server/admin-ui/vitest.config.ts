import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const adminUiRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: adminUiRoot,
  resolve: {
    alias: {
      "@components": path.resolve(adminUiRoot, "src/components"),
      "@lib": path.resolve(adminUiRoot, "../src/lib"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["./tests/helpers/setup.ts"],
  },
});
