// SPDX-License-Identifier: MIT

import { execFile, spawn } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";

/**
 * Ask whatever is running Justflows to start it again.
 *
 * Passenger (Plesk, cPanel) reloads when `tmp/restart.txt` changes. Everywhere
 * else a detached helper waits until this request has finished writing its
 * result, then restarts the supervisor. The helper is separate so an update
 * worker can exit — and flush the update log — before the app is stopped.
 *
 * The helper never restarts a shared web server (Apache, nginx, LiteSpeed)
 * and never signals pid 1 except to stop a container whose main process is
 * pid 1.
 */

export type RestartMethod =
  | "passenger"
  | "systemd"
  | "pm2"
  | "nodemon"
  | "forever"
  | "supervisord"
  | "openrc"
  | "s6"
  | "runit"
  | "daemontools"
  | "launchd"
  | "container"
  | "kubernetes"
  | "heroku"
  | "fly"
  | "render"
  | "railway"
  | "nomad"
  | "ecs"
  | "cloudrun"
  | "windows-service"
  | "init"
  | "reexec";

export type AppRestartResult = {
  ok: boolean;
  method: RestartMethod;
  /** Passenger restart file, or the supervisor target (unit, app name). */
  path: string;
  detail: string;
  error?: string;
};

export type RestartProbe = {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  pid: number;
  ppid: number;
  argv: readonly string[];
  execPath: string;
  cwd: string;
  cgroup: string | null;
  parentComm: string | null;
  parentCmdline: string | null;
  pid1Comm: string | null;
  dockerEnvFile: boolean;
  containerEnvFile: boolean;
  /** Same signals as `isPassenger()` in server.ts, plus the Passenger global. */
  passenger: boolean;
  /** This process is the detached core-update worker, not the server. */
  worker: boolean;
};

type LaunchRequest =
  | { action: "systemctl"; scope: "system" | "user"; unit: string; servicePid: number }
  | { action: "signal"; pid: number; signal: "SIGTERM" | "SIGKILL" | "SIGUSR2" }
  | { action: "stop-main"; pid: number }
  | { action: "spawn"; cwd: string; servicePid: number; file: string; args: string[] }
  | { action: "reexec"; cwd: string; servicePid: number; file: string; args: string[] };

type RestartPlan = {
  ok: boolean;
  method: RestartMethod;
  detail: string;
  target?: string;
  error?: string;
  passengerFile?: string;
  launch?: LaunchRequest;
};

export type RestartHooks = {
  probe?: RestartProbe;
  /** Receives the helper's arguments. Return false if it could not be started. */
  launch?: (args: string[]) => boolean;
  mkdir?: (dir: string) => Promise<void>;
  writeFile?: (file: string, contents: string) => Promise<void>;
};

const PASSENGER_ENV = [
  "PASSENGER_APP_ENV",
  "PASSENGER_LISTEN_PORT",
  "PHUSION_PASSENGER",
  "PASSENGER_APP_ENV_NAME",
  "_PASSENGER_APP_ROOT",
] as const;

/** Units that serve every site on the machine. Restarting them is not an app reload. */
const SHARED_WEB_UNITS = new Set([
  "httpd.service",
  "apache2.service",
  "nginx.service",
  "lsws.service",
  "openlitespeed.service",
]);

const CONTAINER_INITS = new Set([
  "tini",
  "dumb-init",
  "catatonit",
  "docker-init",
  "conmon",
  "containerd-shim",
]);

const SPAWN_FILES = new Set(["pm2", "pm2.cmd", "rc-service", "supervisorctl"]);

/**
 * Sleep, then perform one restart action. Arguments are passed after `-e`,
 * never interpolated into this source. Pid 1 is only signalled by `stop-main`.
 */
export const restartHelperSource = `
const { execFile, spawn } = require("node:child_process");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function safeUnit(unit) {
  if (typeof unit !== "string" || unit.length < 9 || unit.length > 256) return false;
  if (!unit.endsWith(".service")) return false;
  const base = unit.slice(0, -8);
  if (!base || base[0] === "." || base[0] === "-") return false;
  for (let i = 0; i < base.length; i++) {
    const c = base.charCodeAt(i);
    const ok = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
      || c === 58 || c === 95 || c === 46 || c === 64 || c === 45;
    if (!ok) return false;
  }
  return true;
}

function run(file, args, cwd) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    const child = execFile(file, args, { cwd, timeout: 30000, windowsHide: true }, (err) => {
      if (!err) done("ok");
      else if (err.signal) done("signaled");
      else if (err.code === "ENOENT" || err.code === "EACCES") done("missing");
      else done("fail");
    });
    child.once("error", (err) => {
      if (err && (err.code === "ENOENT" || err.code === "EACCES")) done("missing");
      else done("fail");
    });
  });
}

function capture(file, args) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    const child = execFile(file, args, { timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err) done("");
      else done(String(stdout).trim());
    });
    child.once("error", () => done(""));
  });
}

async function main() {
  const [action, ...rest] = process.argv.slice(1);
  if (action === "systemctl") {
    const scope = rest[0];
    const unit = rest[1];
    const pid = Number(rest[2]);
    if ((scope !== "system" && scope !== "user") || !safeUnit(unit)) return;
    if (!Number.isInteger(pid) || pid <= 1) return;
    await sleep(1200);
    const restart = scope === "user" ? ["--user", "restart", unit] : ["restart", unit];
    const first = await run("systemctl", restart);
    if (first === "ok" || first === "signaled") return;
    const second = await run("sudo", ["-n", "systemctl", ...restart]);
    if (second === "ok" || second === "signaled") return;
    // The service user often cannot call systemctl. Stop the process only when
    // the unit is set to come back: SIGTERM counts as success, SIGKILL as failure.
    const show = scope === "user"
      ? ["--user", "show", "-p", "Restart", "--value", unit]
      : ["show", "-p", "Restart", "--value", unit];
    const mode = await capture("systemctl", show);
    const signal = mode === "on-success" || mode === "always" ? "SIGTERM" : "";
    const kill = mode === "on-failure" || mode === "on-abnormal" || mode === "on-abort" || mode === "on-watchdog";
    if (signal) {
      try { process.kill(pid, signal); } catch { /* already gone */ }
    } else if (kill) {
      try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
    }
    return;
  }
  if (action === "signal") {
    const pid = Number(rest[0]);
    const signal = rest[1];
    if (!Number.isInteger(pid) || pid <= 1) return;
    if (signal !== "SIGTERM" && signal !== "SIGKILL" && signal !== "SIGUSR2") return;
    await sleep(1200);
    try { process.kill(pid, signal); } catch { /* already gone */ }
    return;
  }
  if (action === "stop-main") {
    const pid = Number(rest[0]);
    if (!Number.isInteger(pid) || pid < 1) return;
    await sleep(1200);
    try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
    return;
  }
  if (action === "spawn") {
    const cwd = rest[0];
    const pid = Number(rest[1]);
    const file = rest[2];
    if (!file || !Number.isInteger(pid) || pid <= 1) return;
    await sleep(1200);
    const code = await run(file, rest.slice(3), cwd);
    if (code === "ok" || code === "signaled") return;
    try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
    return;
  }
  if (action === "reexec") {
    const cwd = rest[0];
    const pid = Number(rest[1]);
    const file = rest[2];
    if (!file || !Number.isInteger(pid) || pid <= 1) return;
    await sleep(1200);
    try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
    await sleep(1500);
    const child = spawn(file, rest.slice(3), { cwd, detached: true, stdio: "ignore", env: process.env, windowsHide: true });
    child.unref();
  }
}

main();
`;

export async function requestAppRestart(
  appRoot: string,
  hooks: RestartHooks = {},
): Promise<AppRestartResult> {
  const probe = hooks.probe ?? (await loadRestartProbe());
  const plan = planAppRestart(appRoot, probe);

  if (plan.passengerFile) {
    try {
      const mkdir = hooks.mkdir ?? ((dir: string) => fsp.mkdir(dir, { recursive: true }));
      const writeFile = hooks.writeFile ?? ((file: string, contents: string) => fsp.writeFile(file, contents, "utf8"));
      await mkdir(path.dirname(plan.passengerFile));
      await writeFile(plan.passengerFile, `${Date.now()}\n`);
    } catch (err) {
      return {
        ok: false,
        method: "passenger",
        path: plan.passengerFile,
        detail: "Could not trigger restart",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (plan.launch) {
    const args = launchArgs(plan.launch);
    if (!args) {
      return {
        ok: false,
        method: plan.method,
        path: plan.target ?? "",
        detail: "Could not trigger restart",
        error: "Could not trigger restart",
      };
    }
    const launch = hooks.launch ?? launchHelper;
    let started = false;
    try {
      started = launch(args);
    } catch (err) {
      return {
        ok: false,
        method: plan.method,
        path: plan.target ?? "",
        detail: "Could not trigger restart",
        error: err instanceof Error ? err.message : String(err),
      };
    }
    if (!started) {
      return {
        ok: false,
        method: plan.method,
        path: plan.target ?? "",
        detail: "Could not trigger restart",
        error: "Could not trigger restart",
      };
    }
  }

  return {
    ok: plan.ok,
    method: plan.method,
    path: plan.passengerFile ?? plan.target ?? "",
    detail: plan.detail,
    ...(plan.error ? { error: plan.error } : {}),
  };
}

/** Passenger-era name. Restarts the supervisor that is actually running the app. */
export const requestPassengerRestart = requestAppRestart;

export function planAppRestart(appRoot: string, probe: RestartProbe): RestartPlan {
  if (isPassenger(probe)) {
    const file = path.join(appRoot, "tmp", "restart.txt");
    return {
      ok: true,
      method: "passenger",
      detail: "Site will reload on the next request",
      target: file,
      passengerFile: file,
    };
  }

  const systemd = systemdTarget(probe);
  const pm2 = pm2Target(probe);
  if (isInvocationId(probe.env.INVOCATION_ID) && !systemd && !pm2) {
    return {
      ok: false,
      method: "systemd",
      detail: "Could not trigger restart",
      error: "Could not trigger restart",
    };
  }
  if (systemd && !(pm2 && systemd.unit.startsWith("pm2"))) {
    return {
      ok: true,
      method: "systemd",
      detail: `systemd will restart ${systemd.unit}`,
      target: systemd.unit,
      launch: { action: "systemctl", scope: systemd.scope, unit: systemd.unit, servicePid: systemd.pid },
    };
  }

  if (pm2) {
    return {
      ok: true,
      method: "pm2",
      detail: "PM2 will restart the app",
      target: pm2.name,
      launch: {
        action: "spawn",
        cwd: probe.cwd,
        servicePid: pm2.pid,
        file: probe.platform === "win32" ? "pm2.cmd" : "pm2",
        args: ["restart", pm2.name],
      },
    };
  }

  const hosted = hostedTarget(probe);
  if (hosted) return hosted;

  const parent = commandNames(probe.parentComm, probe.parentCmdline);
  const supervised = parentSupervisor(probe, parent);
  if (supervised) return supervised;

  if (probe.platform === "darwin" && probe.ppid === 1 && !inContainer(probe)) {
    return stopPlan(probe, "launchd", "launchd will restart the app", "SIGTERM");
  }

  if (parent.has("nssm") || parent.has("winsw")) {
    return stopPlan(probe, "windows-service", "The Windows service will restart", "SIGTERM");
  }

  if (probe.ppid === 1 && !probe.worker) {
    return stopPlan(probe, "init", "The init process will restart the app", "SIGTERM");
  }

  return reexecPlan(probe);
}

export async function loadRestartProbe(): Promise<RestartProbe> {
  const ppid = process.ppid;
  const [cgroup, parentComm, parentCmdline, pid1Comm, windowsParent] = await Promise.all([
    readText("/proc/self/cgroup"),
    readText(`/proc/${ppid}/comm`),
    readText(`/proc/${ppid}/cmdline`),
    readText("/proc/1/comm"),
    windowsImageName(ppid),
  ]);
  return {
    platform: process.platform,
    env: process.env,
    pid: process.pid,
    ppid,
    argv: process.argv,
    execPath: process.execPath,
    cwd: process.cwd(),
    cgroup,
    parentComm: parentComm?.trim() || windowsParent,
    parentCmdline,
    pid1Comm: pid1Comm?.trim() || null,
    dockerEnvFile: await exists("/.dockerenv"),
    containerEnvFile: await exists("/run/.containerenv"),
    passenger: passengerFromProcess(),
    worker: isUpdateWorker(process.argv),
  };
}

export function launchArgs(launch: LaunchRequest): string[] | null {
  switch (launch.action) {
    case "systemctl":
      if ((launch.scope !== "system" && launch.scope !== "user") || !isServiceUnitName(launch.unit)) return null;
      if (!isPid(launch.servicePid) || launch.servicePid <= 1) return null;
      return ["systemctl", launch.scope, launch.unit, String(launch.servicePid)];
    case "signal":
      if (!isPid(launch.pid) || launch.pid <= 1) return null;
      if (launch.signal !== "SIGTERM" && launch.signal !== "SIGKILL" && launch.signal !== "SIGUSR2") return null;
      return ["signal", String(launch.pid), launch.signal];
    case "stop-main":
      if (!isPid(launch.pid) || launch.pid < 1) return null;
      return ["stop-main", String(launch.pid)];
    case "spawn":
    case "reexec":
      if (!isSafeCommand(launch.file, launch.args) || launch.cwd.includes("\0") || launch.cwd.includes("\n")) return null;
      if (!isPid(launch.servicePid) || launch.servicePid <= 1) return null;
      return [launch.action, launch.cwd, String(launch.servicePid), launch.file, ...launch.args];
    default:
      return null;
  }
}

function launchHelper(args: string[]): boolean {
  if (process.env.VITEST && process.env.JF_ALLOW_APP_RESTART !== "1") {
    throw new Error("Refusing to restart the app from a test");
  }
  const child = spawn(process.execPath, ["-e", restartHelperSource, "--", ...args], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: process.env,
  });
  child.unref();
  return typeof child.pid === "number";
}

function isPassenger(probe: RestartProbe): boolean {
  if (probe.passenger) return true;
  return PASSENGER_ENV.some((key) => envPresent(probe.env, key));
}

function passengerFromProcess(): boolean {
  if (PASSENGER_ENV.some((key) => envPresent(process.env, key))) return true;
  return typeof (globalThis as { PhusionPassenger?: unknown }).PhusionPassenger !== "undefined";
}

function systemdTarget(probe: RestartProbe): { scope: "system" | "user"; unit: string; pid: number } | null {
  if (!isInvocationId(probe.env.INVOCATION_ID)) return null;
  const pid = servicePid(probe);
  if (pid == null || pid <= 1) return null;
  const parsed = parseSystemdUnit(probe.cgroup);
  if (!parsed) return null;
  return { scope: parsed.scope, unit: parsed.unit, pid };
}

function parseSystemdUnit(cgroup: string | null): { scope: "system" | "user"; unit: string } | null {
  if (!cgroup) return null;
  const units: string[] = [];
  for (const line of cgroup.split("\n")) {
    for (const segment of line.split("/")) {
      const name = segment.trim();
      if (isServiceUnitName(name) && !isUserManagerUnit(name)) units.push(name);
    }
  }
  const unit = units[units.length - 1];
  if (!unit || SHARED_WEB_UNITS.has(unit)) return null;
  const scope = cgroup.includes("/user.slice/") ? "user" : "system";
  return { scope, unit };
}

function pm2Target(probe: RestartProbe): { name: string; pid: number } | null {
  const id = probe.env.pm_id;
  if (!isDigits(id ?? "")) return null;
  const pid = servicePid(probe);
  if (pid == null || pid <= 1) return null;
  const name = probe.env.name;
  if (name && isToken(name, 64)) return { name, pid };
  return { name: id as string, pid };
}

function hostedTarget(probe: RestartProbe): RestartPlan | null {
  if (envPresent(probe.env, "KUBERNETES_SERVICE_HOST")) {
    return stopPlan(probe, "kubernetes", "Kubernetes will restart the container", "SIGTERM", true);
  }
  if (envPresent(probe.env, "DYNO")) {
    return stopPlan(probe, "heroku", "Heroku will restart the dyno", "SIGTERM", true);
  }
  if (envPresent(probe.env, "FLY_APP_NAME")) {
    return stopPlan(probe, "fly", "Fly.io will restart the machine", "SIGTERM", true);
  }
  if (envPresent(probe.env, "RENDER_SERVICE_ID") || probe.env.RENDER === "true") {
    return stopPlan(probe, "render", "Render will restart the service", "SIGTERM", true);
  }
  if (envPresent(probe.env, "RAILWAY_SERVICE_ID") || envPresent(probe.env, "RAILWAY_ENVIRONMENT")) {
    return stopPlan(probe, "railway", "Railway will restart the service", "SIGTERM", true);
  }
  if (envPresent(probe.env, "NOMAD_ALLOC_ID")) {
    return stopPlan(probe, "nomad", "Nomad will restart the allocation", "SIGTERM", true);
  }
  if (envPresent(probe.env, "ECS_CONTAINER_METADATA_URI") || envPresent(probe.env, "ECS_CONTAINER_METADATA_URI_V4")) {
    return stopPlan(probe, "ecs", "ECS will restart the container", "SIGTERM", true);
  }
  if (envPresent(probe.env, "K_SERVICE")) {
    return stopPlan(probe, "cloudrun", "Cloud Run will restart the instance", "SIGTERM", true);
  }
  if (inContainer(probe)) {
    return stopPlan(probe, "container", "The container runtime will restart the app", "SIGTERM", true);
  }
  return null;
}

function parentSupervisor(probe: RestartProbe, parent: Set<string>): RestartPlan | null {
  if (parent.has("nodemon")) {
    const signal = probe.platform === "win32" ? "SIGTERM" : "SIGUSR2";
    const pid = probe.worker ? servicePid(probe) : probe.ppid;
    if (pid == null || pid <= 1) return null;
    return {
      ok: true,
      method: "nodemon",
      detail: "nodemon will restart the app",
      launch: probe.worker
        ? { action: "signal", pid, signal: "SIGTERM" }
        : { action: "signal", pid, signal },
    };
  }
  if (parent.has("forever")) {
    return stopPlan(probe, "forever", "forever will restart the app", "SIGKILL");
  }
  if (parent.has("supervisord")) {
    const name = probe.env.SUPERVISOR_PROCESS_NAME;
    const pid = servicePid(probe);
    if (name && isToken(name, 128, true) && pid != null && pid > 1) {
      return {
        ok: true,
        method: "supervisord",
        detail: "supervisord will restart the app",
        target: name,
        launch: {
          action: "spawn",
          cwd: probe.cwd,
          servicePid: pid,
          file: "supervisorctl",
          args: ["restart", name],
        },
      };
    }
    return stopPlan(probe, "supervisord", "supervisord will restart the app", "SIGTERM");
  }
  const rcName = probe.env.RC_SVCNAME;
  if ((rcName && isToken(rcName, 64)) || parent.has("supervise-daemon")) {
    const pid = servicePid(probe);
    if (rcName && isToken(rcName, 64) && pid != null && pid > 1) {
      return {
        ok: true,
        method: "openrc",
        detail: "OpenRC will restart the service",
        target: rcName,
        launch: {
          action: "spawn",
          cwd: probe.cwd,
          servicePid: pid,
          file: "rc-service",
          args: [rcName, "restart"],
        },
      };
    }
    return stopPlan(probe, "openrc", "OpenRC will restart the service", "SIGTERM");
  }
  if (parent.has("s6-supervise")) {
    return stopPlan(probe, "s6", "s6 will restart the app", "SIGTERM");
  }
  if (parent.has("runsv")) {
    return stopPlan(probe, "runit", "runit will restart the app", "SIGTERM");
  }
  if (parent.has("supervise")) {
    return stopPlan(probe, "daemontools", "daemontools will restart the app", "SIGTERM");
  }
  return null;
}

function stopPlan(
  probe: RestartProbe,
  method: RestartMethod,
  detail: string,
  signal: "SIGTERM" | "SIGKILL",
  container = false,
): RestartPlan {
  const pid = servicePid(probe) ?? (container ? 1 : null);
  if (pid == null || (pid <= 1 && !container)) {
    return {
      ok: false,
      method,
      detail: "Could not trigger restart",
      error: "The app process could not be identified",
    };
  }
  if (pid <= 1) {
    return { ok: true, method, detail, launch: { action: "stop-main", pid } };
  }
  return { ok: true, method, detail, launch: { action: "signal", pid, signal } };
}

function reexecPlan(probe: RestartProbe): RestartPlan {
  const command = serverCommand(probe);
  const pid = servicePid(probe);
  if (!command || pid == null || pid <= 1) {
    return {
      ok: false,
      method: "reexec",
      detail: "Could not trigger restart",
      error: "Start the app again to load the update",
    };
  }
  return {
    ok: true,
    method: "reexec",
    detail: "The app will start again",
    launch: { action: "reexec", cwd: probe.cwd, servicePid: pid, file: command.file, args: command.args },
  };
}

function serverCommand(probe: RestartProbe): { file: string; args: string[] } | null {
  if (!probe.worker) {
    const args = probe.argv.slice(1);
    if (!isSafeCommand(probe.execPath, args)) return null;
    return { file: probe.execPath, args: [...args] };
  }
  if (!probe.parentCmdline) return null;
  const parts = probe.parentCmdline.split("\0").filter((part) => part.length > 0);
  if (parts.length < 2) return null;
  let file = parts[0] ?? "";
  const args = parts.slice(1);
  const base = baseName(file).toLowerCase();
  if (base === "node" || base === "node.exe" || base === "nodejs") file = probe.execPath;
  if (!isSafeCommand(file, args)) return null;
  return { file, args };
}

function servicePid(probe: RestartProbe): number | null {
  if (probe.worker) return probe.ppid > 1 ? probe.ppid : null;
  return probe.pid > 1 ? probe.pid : null;
}

function inContainer(probe: RestartProbe): boolean {
  if (probe.dockerEnvFile || probe.containerEnvFile) return true;
  const marker = probe.env.container;
  if (marker === "docker" || marker === "podman" || marker === "oci" || marker === "lxc") return true;
  const init = (probe.pid1Comm ?? "").toLowerCase();
  if (CONTAINER_INITS.has(init)) return true;
  const parent = (probe.parentComm ?? "").trim().toLowerCase();
  if (CONTAINER_INITS.has(parent)) return true;
  const cgroup = probe.cgroup ?? "";
  return (
    cgroup.includes("/docker/") ||
    cgroup.includes("docker-") ||
    cgroup.includes("/kubepods") ||
    cgroup.includes("containerd") ||
    cgroup.includes("/podman")
  );
}

function commandNames(comm: string | null, cmdline: string | null): Set<string> {
  const names = new Set<string>();
  const add = (raw: string) => {
    let base = baseName(raw).toLowerCase();
    if (base.endsWith(".exe")) base = base.slice(0, -4);
    if (base.endsWith(".js")) base = base.slice(0, -3);
    if (base) names.add(base);
  };
  if (comm) add(comm.trim());
  if (cmdline) {
    for (const part of cmdline.split("\0")) {
      if (part) add(part);
    }
  }
  return names;
}

function isUpdateWorker(argv: readonly string[]): boolean {
  for (const arg of argv) {
    const base = baseName(arg);
    if (base === "core-update-worker.js" || base === "core-update-worker.ts" || base === "core-update-worker.mjs") {
      return true;
    }
  }
  return false;
}

export function isServiceUnitName(name: string): boolean {
  if (name.length < 9 || name.length > 256 || !name.endsWith(".service")) return false;
  const base = name.slice(0, -".service".length);
  if (!base || base.startsWith(".") || base.startsWith("-")) return false;
  for (const ch of base) {
    const ok =
      (ch >= "a" && ch <= "z") ||
      (ch >= "A" && ch <= "Z") ||
      (ch >= "0" && ch <= "9") ||
      ch === ":" ||
      ch === "_" ||
      ch === "." ||
      ch === "@" ||
      ch === "-";
    if (!ok) return false;
  }
  return true;
}

function isUserManagerUnit(name: string): boolean {
  if (!name.startsWith("user@") || !name.endsWith(".service")) return false;
  return isDigits(name.slice("user@".length, -".service".length));
}

function isInvocationId(value: string | undefined): boolean {
  if (!value || (value.length !== 32 && value.length !== 36)) return false;
  let dashes = 0;
  for (const ch of value) {
    const hex = (ch >= "0" && ch <= "9") || (ch >= "a" && ch <= "f") || (ch >= "A" && ch <= "F");
    if (ch === "-") dashes += 1;
    else if (!hex) return false;
  }
  if (value.length === 32) return dashes === 0;
  return dashes === 4;
}

function isToken(value: string, max: number, allowColon = false): boolean {
  if (value.length < 1 || value.length > max) return false;
  if (value === "." || value === "..") return false;
  for (const ch of value) {
    const ok =
      (ch >= "a" && ch <= "z") ||
      (ch >= "A" && ch <= "Z") ||
      (ch >= "0" && ch <= "9") ||
      ch === "." ||
      ch === "_" ||
      ch === "-" ||
      ch === "@" ||
      (allowColon && ch === ":");
    if (!ok) return false;
  }
  return true;
}

function isDigits(value: string): boolean {
  if (value.length < 1 || value.length > 10) return false;
  for (const ch of value) {
    if (ch < "0" || ch > "9") return false;
  }
  return true;
}

function isPid(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value < 2 ** 31;
}

function isSafeCommand(file: string, args: string[]): boolean {
  if (!file || hasBreak(file) || hasDotDot(file)) return false;
  for (const arg of args) {
    if (hasBreak(arg)) return false;
  }
  if (file.startsWith("/") || isWindowsAbsolute(file)) return true;
  return SPAWN_FILES.has(file);
}

function hasBreak(value: string): boolean {
  return value.includes("\0") || value.includes("\n") || value.includes("\r");
}

function hasDotDot(file: string): boolean {
  let start = 0;
  for (let i = 0; i <= file.length; i++) {
    if (i === file.length || file[i] === "/" || file[i] === "\\") {
      if (file.slice(start, i) === "..") return true;
      start = i + 1;
    }
  }
  return false;
}

function isWindowsAbsolute(file: string): boolean {
  return file.length > 2 && file[1] === ":" && (file[2] === "\\" || file[2] === "/");
}

function envPresent(env: NodeJS.ProcessEnv, key: string): boolean {
  const value = env[key];
  return typeof value === "string" && value.length > 0 && value.length < 300 && !hasBreak(value);
}

function baseName(value: string): string {
  const slash = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  return slash === -1 ? value : value.slice(slash + 1);
}

async function readText(file: string): Promise<string | null> {
  try {
    return await fsp.readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fsp.access(file);
    return true;
  } catch {
    return false;
  }
}

async function windowsImageName(pid: number): Promise<string | null> {
  if (process.platform !== "win32" || !isPid(pid)) return null;
  const procId = String(pid);
  const script =
    "& { param($procId) (Get-CimInstance Win32_Process -Filter ('ProcessId=' + $procId)).Name } -procId " +
    procId;
  return new Promise((resolve) => {
    const child = execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: 3000, windowsHide: true },
      (err, stdout) => {
        if (err) resolve(null);
        else resolve(String(stdout).trim() || null);
      },
    );
    child.once("error", () => resolve(null));
  });
}
