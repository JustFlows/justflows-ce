// SPDX-License-Identifier: MIT

import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { acceptInboundMessage } from "../../lib/email/mail.js";

const router = Router();

router.post(
  "/inbound",
  rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }),
  async (req, res) => {
    const secret = process.env["JUSTFLOWS_INBOUND_MAIL_SECRET"] ?? "";
    if (!secret) {
      res.status(404).json({ error: "Inbound mail is not configured." });
      return;
    }
    const header = req.get("authorization") ?? "";
    const expected = `Bearer ${secret}`;
    const left = Buffer.from(header);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
    const from = typeof body["from"] === "string" ? body["from"].trim().toLowerCase() : "";
    const to = typeof body["to"] === "string" ? body["to"].trim().slice(0, 200) : "";
    const subject = typeof body["subject"] === "string" ? body["subject"].replace(/[\r\n]/g, " ").trim().slice(0, 200) : "";
    const text = typeof body["text"] === "string" ? body["text"].replace(/\0/g, "").slice(0, 20_000) : "";
    if (!from.includes("@") || from.length > 200 || !text.trim()) {
      res.status(400).json({ error: "Enter a sender and a message." });
      return;
    }
    await acceptInboundMessage({ from, to, subject, text });
    res.json({ ok: true });
  },
);

export default router;
