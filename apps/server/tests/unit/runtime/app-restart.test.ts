import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  launchArgs,
  planAppRestart,
  requestAppRestart,
  restartHelperSource,
  type RestartMethod,
  type RestartProbe,
} from "../../../src/lib/runtime/app-restart.js";

const invocation = "a".repeat(32);

function probe(over: Partial<RestartProbe> = {}): RestartProbe {
  return {
    platform: "linux",
    env: {},
    pid: 200,
    ppid: 50,
    argv: ["/usr/bin/node", "/opt/justflows/server.js"],
    execPath: "/usr/bin/node",
    cwd: "/opt/justflows",
    cgroup: null,
    parentComm: null,
    parentCmdline: null,
    pid1Comm: "systemd",
    dockerEnvFile: false,
    containerEnvFile: false,
    passenger: false,
    worker: false,
    ...over,
  };
}

function method(over: Partial<RestartProbe>): RestartMethod {
  return planAppRestart("/opt/justflows", probe(over)).method;
}

describe("planAppRestart", () => {
  it("asks Passenger to reload on the next request", () => {
    const plan = planAppRestart("/opt/justflows", probe({ env: { PASSENGER_APP_ENV: "production" } }));
    expect(plan.method).toBe("passenger");
    expect(plan.passengerFile).toBe(path.join("/opt/justflows", "tmp", "restart.txt"));
    expect(plan.launch).toBeUndefined();
  });

  it("restarts the systemd unit that owns this process", () => {
    const plan = planAppRestart(
      "/opt/justflows",
      probe({
        env: { INVOCATION_ID: invocation },
        cgroup: "0::/system.slice/justflows.service\n",
      }),
    );
    expect(plan.method).toBe("systemd");
    expect(plan.detail).toContain("justflows.service");
    expect(launchArgs(plan.launch!)).toEqual(["systemctl", "system", "justflows.service", "200"]);
  });

  it("uses the user service manager for a user unit", () => {
    const plan = planAppRestart(
      "/opt/justflows",
      probe({
        env: { INVOCATION_ID: invocation },
        cgroup: "0::/user.slice/user-1000.slice/user@1000.service/app.slice/justflows.service\n",
      }),
    );
    expect(launchArgs(plan.launch!)).toEqual(["systemctl", "user", "justflows.service", "200"]);
  });

  it("does not restart a shared web server, or a unit name that is not a service", () => {
    const apache = planAppRestart(
      "/opt/justflows",
      probe({
        env: { INVOCATION_ID: invocation },
        cgroup: "0::/system.slice/httpd.service\n",
      }),
    );
    expect(apache.ok).toBe(false);
    expect(apache.launch).toBeUndefined();

    const evil = planAppRestart(
      "/opt/justflows",
      probe({
        env: { INVOCATION_ID: invocation },
        cgroup: "0::/system.slice/justflows.service;reboot.service\n",
      }),
    );
    expect(evil.ok).toBe(false);
    expect(evil.launch).toBeUndefined();
  });

  it("prefers PM2 when the systemd unit is PM2 itself", () => {
    const plan = planAppRestart(
      "/opt/justflows",
      probe({
        env: { INVOCATION_ID: invocation, pm_id: "3", name: "justflows" },
        cgroup: "0::/system.slice/pm2.service\n",
      }),
    );
    expect(plan.method).toBe("pm2");
    expect(launchArgs(plan.launch!)).toEqual(["spawn", "/opt/justflows", "200", "pm2", "restart", "justflows"]);
  });

  it("falls back to the PM2 id when the app name is not a single token", () => {
    const plan = planAppRestart("/opt/justflows", probe({ env: { pm_id: "4", name: "my app" } }));
    expect(launchArgs(plan.launch!)).toEqual(["spawn", "/opt/justflows", "200", "pm2", "restart", "4"]);
  });

  it.each([
    [{ dockerEnvFile: true }, "container"],
    [{ containerEnvFile: true }, "container"],
    [{ parentComm: "tini" }, "container"],
    [{ pid1Comm: "dumb-init" }, "container"],
    [{ env: { KUBERNETES_SERVICE_HOST: "10.0.0.1", container: "docker" }, dockerEnvFile: true }, "kubernetes"],
    [{ env: { DYNO: "web.1" } }, "heroku"],
    [{ env: { FLY_APP_NAME: "justflows" } }, "fly"],
    [{ env: { RENDER_SERVICE_ID: "srv-1" } }, "render"],
    [{ env: { RAILWAY_SERVICE_ID: "rail-1" } }, "railway"],
    [{ env: { NOMAD_ALLOC_ID: "alloc-1" } }, "nomad"],
    [{ env: { ECS_CONTAINER_METADATA_URI: "http://169.254.170.2" } }, "ecs"],
    [{ env: { K_SERVICE: "justflows" } }, "cloudrun"],
  ] as const)("stops the main process for %j", (over, expected) => {
    expect(method(over)).toBe(expected);
  });

  it("stops a container whose main process is pid 1", () => {
    const plan = planAppRestart("/opt/justflows", probe({ pid: 1, ppid: 0, dockerEnvFile: true }));
    expect(plan.launch).toEqual({ action: "stop-main", pid: 1 });
  });

  it.each([
    [{ parentComm: "nodemon" }, "nodemon"],
    [{ parentCmdline: "/usr/bin/node\0/usr/bin/forever.js\0server.js" }, "forever"],
    [{ parentComm: "supervisord", env: { SUPERVISOR_PROCESS_NAME: "web:app" } }, "supervisord"],
    [{ env: { RC_SVCNAME: "justflows" } }, "openrc"],
    [{ parentComm: "s6-supervise" }, "s6"],
    [{ parentComm: "runsv" }, "runit"],
    [{ parentComm: "supervise" }, "daemontools"],
    [{ platform: "darwin" as const, ppid: 1 }, "launchd"],
    [{ parentComm: "nssm.exe" }, "windows-service"],
    [{ parentComm: "WinSW.exe" }, "windows-service"],
    [{ ppid: 1 }, "init"],
  ] as const)("detects %j", (over, expected) => {
    expect(method(over)).toBe(expected);
  });

  it("asks supervisord and OpenRC to restart their own service", () => {
    const supervisor = planAppRestart(
      "/opt/justflows",
      probe({ parentComm: "supervisord", env: { SUPERVISOR_PROCESS_NAME: "web:app" } }),
    );
    expect(launchArgs(supervisor.launch!)).toEqual([
      "spawn",
      "/opt/justflows",
      "200",
      "supervisorctl",
      "restart",
      "web:app",
    ]);

    const openrc = planAppRestart("/opt/justflows", probe({ env: { RC_SVCNAME: "justflows" } }));
    expect(launchArgs(openrc.launch!)).toEqual(["spawn", "/opt/justflows", "200", "rc-service", "justflows", "restart"]);
  });

  it("signals nodemon, and from the update worker signals the server instead", () => {
    const dev = planAppRestart("/opt/justflows", probe({ parentComm: "nodemon", ppid: 40 }));
    expect(dev.launch).toEqual({ action: "signal", pid: 40, signal: "SIGUSR2" });

    const worker = planAppRestart(
      "/opt/justflows",
      probe({
        worker: true,
        ppid: 80,
        parentComm: "nodemon",
        argv: ["/usr/bin/node", "/opt/justflows/core-update-worker.js"],
      }),
    );
    expect(worker.launch).toEqual({ action: "signal", pid: 80, signal: "SIGTERM" });
  });

  it("starts the same server command again when nothing is supervising it", () => {
    const plan = planAppRestart("/opt/justflows", probe());
    expect(plan.method).toBe("reexec");
    expect(launchArgs(plan.launch!)).toEqual([
      "reexec",
      "/opt/justflows",
      "200",
      "/usr/bin/node",
      "/opt/justflows/server.js",
    ]);
  });

  it("restarts the server from the update worker, not the worker script", () => {
    const plan = planAppRestart(
      "/opt/justflows",
      probe({
        worker: true,
        ppid: 80,
        argv: ["/usr/bin/node", "/opt/justflows/apps/server/dist/lib/updates/core-update-worker.js"],
        parentCmdline: "/usr/bin/node\0/opt/justflows/server.js\0",
      }),
    );
    expect(plan.method).toBe("reexec");
    expect(launchArgs(plan.launch!)).toEqual(["reexec", "/opt/justflows", "80", "/usr/bin/node", "/opt/justflows/server.js"]);
  });

  it("refuses a restart command that climbs out of its directory", () => {
    const plan = planAppRestart("/opt/justflows", probe({ execPath: "/usr/bin/../bin/node" }));
    expect(plan.ok).toBe(false);
    expect(plan.launch).toBeUndefined();
  });

  it("does not signal pid 1 from an update worker that has been reparented", () => {
    const plan = planAppRestart(
      "/opt/justflows",
      probe({
        worker: true,
        ppid: 1,
        env: { INVOCATION_ID: invocation },
        cgroup: "0::/system.slice/justflows.service\n",
      }),
    );
    expect(plan.ok).toBe(false);
    expect(plan.launch).toBeUndefined();
  });
});

describe("requestAppRestart", () => {
  it("writes the Passenger restart file and does not spawn a helper", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "jf-restart-"));
    const launched: string[][] = [];
    const result = await requestAppRestart(root, {
      probe: probe({ passenger: true }),
      launch: (args) => {
        launched.push(args);
        return true;
      },
    });
    expect(result.ok).toBe(true);
    expect(result.method).toBe("passenger");
    expect(result.detail).toBe("Site will reload on the next request");
    expect(launched).toEqual([]);
    const body = fs.readFileSync(path.join(root, "tmp", "restart.txt"), "utf8");
    expect(body.trim()).toMatch(/^\d+$/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("schedules a systemd restart", async () => {
    const launched: string[][] = [];
    const result = await requestAppRestart("/opt/justflows", {
      probe: probe({
        env: { INVOCATION_ID: invocation },
        cgroup: "0::/system.slice/justflows.service\n",
      }),
      launch: (args) => {
        launched.push(args);
        return true;
      },
    });
    expect(result.ok).toBe(true);
    expect(result.detail).toBe("systemd will restart justflows.service");
    expect(launched).toEqual([["systemctl", "system", "justflows.service", "200"]]);
  });

  it("reports failure when the helper cannot be started", async () => {
    const result = await requestAppRestart("/opt/justflows", {
      probe: probe({ env: { INVOCATION_ID: invocation }, cgroup: "0::/system.slice/justflows.service\n" }),
      launch: () => false,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Could not trigger restart");
  });
});

describe("restart helper", () => {
  it("is valid JavaScript and refuses to signal pid 1 or a unit that is not a service name", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jf-restart-helper-"));
    const file = path.join(dir, "helper.js");
    fs.writeFileSync(file, restartHelperSource, { mode: 0o600 });
    const checked = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    fs.rmSync(dir, { recursive: true, force: true });
    expect(checked.status).toBe(0);

    const refused = spawnSync(process.execPath, ["-e", restartHelperSource, "--", "signal", "1", "SIGTERM"], {
      encoding: "utf8",
      timeout: 2000,
    });
    expect(refused.status).toBe(0);

    const badUnit = spawnSync(
      process.execPath,
      ["-e", restartHelperSource, "--", "systemctl", "system", "justflows.service;reboot", "200"],
      { encoding: "utf8", timeout: 2000 },
    );
    expect(badUnit.status).toBe(0);
  });
});
