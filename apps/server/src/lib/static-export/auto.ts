// SPDX-License-Identifier: MIT

import type { CacheRevalidatedEvent, CacheRevalidateTrigger, ContentRef } from "@justflows/sdk";
import { getRuntimeHooks } from "../plugin-runtime.js";
import { getStaticExportConfig } from "./config.js";
import { runStaticExport } from "./index.js";

type Unsubscribe = () => void;

let disposers: Unsubscribe[] = [];
let armed = false;
let timer: NodeJS.Timeout | null = null;
let running = false;
let pendingTriggers = new Set<CacheRevalidateTrigger>();
let pendingContentIds = new Set<string>();
let pendingGroupIds = new Set<string>();

/** Strip CR/LF so crawled URLs in exporter output cannot forge log lines
 *  (CodeQL js/log-injection only accepts an empty replacement as a sanitizer). */
function stripNewlines(value: string): string {
  return value.replace(/\r/g, "").replace(/\n/g, "");
}

function logLine(line: string): void {
  console.log(`[justflows] static-export ${stripNewlines(line)}`);
}

async function flush(): Promise<void> {
  timer = null;
  if (running) {
    // A run is in progress; re-arm so the events that arrived meanwhile are honoured.
    schedule(getStaticExportConfig().debounceMs);
    return;
  }
  const triggers = [...pendingTriggers];
  const contentIds = [...pendingContentIds];
  const translationGroupIds = [...pendingGroupIds];
  pendingTriggers = new Set();
  pendingContentIds = new Set();
  pendingGroupIds = new Set();
  if (triggers.length === 0) return;

  running = true;
  try {
    const globalTrigger = triggers.find((t) => t !== "content");
    // A non-content trigger means chrome changed → rebuild everything. Otherwise
    // use the content ids we captured so the run stays targeted.
    const trigger: CacheRevalidateTrigger = globalTrigger ?? "content";
    const summary = await runStaticExport({
      mode: "incremental",
      trigger,
      contentIds: globalTrigger ? undefined : contentIds,
      translationGroupIds: globalTrigger ? undefined : translationGroupIds,
      reason: `auto: ${triggers.join(", ")}`,
      log: (l) => logLine(l),
    });
    logLine(
      `rebuild done (${summary.pages} pages, ${summary.assets} assets` +
        `${summary.pruned ? `, ${summary.pruned} pruned` : ""})`,
    );
  } catch (err) {
    logLine(`rebuild failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    running = false;
    if (pendingTriggers.size > 0) schedule(getStaticExportConfig().debounceMs);
  }
}

function schedule(delayMs: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush(), delayMs);
  if (typeof timer.unref === "function") timer.unref();
}

function teardown(): void {
  for (const dispose of disposers) {
    try {
      dispose();
    } catch {
      // ignore
    }
  }
  disposers = [];
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  armed = false;
}

/**
 * (Re)arm the auto-rebuild from the current environment. When
 * `STATIC_EXPORT_AUTO=1`, an incremental export runs shortly after any
 * `cache.revalidated` action (publish / unpublish / delete / settings / menu /
 * theme) — needs cache revalidation enabled, since that is what fires the hook.
 * Safe to call repeatedly: existing listeners are dropped first, so toggling the
 * setting in the admin takes effect without a restart.
 */
export function refreshStaticExportAutoRebuild(): void {
  teardown();
  const cfg = getStaticExportConfig();
  if (!cfg.enabled || !cfg.auto) return;

  const hooks = getRuntimeHooks();
  disposers.push(
    hooks.action("cache.revalidated", (event: CacheRevalidatedEvent) => {
      pendingTriggers.add(event.trigger);
      schedule(cfg.debounceMs);
    }),
  );
  // Capture the specific ids so a content change can stay a targeted rebuild.
  const noteContent = (event: ContentRef) => {
    if (event.contentId) pendingContentIds.add(event.contentId);
    if (event.translationGroupId) pendingGroupIds.add(event.translationGroupId);
    pendingTriggers.add("content");
    schedule(cfg.debounceMs);
  };
  for (const hook of ["content.published", "content.unpublished", "content.deleted"] as const) {
    disposers.push(hooks.action(hook, noteContent));
  }
  armed = true;
  console.log(
    `[justflows] static-export auto-rebuild armed (debounce ${cfg.debounceMs}ms, ` +
      `dir ${stripNewlines(cfg.outDir)})`,
  );
}

/** Boot-time entry point (called once from register-routes). */
export function installStaticExportAutoRebuild(): void {
  refreshStaticExportAutoRebuild();
}

export function isStaticExportAutoArmed(): boolean {
  return armed;
}
