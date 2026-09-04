// SPDX-License-Identifier: MIT

import type { PluginDiagnosticCheck, PluginDiagnosticResult } from "@justflows/sdk";
import { setTimeout as delay } from "node:timers/promises";

export interface RegisteredPluginDiagnostic extends PluginDiagnosticCheck {
  pluginId: string;
}

export class PluginDiagnosticRegistry {
  private readonly checks = new Map<string, RegisteredPluginDiagnostic>();

  register(pluginId: string, check: PluginDiagnosticCheck): () => void {
    const id = check.id.trim();
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(id)) throw new Error("Invalid diagnostic check id");
    if (!check.label.trim() || check.label.length > 100)
      throw new Error("Invalid diagnostic check label");
    const key = `${pluginId}/${id}`;
    if (this.checks.has(key)) throw new Error(`Diagnostic check "${key}" is already registered`);
    this.checks.set(key, { ...check, id, label: check.label.trim(), pluginId });
    return () => this.checks.delete(key);
  }

  list(): RegisteredPluginDiagnostic[] {
    return [...this.checks.values()];
  }

  removePlugin(pluginId: string): void {
    for (const [key, check] of this.checks)
      if (check.pluginId === pluginId) this.checks.delete(key);
  }

  async run(
    timeoutMs = 5_000,
  ): Promise<
    Array<{ pluginId: string; id: string; label: string; result: PluginDiagnosticResult }>
  > {
    return Promise.all(
      this.list().map(async (check) => {
        try {
          const result = await Promise.race([
            check.run(),
            delay(timeoutMs).then(() => {
              throw new Error("Check timed out");
            }),
          ]);
          return { pluginId: check.pluginId, id: check.id, label: check.label, result };
        } catch (error) {
          return {
            pluginId: check.pluginId,
            id: check.id,
            label: check.label,
            result: {
              status: "error" as const,
              summary: error instanceof Error ? error.message : "Check failed",
            },
          };
        }
      }),
    );
  }
}
