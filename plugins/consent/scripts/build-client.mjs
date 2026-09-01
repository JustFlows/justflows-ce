import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const entry = fileURLToPath(new URL("../src/client/runtime.ts", import.meta.url));
const outputDirectory = fileURLToPath(new URL("../dist/runtime/", import.meta.url));
const output = fileURLToPath(new URL("../dist/runtime/runtime.js", import.meta.url));

await mkdir(outputDirectory, { recursive: true });

const result = await build({
  entryPoints: [entry],
  outfile: output,
  bundle: true,
  format: "iife",
  target: ["es2019"],
  platform: "browser",
  minify: true,
  legalComments: "none",
  logLevel: "silent",
});

for (const warning of result.warnings) console.warn(`[consent:client] ${warning.text}`);
