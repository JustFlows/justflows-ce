// SPDX-License-Identifier: MIT
// A plugin that tries everything the sandbox must deny (justflows-ce#270).
import { readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { COOKIE_CATEGORIES } from "@justflows/sdk";

async function attempt(fn) {
  try {
    const value = await fn();
    return { allowed: true, value: String(value).slice(0, 80) };
  } catch (error) {
    return { allowed: false, code: error && error.code ? error.code : String(error && error.message ? error.message : error).slice(0, 120) };
  }
}

const tcp = (port) => new Promise((resolve, reject) => {
  const socket = connect(port, "127.0.0.1");
  socket.on("connect", () => { socket.destroy(); resolve("connected"); });
  socket.on("error", reject);
});

export default {
  manifest: { id: "test.hostile" },
  async activate(ctx) {
    ctx.hooks.filter("test.title", (value, context) => `${value}|filtered:${context.siteHint ?? ""}`);
    ctx.hooks.gate("test.save", (event) => { if (event.block) event.cancel("blocked by plugin"); });
    ctx.http.get("/probe", async (req) => ({
      body: {
        env: Object.keys(process.env),
        secretEnv: process.env.APP_SECRET ?? null,
        dbEnv: process.env.DB_PASSWORD ?? process.env.DATABASE_URL ?? null,
        cookieHeader: req.headers.cookie ?? null,
        readEnvFile: await attempt(() => readFileSync(req.query.envFile, "utf8")),
        readPasswd: await attempt(() => readFileSync("/etc/passwd", "utf8")),
        readNeighbour: await attempt(() => readFileSync(req.query.neighbour, "utf8")),
        writeFile: await attempt(() => writeFileSync(req.query.writeTo, "x")),
        importHost: await attempt(() => import(req.query.hostModule)),
        importPackage: await attempt(() => import("pg")),
        tcpDatabase: await attempt(() => tcp(Number(req.query.port))),
        fetch: await attempt(() => fetch(`http://127.0.0.1:${req.query.port}/`)),
        dns: await attempt(async () => (await import("node:dns")).promises.lookup("example.com")),
        childProcess: await attempt(async () => (await import("node:child_process")).execSync("id").toString()),
        worker: await attempt(async () => new (await import("node:worker_threads")).Worker("1", { eval: true })),
        inspector: await attempt(async () => (await import("node:inspector")).open()),
        binding: await attempt(() => process.binding("fs")),
        ctxUsers: await attempt(() => ctx.users.find({ email: "admin@example.com" })),
        ctxDatabases: await attempt(() => ctx.databases.probe()),
      },
    }));
    ctx.http.get("/data", async (req) => {
      await ctx.data.put("notes", "n1", { text: req.query.text });
      return { body: { stored: await ctx.data.get("notes", "n1"), setting: await ctx.settings.get("greeting") } };
    });
    ctx.http.get("/loop", () => { for (;;) {} });
    ctx.http.get("/crash", () => { setTimeout(() => { throw new Error("boom"); }, 0); return new Promise(() => {}); });
    ctx.http.get("/memory", () => { const hog = []; for (;;) hog.push(new Array(1e6).fill(Math.random())); });
    ctx.http.get("/slow", () => new Promise((resolve) => setTimeout(() => resolve({ body: { ok: true } }), 300)));
    ctx.http.get("/pid", () => ({ body: { pid: process.pid, sdk: COOKIE_CATEGORIES.length } }));
  },
};
