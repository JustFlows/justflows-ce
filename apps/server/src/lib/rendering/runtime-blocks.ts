// SPDX-License-Identifier: MIT

import { createBlockRegistrySync, type BlockDefinition, type BlockRegistry } from "@justflows/blocks";
import type { PluginBlockRegistry } from "@justflows/plugin-api";
import type { PluginBlockDefinition } from "@justflows/sdk";
import { withRenderTimeLimit } from "./plugin-render-guard.js";

let registry: BlockRegistry | null = null;

export function getRuntimeBlockRegistry(): BlockRegistry {
  if (!registry) registry = createBlockRegistrySync();
  return registry;
}

export function pluginBlockAdapter(): PluginBlockRegistry {
  const blocks = getRuntimeBlockRegistry();
  return {
    register(definition: PluginBlockDefinition) {
      /** Every plugin render runs under a time limit (justflows-ce#316). */
      blocks.register(withRenderTimeLimit(definition as unknown as BlockDefinition));
    },
    unregister(type: string) {
      blocks.unregister(type);
    },
  };
}
