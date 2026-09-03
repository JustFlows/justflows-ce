# Architecture

Justflows is one Express application with three deliberately different render
paths. Production releases ship all compiled output; installation never asks a
site owner to run Vite, TypeScript, npm build, or pnpm build.

## Public website and SEO

Public pages are rendered completely on the server by
`apps/server/src/routes/public-site.ts` and the EJS views under
`apps/server/src/views`. The first HTML response contains the published blocks,
navigation, title, meta description, canonical URL, Open Graph tags, structured
data, and language alternates. Search crawlers do not need to execute React or
wait for an API request to discover page content.

The public renderer also owns localized URLs, redirects to canonical paths,
`robots.txt`, `sitemap.xml`, theme CSS, page caching, and preview authorization.
Do not move public content or SEO metadata into the admin React bundle.

## Authenticated admin SSR

The Vite/React admin has two entry points:

- `admin-ui/src/entry-server.tsx` renders the requested route with React's
  server renderer and React Router's `StaticRouter`.
- `admin-ui/src/entry-client.tsx` hydrates that markup with `BrowserRouter` and
  installs CSRF handling for later mutations.

For an authenticated `/admin/*` navigation, Express validates the session,
prefetches the shared shell data and the current route's initial read requests,
renders the React tree, and embeds an escaped JSON snapshot in the document.
The hydration client serves those initial GETs from the snapshot, so it does not
repeat them as browser Fetch/XHR traffic. The cache expires after hydration;
saves, deletes, uploads, explicit refreshes, and later navigation continue to use
the authenticated API.

The embedded snapshot is a delivery optimization, not a security boundary.
Only data already authorized for the current session may be serialized. Admin
HTML is `private, no-store` and carries `X-Robots-Tag: noindex, nofollow,
noarchive`.

Login, registration, and first-run installation can be served by the lightweight
root startup layer before the full Express application is ready. They use the
same client bundle but do not require the authenticated admin SSR data path.

## Build artifacts

`pnpm --filter @justflows/server build` produces:

```text
apps/server/dist/                         compiled Express server and views
apps/server/admin-ui/dist/client/         browser HTML, JavaScript, CSS, assets
apps/server/admin-ui/dist/server/         Node SSR bundle (entry-server.js)
```

The updater and first-run bootstrap consider the application built only when
the Express output, client HTML, and SSR entry all exist. Docker copies both
admin outputs into the runtime image. `scripts/make-zip.sh` builds them before
creating an official shared-hosting archive.

Consequently:

- Docker users build the image through Docker Compose and never invoke Vite.
- Release ZIP users upload prebuilt artifacts and install runtime dependencies
  through the browser bootstrap.
- Core updates may use the prebuilt artifacts contained in the update archive.
- Only source contributors need pnpm and the build commands.

## Development

Use the normal workspace commands:

```bash
pnpm install
pnpm dev
pnpm --filter @justflows/server test
pnpm --filter @justflows/server build
```

The admin client and SSR builds deliberately use separate Vite configurations.
The browser build is split into stable React vendor, admin-page, and visual
builder chunks. Keep large feature families in those explicit chunk groups so
the client does not regress to a single monolithic bundle; the SSR renderer
remains one Node entry because it must synchronously render every admin route.
Universal components must not read `window`, `document`, `navigator`, or
`localStorage` during render. Browser-only work belongs in effects, event
handlers, or the client entry. New initial GET requests must be added to the
route-aware prefetch list in `apps/server/src/lib/admin-ssr.ts` or replaced with
a server loader, and should have an SSR test.
