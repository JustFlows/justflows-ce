// SPDX-License-Identifier: MIT

import { anthropicAdapter } from "./anthropic/adapter.js";
import { openAiAdapter } from "./openai/adapter.js";
import { openAiCompatibleAdapter } from "./openai-compatible/adapter.js";
import type { ProviderAdapter, ProviderId } from "./types.js";

/** Registered provider adapters, one folder each. */
const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  anthropic: anthropicAdapter,
  openai: openAiAdapter,
  "openai-compatible": openAiCompatibleAdapter,
};

export function getProviderAdapter(id: ProviderId): ProviderAdapter {
  return ADAPTERS[id];
}

export function listProviderAdapters(): ProviderAdapter[] {
  return Object.values(ADAPTERS);
}

export * from "./types.js";
