import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hideReactRouterVersion, stripReactRouterVersion } from "../hide-react-router-version";

const PUBLISHED = `
/**
 * react-router v7.18.4
 *
 * Copyright (c) Remix Software Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.md file in the root directory of this source tree.
 *
 * @license MIT
 */
try { keep(); } catch (err) { report(err); }
try {
  if (isBrowser) {
    window.__reactRouterVersion = // @ts-expect-error
    "7.18.4";
  }
} catch (e) {
}
function createBrowserRouter() { return "routes"; }
`;

describe("stripReactRouterVersion", () => {
  it("drops the scanner global and the banner version", () => {
    const next = stripReactRouterVersion(PUBLISHED);
    expect(next).not.toContain("__reactRouterVersion");
    expect(next).not.toContain("7.18.4");
    expect(next).toContain("Copyright (c) Remix Software Inc.");
    expect(next).toContain("@license MIT");
    expect(next).toContain("try { keep(); } catch (err) { report(err); }");
    expect(next).toContain("function createBrowserRouter()");
  });

  it("drops the release from a bundler path comment", () => {
    const code = "// ../../node_modules/.pnpm/react-router@7.18.4_react-dom@19.3.1/node_modules/react-router/dist/index.mjs\nkeep();";
    const next = stripReactRouterVersion(code);
    expect(next).not.toContain("7.18.4");
    expect(next).toContain("react-dom@19.3.1");
    expect(next).toContain("keep();");
  });

  it("leaves unrelated modules unchanged", () => {
    const code = "export const version = '1.2.3';";
    expect(stripReactRouterVersion(code)).toBe(code);
  });
});

describe("hideReactRouterVersion", () => {
  const plugin = hideReactRouterVersion();

  it("ignores application source", () => {
    const transform = plugin.transform;
    expect(typeof transform).toBe("function");
    if (typeof transform !== "function") return;
    expect(transform.call(undefined as never, PUBLISHED, "/app/src/entry-client.tsx")).toBeNull();
  });

  it("rewrites React Router modules, including the pnpm store path", () => {
    const transform = plugin.transform;
    expect(typeof transform).toBe("function");
    if (typeof transform !== "function") return;
    const id =
      "/repo/node_modules/.pnpm/react-router@7.18.4/node_modules/react-router/dist/production/index.js";
    const result = transform.call(undefined as never, PUBLISHED, id);
    expect(result).toMatchObject({ map: null });
    expect(result && typeof result === "object" && "code" in result ? result.code : "").not.toContain(
      "__reactRouterVersion",
    );
  });
});

describe("installed React Router build", () => {
  it("removes the release from every published module and leaves valid JavaScript", () => {
    const fromAdmin = createRequire(adminViteConfig());
    const routerDom = path.dirname(fromAdmin.resolve("react-router-dom/package.json"));
    const router = path.dirname(createRequire(path.join(routerDom, "package.json")).resolve("react-router/package.json"));
    const packages = [routerDom, router];
    const files = packages.flatMap((pkg) => listDist(path.join(pkg, "dist")));
    expect(files.length).toBeGreaterThan(0);
    const version = JSON.parse(fs.readFileSync(path.join(router, "package.json"), "utf8")).version as string;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rr-strip-"));
    try {
      for (const file of files) {
        const source = fs.readFileSync(file, "utf8");
        const next = stripReactRouterVersion(source);
        expect(next, file).not.toContain("__reactRouterVersion");
        expect(next, file).not.toContain(version);
        if (source.includes("Copyright (c) Remix Software Inc.")) {
          expect(next, file).toContain("Copyright (c) Remix Software Inc.");
        }
        const out = path.join(dir, `${path.basename(file, path.extname(file))}-${files.indexOf(file)}.mjs`);
        fs.writeFileSync(out, next);
        const checked = spawnSync(process.execPath, ["--check", out], { encoding: "utf8" });
        expect(checked.status, checked.stderr).toBe(0);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

function adminViteConfig(): string {
  const candidates = [
    path.resolve(process.cwd(), "vite.config.ts"),
    path.resolve(process.cwd(), "admin-ui/vite.config.ts"),
  ];
  const found = candidates.find((file) => fs.existsSync(file));
  if (!found) throw new Error("Could not find admin-ui/vite.config.ts");
  return found;
}

function listDist(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listDist(full));
    else if (entry.isFile() && /\.(?:js|mjs|cjs)$/.test(entry.name)) found.push(full);
  }
  return found;
}
