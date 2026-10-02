// SPDX-License-Identifier: MIT

/**
 * Capability presets for "create key for this client" and the copy-ready
 * setup snippets per MCP client. Snippets are code, not prose, so they are not
 * translated; the instructions around them are.
 */

export type AgentPreset = "editor" | "admin" | "read";
export type AgentClient = "cursor" | "claude-code" | "claude-desktop" | "claude-ai" | "chatgpt" | "vscode";

export const AGENT_CLIENTS: AgentClient[] = ["cursor", "claude-code", "claude-desktop", "claude-ai", "chatgpt", "vscode"];

/** Clients that authenticate with an API key header; the rest use OAuth. */
export const KEY_CLIENTS = new Set<AgentClient>(["cursor", "claude-code", "claude-desktop", "vscode"]);

export const CLIENT_NAMES: Record<AgentClient, string> = {
  cursor: "Cursor",
  "claude-code": "Claude Code",
  "claude-desktop": "Claude Desktop",
  "claude-ai": "claude.ai",
  chatgpt: "ChatGPT",
  vscode: "VS Code",
};

const READ_ONLY = [
  "content:read",
  "content:revisions:read",
  "media:read",
  "settings:read",
  "plugins:read",
  "themes:read",
];

/**
 * "Content editor" can write content, media, comments and menus. Menus are
 * managed with settings:manage in the management API, so the preset includes
 * it; narrow the key afterwards if menus are not needed.
 */
const CONTENT_EDITOR = [
  "content:read",
  "content:create",
  "content:update",
  "content:delete",
  "content:publish",
  "content:revisions:read",
  "media:read",
  "media:upload",
  "media:delete",
  "comments:moderate",
  "settings:read",
  "settings:manage",
];

/** The preset's capabilities, limited to what the signed-in admin can grant. */
export function presetCapabilities(preset: AgentPreset, grantable: string[]): string[] {
  const allowed = new Set(grantable);
  if (preset === "admin") return grantable.filter((capability) => capability !== "ai:use");
  return (preset === "read" ? READ_ONLY : CONTENT_EDITOR).filter((capability) => allowed.has(capability));
}

export function setupSnippet(client: AgentClient, url: string, key: string): string {
  const auth = `Bearer ${key}`;
  switch (client) {
    case "cursor":
      return JSON.stringify({ mcpServers: { justflows: { url, headers: { Authorization: auth } } } }, null, 2);
    case "vscode":
      return JSON.stringify({ servers: { justflows: { type: "http", url, headers: { Authorization: auth } } } }, null, 2);
    case "claude-code":
      return `claude mcp add --transport http justflows ${url} --header "Authorization: ${auth}"`;
    case "claude-desktop":
      return JSON.stringify(
        { mcpServers: { justflows: { command: "npx", args: ["-y", "mcp-remote", url, "--header", `Authorization: ${auth}`] } } },
        null,
        2,
      );
    case "claude-ai":
    case "chatgpt":
      return url;
  }
}

/** Where the snippet goes, shown above it. */
export const SNIPPET_FILE: Partial<Record<AgentClient, string>> = {
  cursor: ".cursor/mcp.json",
  vscode: ".vscode/mcp.json",
  "claude-desktop": "claude_desktop_config.json",
};
