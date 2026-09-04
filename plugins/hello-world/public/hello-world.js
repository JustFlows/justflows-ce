// SPDX-License-Identifier: GPL-2.0-or-later
//
// Client asset demo for the Hello World plugin. It is auto-loaded on every
// public page because the manifest declares:
//
//   "assets": { "dir": "public", "scripts": ["hello-world.js"] }
//
// No ctx.http route and no html.head filter — the host serves this file at
// /ext/justflows.hello-world/hello-world.js and enqueues the <script> tag, and
// the static-site exporter downloads it like any other asset.

(function () {
  "use strict";
  document.querySelectorAll(".jf-hello-world").forEach(function (el) {
    el.setAttribute("data-jf-hello", "ready");
  });
})();
