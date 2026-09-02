// SPDX-License-Identifier: MIT
import { USER_CAPABILITIES, type UserCapabilityDefinition } from "@justflows/sdk";

const ID = /^[a-z][a-z0-9.-]{0,79}:[a-z][a-z0-9.-]{0,79}$/;
const CORE = new Set<string>(USER_CAPABILITIES);

export class PluginCapabilityRegistry {
  private readonly definitions = new Map<string, UserCapabilityDefinition & { pluginId: string }>();

  register(pluginId: string, definition: UserCapabilityDefinition): void {
    const id = String(definition.id);
    if (!ID.test(id)) throw new Error(`Plugin "${pluginId}" capability "${id}" must use lower-case domain:action syntax`);
    if (CORE.has(id)) throw new Error(`Plugin "${pluginId}" cannot replace core capability "${id}"`);
    const existing = this.definitions.get(id);
    if (existing && existing.pluginId !== pluginId) {
      throw new Error(`Capability "${id}" is already registered by plugin "${existing.pluginId}"`);
    }
    this.definitions.set(id, {
      id,
      pluginId,
      ...(definition.label ? { label: definition.label.trim().slice(0, 100) } : {}),
      ...(definition.group ? { group: definition.group.trim().slice(0, 60) } : {}),
      ...(definition.description ? { description: definition.description.trim().slice(0, 300) } : {}),
      defaultRoles: definition.defaultRoles?.map(String) ?? ["administrator"],
    });
  }

  removePlugin(pluginId: string): void {
    for (const [id, definition] of this.definitions) {
      if (definition.pluginId === pluginId) this.definitions.delete(id);
    }
  }

  all(): Array<UserCapabilityDefinition & { pluginId: string }> {
    return [...this.definitions.values()];
  }
}
