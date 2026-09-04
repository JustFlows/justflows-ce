// SPDX-License-Identifier: MIT

import { getJfRoot } from "./jf-root.js";
import { MANAGED_SENTINEL, writeManagedFile } from "./managed-config.js";

/**
 * Site-root `.htaccess`, written once at install and refreshed on upgrade.
 *
 * On shared hosting the vhost `DocumentRoot` is usually the Justflows install
 * root itself, so without this file Apache would happily serve `/.env`,
 * `/package.json`, `/data/justflows.db`, or `/apps/server/src/...` as plain
 * static files before Passenger / the proxy ever sees the request. This is the
 * WordPress-style hardening `.htaccess` for that directory — it blocks direct
 * access to the app's own files and sets baseline security headers. Routing
 * requests to the Node app stays the vhost's job (Passenger, a reverse proxy),
 * exactly as before.
 *
 * It is distinct from the `.htaccess` the static-export writes inside
 * `STATIC_EXPORT_DIR`, which serves the published pages.
 */
export const ROOT_HTACCESS_FILE = ".htaccess";

const ROOT_HTACCESS_SENTINEL = `${MANAGED_SENTINEL} — site-root hardening.`;

export function renderRootHtaccess(): string {
  return `${ROOT_HTACCESS_SENTINEL}
# Managed block — refreshed on install / upgrade while the line above is intact.
# Change or remove that line, or delete the file, to keep hand edits.
#
# This file only blocks direct HTTP access to the application's own files.
# Routing requests to the Node app is host-specific (Phusion Passenger, a
# reverse proxy, …) and belongs in the vhost, not here.

# No directory listing. Remove this line if Apache reports "Options not allowed
# here" (the vhost's AllowOverride does not grant Options).
Options -Indexes

<IfModule mod_rewrite.c>
  RewriteEngine On

  # The rules below only fire when the request maps to a real file or directory,
  # so a CMS page whose slug happens to be "src" or "tests" still reaches the app.
  RewriteCond %{REQUEST_FILENAME} -f [OR]
  RewriteCond %{REQUEST_FILENAME} -d

  # Internal directories — never reachable over HTTP.
  RewriteRule ^(?:apps|packages|scripts|node_modules|data|prisma|migrations|src|dist|build|coverage|test|tests|__tests__|\\.git|\\.github|\\.cache|\\.next|tmp|log|logs|backup|backups|install-token)(?:/|$) - [F,L]

  # Individual project / server files at any depth.
  RewriteCond %{REQUEST_FILENAME} -f
  RewriteRule (?:^|/)(?:server\\.js|ecosystem\\.config\\.js|Dockerfile|docker-compose\\.ya?ml|Makefile|Procfile|pnpm-lock\\.yaml|yarn\\.lock|package(?:-lock)?\\.json|tsconfig(?:\\.[\\w-]+)?\\.json|turbo\\.json|vite\\.config\\.[jt]s|CHANGELOG\\.md|README\\.md)$ - [F,L]

  # Hand everything else to the Node app. A module that already serves non-file
  # requests (Passenger) needs nothing here. For a reverse proxy, enable
  # mod_proxy and uncomment the next line (then remove the sentinel line above):
  # RewriteRule ^ http://127.0.0.1:3000%{REQUEST_URI} [P,L]
</IfModule>

# Dotfiles (.env, .git, .htpasswd, …) and source / config / data / backup files.
<FilesMatch "^\\.|\\.(?:bak|cjs|conf|config|cts|dist|env|ini|key|pem|crt|log|lock|map|mjs|mts|orig|save|sh|sql|sqlite|sqlite3|swp|swo|tmp|ts|tsx|yaml|yml)$|~$">
  Require all denied
</FilesMatch>
# …but these must stay public.
<FilesMatch "^(?:robots\\.txt|sitemap\\.xml|favicon\\.ico|site\\.webmanifest|manifest\\.webmanifest|ads\\.txt|humans\\.txt)$">
  Require all granted
</FilesMatch>

# No server-side script execution in the document root (defence in depth).
<FilesMatch "\\.(?:php[0-9]?|phtml|phar|pl|py|cgi|lua|rb|asp|aspx|jsp)$">
  Require all denied
</FilesMatch>
<IfModule mod_mime.c>
  RemoveHandler .php .phtml .phar .pl .py .cgi .lua .rb
  RemoveType .php .phtml .phar
</IfModule>

<IfModule mod_headers.c>
  Header always set X-Content-Type-Options "nosniff"
  Header always set X-Frame-Options "SAMEORIGIN"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
  Header always set X-Powered-By "Justflows"
  Header always unset X-Pingback
  # HTTPS only — uncomment once every hostname for this site serves HTTPS:
  # Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
</IfModule>
`;
}

/**
 * Write the site-root `.htaccess`. Returns `"written"`, `"unchanged"`, or
 * `"kept-custom"` when a hand-edited file (sentinel line removed) is left alone.
 */
export function writeRootHtaccess(
  root: string = getJfRoot(),
): Promise<"written" | "unchanged" | "kept-custom"> {
  return writeManagedFile(root, ROOT_HTACCESS_FILE, renderRootHtaccess());
}
