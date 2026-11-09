// SPDX-License-Identifier: MIT

import { createElement, lazy, type ComponentType } from "react";

type Loader<P> = () => Promise<{ default: ComponentType<P> }>;

const preloads: Array<() => Promise<void>> = [];

/**
 * A route page in its own chunk. Until the chunk arrives the page suspends
 * (React.lazy), so the nearest `<Suspense>` shows its fallback, or during
 * hydration keeps the server-rendered HTML on screen. Once loaded it renders
 * synchronously, which is what lets the SSR build render real pages with
 * `renderToString` after {@link preloadAllPages}.
 */
export function lazyPage<P extends object>(load: Loader<P>): ComponentType<P> & { preload: () => Promise<void> } {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<void> | null = null;
  const preload = () =>
    (pending ??= load().then(
      (module) => {
        loaded = module.default;
      },
      (err: unknown) => {
        /** A failed chunk (offline, deploy in between) may be retried on the next render. */
        pending = null;
        throw err;
      },
    ));
  const Lazy = lazy(async () => {
    await preload();
    return { default: loaded! };
  });
  function Page(props: P) {
    return loaded ? createElement(loaded, props) : createElement(Lazy as unknown as ComponentType<P>, props);
  }
  preloads.push(preload);
  return Object.assign(Page, { preload });
}

/** Load every page chunk; the SSR bundle awaits this once before its first render. */
export async function preloadAllPages(): Promise<void> {
  await Promise.all(preloads.map((preload) => preload()));
}
