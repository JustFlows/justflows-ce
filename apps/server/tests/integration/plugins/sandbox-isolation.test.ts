// SPDX-License-Identifier: MIT

import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SandboxError, SandboxProcess, sandboxSupported, type SandboxRegistration } from "../../../src/lib/plugins/sandbox/sandbox-host.js";

/**
 * The plugin sandbox against a hostile plugin (justflows-ce#270). Every
 * attempt to reach secrets, files, the database, the network, processes,
 * other plugins, or host code must be denied by the process boundary, and a
 * runaway or crashing plugin must stay within its limits.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, "../../fixtures/sandbox");
const hostileDir = path.join(fixtures, "hostile");
const neighbourSecret = path.join(fixtures, "neighbour", "secret.txt");
const hostModule = path.resolve(here, "../../../src/lib/database/db.ts");
const site = new AsyncLocalStorage<string>();

let listener: net.Server;
let port = 0;
let connections = 0;
let writeTarget = "";

beforeAll(async () => {
  process.env.APP_SECRET ||= "host-secret-that-must-not-leak-0123456789";
  listener = net.createServer((socket) => {
    connections += 1;
    socket.end("HTTP/1.1 200 OK\r\n\r\n");
  });
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  port = (listener.address() as net.AddressInfo).port;
  writeTarget = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "jf-sandbox-")), "planted.txt");
});

afterAll(() => new Promise<void>((resolve) => listener.close(() => resolve())));

function sandbox(siteId: string, calls: Array<{ op: string; args: unknown[]; site: string | undefined }> = [], limits = {}) {
  return new SandboxProcess(
    {
      pluginId: "test.hostile",
      version: "1.0.0",
      siteId,
      pluginDir: hostileDir,
      entry: path.join(hostileDir, "index.js"),
      permissions: [],
      runtime: { justflows: "test" },
      cacheEnabled: false,
      httpBase: "/api/plugins/test.hostile",
      limits: { routeTimeoutMs: 1_500, ...limits },
    },
    async (op, args) => {
      calls.push({ op, args, site: site.getStore() });
      if (op === "settings.get") return `hello from ${site.getStore()}`;
      if (op === "data.get") return { id: args[1], data: { stored: true } };
      return null;
    },
  );
}

function routeId(registrations: SandboxRegistration[], route: string): number {
  const found = registrations.find((item) => item.type === "route" && item.name === route);
  if (!found) throw new Error(`no route ${route}`);
  return found.handlerId;
}

const enabled = sandboxSupported();

describe.skipIf(!enabled)("plugin sandbox isolation", () => {
  it("denies secrets, files, the database, the network, processes, other plugins, and host code", async () => {
    const box = sandbox("site-a");
    const registrations = await box.start();
    const response = (await box.invoke("route", routeId(registrations, "/probe"), [
      {
        method: "GET",
        path: "/probe",
        headers: {},
        query: {
          envFile: path.resolve(here, "../../../../../.env"),
          neighbour: neighbourSecret,
          writeTo: writeTarget,
          hostModule,
          port: String(port),
        },
      },
    ])) as { body: Record<string, any> };
    const probe = response.body;
    expect(probe.secretEnv).toBeNull();
    expect(probe.dbEnv).toBeNull();
    expect(probe.env.filter((key: string) => key !== "__CF_USER_TEXT_ENCODING")).toEqual(["NODE_ENV"]);
    for (const key of ["readEnvFile", "readPasswd", "readNeighbour", "writeFile", "importHost", "importPackage", "tcpDatabase", "fetch", "dns", "childProcess", "worker", "inspector", "binding", "ctxUsers", "ctxDatabases"]) {
      expect(probe[key], key).toMatchObject({ allowed: false });
    }
    expect(fs.existsSync(writeTarget)).toBe(false);
    expect(connections).toBe(0);
    box.stop();
  });

  it("brokers ctx calls in the request that invoked the handler, for that site only", async () => {
    const calls: Array<{ op: string; args: unknown[]; site: string | undefined }> = [];
    const box = sandbox("site-a", calls);
    const registrations = await box.start();
    const response = (await site.run("site-a", () =>
      box.invoke("route", routeId(registrations, "/data"), [{ method: "GET", path: "/data", headers: {}, query: { text: "hi" } }]),
    )) as { body: Record<string, unknown> };
    expect(response.body).toEqual({ stored: { id: "n1", data: { stored: true } }, setting: "hello from site-a" });
    expect(calls.map((call) => [call.op, call.site])).toEqual([
      ["data.put", "site-a"],
      ["data.get", "site-a"],
      ["settings.get", "site-a"],
    ]);
    box.stop();
  });

  it("runs filters and gates and imports the SDK", async () => {
    const box = sandbox("site-a");
    const registrations = await box.start();
    const filter = registrations.find((item) => item.kind === "filter")!;
    const gate = registrations.find((item) => item.kind === "gate")!;
    expect(await box.invoke("filter", filter.handlerId, ["Title", { siteHint: "a" }, {}])).toBe("Title|filtered:a");
    expect(await box.invoke("gate", gate.handlerId, [{ block: true }, {}])).toEqual({ cancelled: "blocked by plugin" });
    expect(await box.invoke("gate", gate.handlerId, [{ block: false }, {}])).toEqual({ cancelled: null });
    expect(((await box.invoke("route", routeId(registrations, "/pid"), [{}])) as { body: { sdk: number } }).body.sdk).toBe(4);
    box.stop();
  });

  it("gives each site its own process", async () => {
    const a = sandbox("site-a");
    const b = sandbox("site-b");
    const [ra, rb] = await Promise.all([a.start(), b.start()]);
    const pidA = ((await a.invoke("route", routeId(ra, "/pid"), [{}])) as { body: { pid: number } }).body.pid;
    const pidB = ((await b.invoke("route", routeId(rb, "/pid"), [{}])) as { body: { pid: number } }).body.pid;
    expect(pidA).not.toBe(pidB);
    expect(pidA).not.toBe(process.pid);
    a.stop();
    b.stop();
  });

  it("stops a runaway handler at its time limit and starts fresh for the next call", async () => {
    const box = sandbox("site-a");
    const registrations = await box.start();
    const firstPid = box.pid;
    const started = Date.now();
    await expect(box.invoke("route", routeId(registrations, "/loop"), [{}])).rejects.toMatchObject({ code: "timeout" });
    expect(Date.now() - started).toBeLessThan(5_000);
    const again = (await box.invoke("route", routeId(await box.start(), "/pid"), [{}])) as { body: { pid: number } };
    expect(again.body.pid).not.toBe(firstPid);
    box.stop();
  });

  it("contains a crash and a memory bomb without affecting the host", async () => {
    const box = sandbox("site-a", [], { memoryMb: 32, routeTimeoutMs: 10_000 });
    const registrations = await box.start();
    await expect(box.invoke("route", routeId(registrations, "/crash"), [{}])).rejects.toBeInstanceOf(SandboxError);
    await expect(box.invoke("route", routeId(await box.start(), "/memory"), [{}])).rejects.toBeInstanceOf(SandboxError);
    const after = (await box.invoke("route", routeId(await box.start(), "/pid"), [{}])) as { body: { pid: number } };
    expect(after.body.pid).toBeGreaterThan(0);
    box.stop();
  }, 30_000);

  it("refuses more concurrent calls than its limit, and stops a plugin that keeps failing", async () => {
    const box = sandbox("site-a", [], { maxInFlight: 2, maxCrashes: 2, routeTimeoutMs: 800 });
    const registrations = await box.start();
    const slow = routeId(registrations, "/slow");
    const running = [box.invoke("route", slow, [{}]), box.invoke("route", slow, [{}])];
    await expect(box.invoke("route", slow, [{}])).rejects.toMatchObject({ code: "busy" });
    await Promise.all(running);
    await expect(box.invoke("route", routeId(registrations, "/loop"), [{}])).rejects.toMatchObject({ code: "timeout" });
    await expect(box.invoke("route", routeId(await box.start(), "/loop"), [{}])).rejects.toMatchObject({ code: "timeout" });
    expect(box.isStopped).toBe(true);
    await expect(box.start()).rejects.toMatchObject({ code: "stopped" });
  }, 20_000);
});

describe.skipIf(enabled)("plugin sandbox on an older Node", () => {
  it("reports that sandboxing is unavailable", () => {
    expect(sandboxSupported()).toBe(false);
  });
});
