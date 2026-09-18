// SPDX-License-Identifier: MIT

import { createBlockRegistrySync, type BlockDefinition, type BlockRegistry } from "@justflows/blocks";
import type { PluginBlockRegistry } from "@justflows/plugin-api";
import type { PluginBlockDefinition } from "@justflows/sdk";

let registry: BlockRegistry | null = null;

export function getRuntimeBlockRegistry(): BlockRegistry {
  if (!registry) registry = createBlockRegistrySync();
  return registry;
}

export function pluginBlockAdapter(): PluginBlockRegistry {
  const blocks = getRuntimeBlockRegistry();
  return {
    register(definition: PluginBlockDefinition) {
      blocks.register(definition as unknown as BlockDefinition);
    },
    unregister(type: string) {
      blocks.unregister(type);
    },
  };
}
