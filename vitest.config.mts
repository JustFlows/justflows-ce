import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/admin-bridge/vitest.config.ts",
      "packages/blocks/vitest.config.ts",
      "packages/cache/vitest.config.ts",
      "packages/content/vitest.config.ts",
      "packages/core/vitest.config.ts",
      "packages/installer/vitest.config.ts",
      "packages/media/vitest.config.ts",
      "packages/plugin-api/vitest.config.ts",
      "packages/sdk/vitest.config.ts",
      "apps/server/vitest.config.ts",
      "apps/server/admin-ui/vitest.config.ts",
      "plugins/hello-world/vitest.config.ts",
    ],
  },
});
