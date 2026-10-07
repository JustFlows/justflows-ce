// SPDX-License-Identifier: MIT

import type { PluginPermission, PluginQuotasApi, QuotaMeterView } from "@justflows/sdk";
import {
  checkQuota,
  listMeterDefinitions,
  registerPluginMeter,
  scopeIdForMeter,
  setQuotaLimit,
  type QuotaMeterDefinition,
} from "../tenancy/quotas.js";

export function createPluginQuotasApi(
  pluginId: string,
  permissions: ReadonlySet<PluginPermission>,
  siteId: string,
): PluginQuotasApi {
  async function meterFor(key: string): Promise<{ meter: QuotaMeterDefinition; scopeId: string }> {
    const meter = listMeterDefinitions().find((item) => item.key === key);
    if (!meter) throw new Error(`Unknown quota meter "${key}".`);
    return { meter, scopeId: await scopeIdForMeter(meter, siteId) };
  }

  return {
    register: (registration) => registerPluginMeter(pluginId, registration),
    async check(key, input) {
      const { scopeId } = await meterFor(key);
      return checkQuota(key, scopeId, input);
    },
    async get(key): Promise<QuotaMeterView> {
      const { meter, scopeId } = await meterFor(key);
      const decision = await checkQuota(key, scopeId, meter.owner === "core" || meter.count ? { delta: 0 } : { delta: 0, used: 0 });
      return {
        key: meter.key,
        scope: meter.scope,
        label: meter.label,
        unit: meter.unit,
        limit: decision.limit,
        used: meter.owner === "core" || meter.count ? decision.used : null,
      };
    },
    async set(key, limit) {
      if (!permissions.has("platform:tenancy")) {
        throw new Error(`Plugin "${pluginId}" requires the "platform:tenancy" permission`);
      }
      const { meter, scopeId } = await meterFor(key);
      await setQuotaLimit(meter.scope, scopeId, key, limit, null);
    },
  };
}
