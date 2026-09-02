import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/core/vitest.config.ts",
  "packages/content/vitest.config.ts",
  "packages/plugin-api/vitest.config.ts",
  "packages/blocks/vitest.config.ts",
  "packages/installer/vitest.config.ts",
  "plugins/hello-world/vitest.config.ts",
  "plugins/consent/vitest.config.ts",
]);
