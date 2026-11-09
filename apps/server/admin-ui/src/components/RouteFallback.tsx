// SPDX-License-Identifier: MIT

/**
 * Shown while a route's chunk loads: an empty, busy region, the same blank
 * area a page shows while its own data loads, so a fast load does not flash.
 */
export function RouteFallback() {
  return <div className="jf-route-loading" role="status" aria-busy="true" />;
}
