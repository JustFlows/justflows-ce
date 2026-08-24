import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

function loadGate(): {
  bootstrapPageEnabled: (root: string, env?: NodeJS.ProcessEnv) => boolean;
  bootstrapSpawnAllowed: (root: string, env?: NodeJS.ProcessEnv) => boolean;
  removeBootstrapIndex: (root: string, env?: NodeJS.ProcessEnv) => boolean;
  depsReady: (root: string) => boolean;
} {
  const candidates = [
    path.resolve(process.cwd(), "../../scripts/bootstrap-gate.cjs"),
    path.resolve(process.cwd(), "scripts/bootstrap-gate.cjs"),
  ];
  const found = candidates.find((file) => fs.existsSync(file));
  if (!found) throw new Error("scripts/bootstrap-gate.cjs not found");
  return require(found) as ReturnType<typeof loadGate>;
}

const gate = loadGate();
const dirs: string[] = [];

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jf-bootstrap-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("bootstrap gate", () => {
  it("blocks spawning install-all in a git checkout", () => {
    const root = tempRoot();
    fs.writeFileSync(path.join(root, "index.html"), "<html></html>\n");
    fs.mkdirSync(path.join(root, ".git"));
    expect(gate.bootstrapPageEnabled(root, {})).toBe(true);
    expect(gate.bootstrapSpawnAllowed(root, {})).toBe(false);
  });

  it("allows spawning on an unzipped release that is not installed", () => {
    const root = tempRoot();
    fs.writeFileSync(path.join(root, "index.html"), "<html></html>\n");
    expect(gate.bootstrapSpawnAllowed(root, {})).toBe(true);
  });

  it("refuses to spawn after the site is installed", () => {
    const root = tempRoot();
    fs.writeFileSync(path.join(root, "index.html"), "<html></html>\n");
    fs.writeFileSync(path.join(root, ".env"), "STATE=INSTALLED\n");
    expect(gate.bootstrapSpawnAllowed(root, {})).toBe(false);
  });

  it("removes index.html only after install, and never in a git checkout", () => {
    const release = tempRoot();
    fs.writeFileSync(path.join(release, "index.html"), "<html></html>\n");
    expect(gate.removeBootstrapIndex(release, {})).toBe(false);
    expect(fs.existsSync(path.join(release, "index.html"))).toBe(true);

    fs.writeFileSync(path.join(release, ".env"), "STATE=INSTALLED\n");
    expect(gate.removeBootstrapIndex(release, { STATE: "INSTALLED" })).toBe(true);
    expect(fs.existsSync(path.join(release, "index.html"))).toBe(false);

    const checkout = tempRoot();
    fs.writeFileSync(path.join(checkout, "index.html"), "<html></html>\n");
    fs.mkdirSync(path.join(checkout, ".git"));
    expect(gate.removeBootstrapIndex(checkout, { STATE: "INSTALLED" })).toBe(false);
    expect(fs.existsSync(path.join(checkout, "index.html"))).toBe(true);
  });

  it("treats missing express as not ready", () => {
    const root = tempRoot();
    expect(gate.depsReady(root)).toBe(false);
  });

  it("treats a present server bundle as satisfying workspace packages", () => {
    const root = tempRoot();
    fs.mkdirSync(path.join(root, "node_modules", "express"), { recursive: true });
    fs.mkdirSync(path.join(root, "apps/server/admin-ui/dist"), { recursive: true });
    fs.mkdirSync(path.join(root, "apps/server/dist"), { recursive: true });
    fs.writeFileSync(path.join(root, "apps/server/admin-ui/dist/index.html"), "<html></html>\n");
    fs.writeFileSync(path.join(root, "apps/server/dist/server.bundle.mjs"), "export {}\n");
    expect(gate.depsReady(root)).toBe(true);
  });
});
