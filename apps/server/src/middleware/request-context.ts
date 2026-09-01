// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from "express";
import { createRequestId, runWithRequestId } from "../lib/diagnostics.js";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const requestId = createRequestId(req.get("x-request-id"));
  req.requestId = requestId;
  res.setHeader("X-Request-ID", requestId);
  runWithRequestId(requestId, next);
}
