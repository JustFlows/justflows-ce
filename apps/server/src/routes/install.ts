import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { markInstalled } from "../lib/install-state.js";
import { resetDb } from "../lib/db.js";
import { runAllMigrations } from "../lib/run-migrations.js";
import { isInstalled } from "../middleware/install-guard.js";
import { hashPassword } from "../lib/password.js";

const router = Router();

const Schema = z.object({
  db: z.object({
    driver: z.enum(["postgres", "mysql", "mariadb"]),
    host: z.string().min(1),
    port: z.coerce.number().int().min(1).max(65535),
    database: z.string().min(1),
    username: z.string().min(1),
    password: z.string(),
  }),
  site: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    url: z.string().min(1),
  }),
  account: z.object({
    email: z.string().email(),
    username: z.string().min(2).max(60),
    displayName: z.string().min(1),
    password: z.string().min(8),
  }),
});

function sseEvent(type: "step" | "done" | "error", message: string): string {
  return `data: ${JSON.stringify({ type, message })}\n\n`;
}

function now(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

interface DbClient {
  run(sql: string, params?: (string | number | boolean | null)[]): Promise<void>;
  close(): Promise<void>;
}

async function connectDb(driver: "postgres" | "mysql" | "mariadb", url: string): Promise<DbClient> {
  if (driver === "postgres") {
    const { default: postgres } = await import("postgres");
    const sql = postgres(url, { max: 1, connect_timeout: 8 });
    await sql`SELECT 1`;
    return {
      run: async (query, params = []) => {
        let i = 0;
        const pgQuery = query.replace(/\?/g, () => `$${++i}`);
        await sql.unsafe(pgQuery, params as Parameters<typeof sql.unsafe>[1]);
      },
      close: () => sql.end(),
    };
  }

  const mysql = await import("mysql2/promise");
  const parsed = new URL(url);
  const conn = await mysql.createConnection({
    host: parsed.hostname,
    port: Number(parsed.port || 3306),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.slice(1),
    connectTimeout: 8000,
  });
  await conn.query("SELECT 1");
  return {
    run: async (query, params = []) => {
      await conn.execute(query, params as (string | number | boolean | null)[]);
    },
    close: async () => conn.end(),
  };
}

router.get("/status", (_req, res) => {
  res.json({ installed: isInstalled() });
});

router.get("/complete", (_req, res) => {
  if (!isInstalled()) {
    res.status(400).json({ error: "Not installed" });
    return;
  }
  res.cookie("jf_installed", "1", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 365 * 24 * 60 * 60 * 1000 });
  res.json({ ok: true });
});

router.post("/", async (req, res) => {
  if (isInstalled()) {
    res.setHeader("Content-Type", "text/event-stream");
    res.write(sseEvent("error", "Already installed"));
    res.end();
    return;
  }

  const body = Schema.safeParse(req.body);
  if (!body.success) {
    const msg = body.error.issues[0]?.message ?? "Invalid input";
    res.setHeader("Content-Type", "text/event-stream");
    res.write(sseEvent("error", msg));
    res.end();
    return;
  }

  const { db, site, account } = body.data;
  const encodedUser = encodeURIComponent(db.username);
  const encodedPass = encodeURIComponent(db.password);
  const dbUrl = `${db.driver}://${encodedUser}:${encodedPass}@${db.host}:${db.port}/${db.database}`;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const emit = (type: "step" | "done" | "error", message: string) => {
    res.write(sseEvent(type, message));
  };

  try {
    emit("step", "Connecting to database…");
    let sql: DbClient;
    try {
      sql = await connectDb(db.driver, dbUrl);
    } catch (e) {
      emit(
        "error",
        `Cannot connect to ${db.driver} at ${db.host}:${db.port}. Check the hostname, port, username and password. (${String(e)})`,
      );
      res.end();
      return;
    }

    emit("step", "Setting up database tables…");
    try {
      await runAllMigrations(sql, db.driver);
    } catch (e) {
      emit("error", `Migration failed: ${String(e)}`);
      res.end();
      return;
    }

    emit("step", "Creating your site…");
    const siteId = randomUUID();
    try {
      await sql.run(
        `INSERT INTO sites (id, name, url, description, active, installed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [siteId, site.name, site.url, site.description ?? null, true, now(), now(), now()],
      );
    } catch (e) {
      emit("error", `Could not create site record: ${String(e)}`);
      res.end();
      return;
    }

    emit("step", "Creating admin account…");
    const passwordHash = await hashPassword(account.password);
    const userId = randomUUID();
    try {
      await sql.run(
        `INSERT INTO users (id, site_id, email, username, display_name, password_hash, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          siteId,
          account.email,
          account.username,
          account.displayName,
          passwordHash,
          "administrator",
          now(),
          now(),
        ],
      );
    } catch (e) {
      emit("error", `Could not create admin account: ${String(e)}`);
      res.end();
      return;
    }

    emit("step", "Saving site settings…");
    const defaultSettings: [string, unknown][] = [
      ["active_theme", "justflows.default"],
      ["posts_per_page", 10],
      ["timezone", "UTC"],
      ["site_public", false],
      ["discourage_search_engines", false],
      ["admin_email", account.email],
      ["users_can_register", false],
      ["default_role", "subscriber"],
      ["date_format", "F j, Y"],
      ["time_format", "g:i a"],
      ["start_of_week", 1],
    ];
    for (const [key, value] of defaultSettings) {
      await sql
        .run(
          `INSERT INTO site_settings (id, site_id, key, value, updated_at) VALUES (?, ?, ?, ?, ?)`,
          [randomUUID(), siteId, key, JSON.stringify(value), now()],
        )
        .catch(() => null);
    }

    emit("step", "Setting up languages…");
    const langId = randomUUID();
    const isDefault = db.driver === "postgres" ? true : 1;
    try {
      await sql.run(
        `INSERT INTO languages (id, site_id, code, name, native_name, is_default, is_active, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [langId, siteId, "en", "English", "English", isDefault, isDefault, 0, now(), now()],
      );
    } catch (e) {
      emit("error", `Could not seed default language: ${String(e)}`);
      res.end();
      return;
    }

    emit("step", "Finalising installation…");
    const { randomBytes } = await import("node:crypto");
    await markInstalled({
      installedAt: new Date().toISOString(),
      siteId,
      dbDriver: db.driver,
      dbHost: db.host,
      dbPort: db.port,
      dbName: db.database,
      dbUser: db.username,
      dbPassword: db.password,
      appUrl: site.url,
      appSecret: randomBytes(48).toString("hex"),
      version: "0.1.1",
    });

    resetDb();
    await sql.close();
    emit("done", "Justflows installed successfully");
  } catch (err) {
    emit("error", `Unexpected error: ${String(err)}`);
  } finally {
    res.end();
  }
});

export default router;
