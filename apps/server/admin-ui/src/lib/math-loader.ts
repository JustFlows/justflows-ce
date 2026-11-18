// SPDX-License-Identifier: MIT

import { useSyncExternalStore } from "react";
import { hasMath, isMathRendererReady, renderMath } from "@justflows/blocks";

/**
 * KaTeX for the builder, loaded only when a document has a formula
 * (justflows-ce#318).
 *
 * `@justflows/blocks` resolves to its browser entry here, which does not
 * import KaTeX, so `renderMath` shows each formula's source until
 * `@justflows/blocks/katex` is loaded. Components that typeset call
 * {@link renderMathOnDemand}, which starts the load the first time it sees a
 * formula, and subscribe with {@link useMathReady} so they redraw once.
 */

let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Load KaTeX and its stylesheet once; later calls share the same promise. */
export function loadMathRenderer(): Promise<void> {
  if (isMathRendererReady()) return Promise.resolve();
  loading ??= Promise.all([import("@justflows/blocks/katex"), import("katex/dist/katex.min.css")])
    .then(() => {
      for (const listener of listeners) listener();
    })
    .catch((err: unknown) => {
      /** A failed chunk load is retried on the next formula; the source stays visible meanwhile. */
      loading = null;
      console.error("[builder] could not load the formula renderer", err);
    });
  return loading;
}

/** Typeset formulas in `html`, starting the KaTeX load when it holds one. */
export function renderMathOnDemand(html: string): string {
  if (hasMath(html) && !isMathRendererReady()) void loadMathRenderer();
  return renderMath(html);
}

/** Re-render when KaTeX has loaded. */
export function useMathReady(): boolean {
  return useSyncExternalStore(subscribe, isMathRendererReady, isMathRendererReady);
}
