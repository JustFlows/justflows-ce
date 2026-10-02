// SPDX-License-Identifier: MIT

import type { ProviderAdapter } from "../types.js";
import { listOpenAiModels, streamChatCompletions } from "./chat-completions.js";

/** OpenAI (GPT models) through the Chat Completions API. */

const DEFAULT_BASE = "https://api.openai.com/v1";

/** OpenAI lists embedding, audio and image models too; offer only chat models. */
function isChatModel(id: string): boolean {
  return /^(gpt-|o\d|chatgpt-)/.test(id) && !/(audio|realtime|transcribe|tts|image|embedding|search)/.test(id);
}

export const openAiAdapter: ProviderAdapter = {
  id: "openai",
  label: "OpenAI",
  defaultBaseUrl: DEFAULT_BASE,
  async listModels(config) {
    return (await listOpenAiModels(config, DEFAULT_BASE)).filter(isChatModel);
  },
  chat(config, request) {
    return streamChatCompletions(config, request, DEFAULT_BASE);
  },
};
