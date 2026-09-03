// SPDX-License-Identifier: MIT

import {
  BlockPatternSchema,
  type BlockPattern,
  type PluginPatternDefinition,
} from "@justflows/sdk";

export interface RegisteredPluginPattern extends BlockPattern {
  pluginId: string;
  registryId: string;
}

export class PluginPatternRegistry {
  private readonly patterns = new Map<string, RegisteredPluginPattern>();

  register(pluginId: string, input: PluginPatternDefinition): () => void {
    const parsed = BlockPatternSchema.safeParse(input);
    if (!parsed.success) {
      throw new Error(
        `Plugin "${pluginId}" registered an invalid pattern: ${parsed.error.issues.map((issue) => issue.message).join(", ")}`,
      );
    }
    const registryId = `${pluginId}:${parsed.data.id}`;
    if (this.patterns.has(registryId)) {
      throw new Error(`Plugin pattern "${registryId}" is already registered`);
    }
    this.patterns.set(registryId, { ...parsed.data, pluginId, registryId });
    return () => this.patterns.delete(registryId);
  }

  get(registryId: string): RegisteredPluginPattern | undefined {
    return this.patterns.get(registryId);
  }

  all(): RegisteredPluginPattern[] {
    return [...this.patterns.values()];
  }

  removePlugin(pluginId: string): void {
    for (const [registryId, pattern] of this.patterns) {
      if (pattern.pluginId === pluginId) this.patterns.delete(registryId);
    }
  }
}
