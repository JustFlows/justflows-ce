// SPDX-License-Identifier: MIT

import { apiPost } from "../api.js";

interface ExportSummary {
  pages: number;
  assets: number;
  bytes: number;
  pruned: number;
  outDir: string;
  durationMs: number;
}

interface ExportResponse {
  ok: boolean;
  error?: string;
  summary?: ExportSummary;
  log?: string[];
}

export async function exportCommand(args: string[]): Promise<void> {
  const [sub, ...rest] = args;

  if (sub && sub !== "static" && sub !== "run") {
    console.log("Usage: justflows export static [--incremental] [--base-url <url>]");
    return;
  }

  const incremental = rest.includes("--incremental");
  const baseIdx = rest.indexOf("--base-url");
  const baseUrl = baseIdx !== -1 ? rest[baseIdx + 1] : undefined;

  const res = await apiPost<ExportResponse>("/api/static-export/run", {
    mode: incremental ? "incremental" : "full",
    ...(baseUrl ? { baseUrl } : {}),
  });

  for (const line of res.log ?? []) console.log(line);

  if (!res.ok) {
    console.error(`✗ Export failed: ${res.error ?? "unknown error"}`);
    process.exitCode = 1;
    return;
  }

  const s = res.summary;
  if (s) {
    console.log(
      `✓ ${s.pages} page(s), ${s.assets} asset(s), ${(s.bytes / 1024).toFixed(0)} KB → ${s.outDir}` +
        (s.pruned ? ` (${s.pruned} pruned)` : ""),
    );
  }
}
