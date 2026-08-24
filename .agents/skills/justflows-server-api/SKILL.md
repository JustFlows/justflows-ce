---
name: justflows-server-api
description: Build or modify the Justflows Express server, routes, middleware, installation flow, public API, EJS rendering, and runtime services. Use for backend HTTP behavior; not for framework-neutral package logic alone.
---

# Justflows Server and API

Read `AGENTS.md`, `apps/server/src/server.ts`, `apps/server/src/register-routes.ts`, and neighboring routes or middleware before editing. Reuse current registration, response, session, and service patterns.

- Keep Express, cookies, sessions, and EJS inside `apps/server`.
- Validate params, query, bodies, uploads, and environment-derived values at the boundary.
- Require authentication and the narrowest capability for administrative mutations. Preserve public API access controls and safe cache behavior.
- Never return secrets, internal paths, stack traces, password hashes, or raw database errors.
- For filesystem or archive operations, reject traversal, symlink escapes, unsafe extensions, and oversized input. Resolve user- or database-supplied segments with `resolvePathUnderBase` before `readFile`/`sendFile`.
- Public routes that `sendFile` need `express-rate-limit` on the same `app.get` chain. CodeQL `js/missing-rate-limiting` only models that package (not a custom `consumeRateLimit` helper).
- Do not interpolate `req.method`, `req.path`, or other request data into the first argument of `console.error`. Strip newlines with `.replace(/\n/g, "").replace(/\r/g, "")` (empty replacement) and pass the result through `JSON.stringify` — CodeQL `js/log-injection` does not treat a custom wrapper or a `_` substitution as a sanitizer.
- Register new routes deliberately; check ordering against public-site fallbacks and middleware.

Test successful requests plus validation, authorization, missing-resource, and failure paths. Consider cache invalidation, compression, localization, install state, and plugin hooks. Run `pnpm --filter @justflows/server typecheck` and relevant tests/build.
