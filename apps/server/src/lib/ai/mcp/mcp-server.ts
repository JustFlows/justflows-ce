// SPDX-License-Identifier: MIT

import { readFile } from "node:fs/promises";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getJustflowsVersion } from "../../runtime/version.js";
import { getJfRoot } from "../../runtime/jf-root.js";
import { resolvePathUnderBase } from "../../security/safe-path.js";
import { listContentTypes } from "../../content/content-types-db.js";
import { keyCan } from "../../auth/api-keys.js";
import { callTool, outcomeText, toolsForPrincipal } from "../tools/registry.js";
import type { AgentPrincipal } from "../tools/principal.js";
import { AUTHORING_GUIDE, MCP_INSTRUCTIONS, PROMPTS } from "./mcp-content.js";

/**
 * One MCP server per request (the transport runs stateless), built for the
 * authenticated principal: `tools/list` shows only what it can do right now,
 * and `tools/call` goes through the shared registry, which re-checks.
 */

const BLOCKS_URI = "justflows://docs/blocks";
const AUTHORING_URI = "justflows://docs/authoring";
const TYPE_URI_PREFIX = "justflows://content-types/";

async function readBlocksDoc(): Promise<string> {
  const file = resolvePathUnderBase(getJfRoot(), "docs", "BLOCKS.md");
  if (!file) return "Block documentation is not available on this install.";
  try {
    return await readFile(file, "utf8");
  } catch {
    return "Block documentation is not available on this install. Use the blocks_catalog tool.";
  }
}

export function createMcpServer(principal: AgentPrincipal, meta: { ip?: string; userAgent?: string }): Server {
  const server = new Server(
    { name: "justflows", title: "Justflows", version: getJustflowsVersion() },
    {
      capabilities: { tools: { listChanged: false }, resources: {}, prompts: {} },
      instructions: MCP_INSTRUCTIONS,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = await toolsForPrincipal(principal);
    return {
      tools: tools.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { title: tool.title, ...tool.annotations },
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await callTool(principal, request.params.name, request.params.arguments ?? {}, meta);
    return {
      content: [{ type: "text" as const, text: outcomeText(result.outcome) }],
      isError: !result.outcome.ok,
    };
  });

  const canRead = () => keyCan(principal.key, principal.owner, "content:read");

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    if (!(await canRead())) return { resources: [] };
    const types = await listContentTypes(principal.owner.siteId);
    return {
      resources: [
        { uri: AUTHORING_URI, name: "authoring-guide", title: "Authoring guide", mimeType: "text/markdown", description: "How to build valid Justflows content: blocks, drafts, versions, media." },
        { uri: BLOCKS_URI, name: "blocks", title: "Blocks reference", mimeType: "text/markdown", description: "docs/BLOCKS.md — block props, platform props, styling." },
        ...types.map((type) => ({
          uri: `${TYPE_URI_PREFIX}${type.slug}`,
          name: `content-type-${type.slug}`,
          title: `${type.label} fields`,
          mimeType: "application/json",
          description: `Field schema of the "${type.slug}" content type.`,
        })),
      ],
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    if (!(await canRead())) throw new McpError(ErrorCode.InvalidParams, "Resource not found");
    if (uri === AUTHORING_URI) return { contents: [{ uri, mimeType: "text/markdown", text: AUTHORING_GUIDE }] };
    if (uri === BLOCKS_URI) return { contents: [{ uri, mimeType: "text/markdown", text: await readBlocksDoc() }] };
    if (uri.startsWith(TYPE_URI_PREFIX)) {
      const slug = uri.slice(TYPE_URI_PREFIX.length);
      const type = (await listContentTypes(principal.owner.siteId)).find((item) => item.slug === slug);
      if (type) {
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify({ slug: type.slug, label: type.label, description: type.description, fields: type.fields }, null, 1),
            },
          ],
        };
      }
    }
    throw new McpError(ErrorCode.InvalidParams, "Resource not found");
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: PROMPTS.map(({ name, title, description, arguments: args }) => ({ name, title, description, arguments: args })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const prompt = PROMPTS.find((item) => item.name === request.params.name);
    if (!prompt) throw new McpError(ErrorCode.InvalidParams, "Prompt not found");
    const args = request.params.arguments ?? {};
    for (const arg of prompt.arguments) {
      if (arg.required && !args[arg.name]) throw new McpError(ErrorCode.InvalidParams, `Missing argument: ${arg.name}`);
    }
    return {
      description: prompt.description,
      messages: [{ role: "user" as const, content: { type: "text" as const, text: prompt.render(args) } }],
    };
  });

  return server;
}
