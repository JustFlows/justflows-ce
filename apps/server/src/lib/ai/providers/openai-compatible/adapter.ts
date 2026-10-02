// SPDX-License-Identifier: MIT

import type { ProviderAdapter } from "../types.js";
import { listOpenAiModels, streamChatCompletions } from "../openai/chat-completions.js";

/**
 * Any endpoint that speaks the OpenAI Chat Completions format at a custom base
 * URL: OpenRouter, Azure OpenAI (v1 API), Mistral, Groq, and local runtimes
 * such as Ollama (`http://localhost:11434/v1`) or LM Studio. Local addresses
 * need `ai_allow_private_endpoints`. Model listing is best effort: some
 * servers do not implement `/models`, so an empty list is not an error.
 */
export const openAiCompatibleAdapter: ProviderAdapter = {
  id: "openai-compatible",
  label: "OpenAI-compatible",
  defaultBaseUrl: null,
  async listModels(config) {
    return listOpenAiModels(config, null);
  },
  chat(config, request) {
    return streamChatCompletions(config, request, null);
  },
};
