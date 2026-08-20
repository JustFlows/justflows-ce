// SPDX-License-Identifier: MIT

import type { Request, Response, NextFunction } from "express";

export async function dispatchPluginHttp(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { ensurePluginRuntime, getPluginLoader } = await import("./plugin-runtime.js");
  await ensurePluginRuntime();
  const loader = getPluginLoader();
  if (!loader) {
    next();
    return;
  }

  const method = req.method === "POST" ? "POST" : req.method === "GET" ? "GET" : null;
  if (!method) {
    next();
    return;
  }

  const match = loader.httpRouter.match(method, req.path);
  if (!match) {
    next();
    return;
  }

  try {
    const query: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === "string") query[key] = value;
    }
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers[key] = value;
    }

    const result = await match.handler({
      method,
      path: req.path,
      query,
      body: req.body,
      headers,
    });

    res.status(result.status ?? 200);
    if (result.headers) {
      for (const [key, value] of Object.entries(result.headers)) res.setHeader(key, value);
    }
    if (result.type) res.type(result.type);
    if (Buffer.isBuffer(result.body) || typeof result.body === "string") {
      res.send(result.body);
      return;
    }
    if (result.body !== undefined) {
      res.json(result.body);
      return;
    }
    res.end();
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}
