// SPDX-License-Identifier: MIT

import { Router, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "../../lib/ai/mcp/mcp-server.js";
import { clientIp } from "../../lib/security/rate-limit.js";
import { logSafe } from "../../lib/security/log-safe.js";
import { mcpAuth, mcpEnabledGuard, mcpRateLimit } from "../../middleware/mcp-auth.js";

/**
 * `/api/mcp` — the Model Context Protocol endpoint (#159), Streamable HTTP
 * transport in stateless mode: every POST carries its own credential and gets a
 * fresh server built for that principal, so a revoked key, grant or role takes
 * effect on the very next message. There is no server-initiated stream, so GET
 * and DELETE answer 405 as the transport spec allows.
 */
const router = Router();

function methodNotAllowed(_req: Request, res: Response): void {
  res.setHeader("Allow", "POST");
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
}

router.post("/", mcpEnabledGuard, mcpAuth, ...mcpRateLimit, async (req: Request, res: Response) => {
  const principal = req.agentPrincipal!;
  const server = createMcpServer(principal, { ip: clientIp(req), userAgent: req.get("user-agent") ?? undefined });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[justflows] mcp request failed", JSON.stringify(logSafe(String(err))));
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    }
  }
});

router.get("/", mcpEnabledGuard, methodNotAllowed);
router.delete("/", mcpEnabledGuard, methodNotAllowed);

export default router;
