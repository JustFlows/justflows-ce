import { Router } from "express";
import { pbkdf2, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getDb } from "../lib/db.js";
import { clearSessionCookie, setSessionCookie } from "../lib/session.js";
import { clientIp, consumeRateLimit } from "../lib/rate-limit.js";
import { hashPassword } from "../lib/password.js";
import { getGeneralSettings } from "../lib/general-settings.js";
import { getSiteId } from "../lib/site-settings.js";
import { isInstalled } from "../middleware/install-guard.js";

const router = Router();

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const PBKDF2_ITERATIONS = 310_000;
const KEY_LEN = 32;

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 5 || parts[1] !== "pbkdf2") return false;
  const salt = parts[3]!;
  const expected = parts[4]!;

  return new Promise((resolve) => {
    pbkdf2(password, salt, PBKDF2_ITERATIONS, KEY_LEN, "sha256", (err, key) => {
      if (err) {
        resolve(false);
        return;
      }
      const a = Buffer.from(key.toString("hex"), "utf-8");
      const b = Buffer.from(expected, "utf-8");
      resolve(a.length === b.length && timingSafeEqual(a, b));
    });
  });
}

router.post("/login", async (req, res) => {
  const ip = clientIp(req);
  if (!consumeRateLimit(`login:ip:${ip}`, 20, 15 * 60 * 1000)) {
    res.status(429).json({ error: "Too many login attempts. Try again later." });
    return;
  }

  const body = LoginSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const { email, password } = body.data;
  const normalizedEmail = email.toLowerCase().trim();

  if (!consumeRateLimit(`login:email:${normalizedEmail}`, 10, 15 * 60 * 1000)) {
    res.status(429).json({ error: "Too many login attempts. Try again later." });
    return;
  }

  try {
    const db = await getDb();
    const rows = await db.query<{
      id: string;
      site_id: string;
      email: string;
      password_hash: string;
      role: string;
    }>("SELECT id, site_id, email, password_hash, role FROM users WHERE email = ? LIMIT 1", [
      normalizedEmail,
    ]);

    const user = rows[0];
    const valid = user ? await verifyPassword(password, user.password_hash) : false;

    if (!user || !valid) {
      await new Promise((r) => setTimeout(r, 300 + Math.random() * 200));
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    setSessionCookie(res, {
      userId: user.id,
      siteId: user.site_id,
      role: user.role,
      email: user.email,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("Login error", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

const RegisterSchema = z.object({
  email: z.string().email(),
  username: z.string().min(2).max(60).regex(/^[a-zA-Z0-9._-]+$/, "Username may only contain letters, numbers, dots, underscores and hyphens"),
  password: z.string().min(8),
  displayName: z.string().min(1).max(255).optional(),
});

function now(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

router.get("/registration", async (_req, res) => {
  if (!isInstalled()) {
    res.json({ enabled: false });
    return;
  }
  try {
    const general = await getGeneralSettings();
    res.json({ enabled: general.usersCanRegister, defaultRole: general.defaultRole });
  } catch {
    res.json({ enabled: false });
  }
});

router.post("/register", async (req, res) => {
  if (!isInstalled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const ip = clientIp(req);
  if (!consumeRateLimit(`register:ip:${ip}`, 8, 15 * 60 * 1000)) {
    res.status(429).json({ error: "Too many registration attempts. Try again later." });
    return;
  }

  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
    return;
  }

  const email = parsed.data.email.toLowerCase().trim();
  const username = parsed.data.username.trim();
  const displayName = (parsed.data.displayName ?? username).trim();

  if (!consumeRateLimit(`register:email:${email}`, 5, 15 * 60 * 1000)) {
    res.status(429).json({ error: "Too many registration attempts. Try again later." });
    return;
  }

  try {
    const siteId = await getSiteId();
    if (!siteId) {
      res.status(500).json({ error: "Site is not configured" });
      return;
    }

    const general = await getGeneralSettings(siteId);
    if (!general.usersCanRegister) {
      res.status(403).json({ error: "Registration is closed" });
      return;
    }

    const db = await getDb();
    const existing = await db.query<{ id: string }>(
      "SELECT id FROM users WHERE site_id = ? AND (email = ? OR username = ?) LIMIT 1",
      [siteId, email, username],
    );
    if (existing[0]) {
      res.status(409).json({ error: "That email or username is already registered" });
      return;
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const id = randomUUID();
    await db.run(
      `INSERT INTO users (id, site_id, email, username, display_name, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, siteId, email, username, displayName, passwordHash, general.defaultRole, now(), now()],
    );

    try {
      const { getRuntimeHooks } = await import("../lib/plugin-runtime.js");
      await getRuntimeHooks().dispatchAction("user.created", { userId: id }, { siteId, source: "http" });
    } catch {
      // hooks are optional during early boot
    }

    setSessionCookie(res, {
      userId: id,
      siteId,
      role: general.defaultRole,
      email,
    });

    const origin = (process.env.APP_URL ?? "").replace(/\/$/, "");
    const loginUrl = origin ? `${origin}/login` : "/login";
    void import("../lib/mail.js")
      .then(async (mail) => {
        await mail.notifyAdmin(
          "New user registration",
          `A new user registered:\n\nName: ${displayName}\nUsername: ${username}\nEmail: ${email}\nRole: ${general.defaultRole}`,
          email,
        );
        await mail.sendMail({
          to: email,
          subject: "Your account has been created",
          text: `Hi ${displayName},\n\nYour account is ready. Sign in at ${loginUrl}\n\nUsername: ${username}`,
        });
      })
      .catch((err) => console.error("Registration mail failed:", err));

    res.status(201).json({ ok: true, role: general.defaultRole });
  } catch (err) {
    console.error("Register error", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
