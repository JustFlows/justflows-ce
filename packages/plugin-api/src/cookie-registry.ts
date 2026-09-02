// SPDX-License-Identifier: MIT

import { CookieDeclarationSchema, type CookieDeclaration } from "@justflows/sdk";

/**
 * In-process store of the cookies each active plugin has declared. Mirrors
 * `PluginHttpRouter`: the host owns one instance, plugins write through their
 * scoped `ctx.cookies`, and every entry for a plugin is dropped on deactivate.
 */
export class PluginCookieRegistry {
  private readonly byPlugin = new Map<string, Map<string, CookieDeclaration>>();

  declare(pluginId: string, input: CookieDeclaration | CookieDeclaration[]): void {
    const list = Array.isArray(input) ? input : [input];
    let bucket = this.byPlugin.get(pluginId);
    if (!bucket) {
      bucket = new Map();
      this.byPlugin.set(pluginId, bucket);
    }
    for (const raw of list) {
      const parsed = CookieDeclarationSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(
          `Plugin "${pluginId}" declared an invalid cookie: ${parsed.error.issues[0]?.message ?? "bad shape"}`,
        );
      }
      bucket.set(parsed.data.name, parsed.data);
    }
  }

  removePlugin(pluginId: string): void {
    this.byPlugin.delete(pluginId);
  }

  /** Every plugin declaration, flattened and attributed. */
  all(): Array<CookieDeclaration & { declaredBy: string }> {
    const out: Array<CookieDeclaration & { declaredBy: string }> = [];
    for (const [pluginId, bucket] of this.byPlugin) {
      for (const cookie of bucket.values()) out.push({ ...cookie, declaredBy: pluginId });
    }
    return out;
  }
}
