import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    globals: false,
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
