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
- Public routes that read files (`sendFile`, `existsSync`, static SPA HTML) need `consumeRateLimit` on the same handler chain (CodeQL `js/missing-rate-limiting`).
- Do not interpolate `req.method`, `req.path`, or other request data into the first argument of `console.error`. Use `logSafe()` so `%` cannot become a format string and CR/LF cannot inject log lines.
- Register new routes deliberately; check ordering against public-site fallbacks and middleware.

Test successful requests plus validation, authorization, missing-resource, and failure paths. Consider cache invalidation, compression, localization, install state, and plugin hooks. Run `pnpm --filter @justflows/server typecheck` and relevant tests/build.
