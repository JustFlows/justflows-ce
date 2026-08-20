# Justflows

**The open-source platform for building the web.**

Justflows is a self-hostable website and content platform. A non-technical user installs it through a browser wizard — no terminal, no npm, no compilation. A TypeScript developer gets a stable, typed SDK and plugin API.

---

## How to install

There are three paths depending on your situation.

---

### Option A — Docker (easiest, recommended for most people)

**What you need:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed on your computer or server. That's it.

**Steps:**

1. Get the project files:
   - [Download the latest release](https://github.com/JustFlows/justflows-ce/releases/latest), or
   - Clone this repository
2. Unzip or open the project folder
3. Open the unzipped folder
4. Copy `.env.production.example` to `.env` and open it in any text editor
5. Set your domain (`APP_URL`) and a secret key (`APP_SECRET`)
6. Open a terminal in that folder and run:

```
docker compose -f docker/docker-compose.yml --env-file .env up
```

7. Open **http://localhost:3000/install** in your browser
8. The setup wizard walks you through the rest — database, site name, admin account

> **No terminal after step 6.** Everything from the install wizard onwards is done in the browser, exactly like WordPress.

**On a VPS / server:** same steps, just run `docker compose up -d` (the `-d` keeps it running in the background).

---

### Option B — Shared hosting / cPanel

If your host provides Node.js (Hostinger, SiteGround, A2 Hosting etc.):

1. Download the latest release (or export this repo) and unzip it
2. Upload the folder to your server via cPanel File Manager or FTP
3. In cPanel, go to **Node.js** → create a new application pointing at the folder
4. In the terminal tab of cPanel, run:

```
npm run setup
```

5. Open your domain in a browser — the install wizard starts automatically

---

### Option C — Developers (full source)

```bash
# Prerequisites: Node.js ≥ 22, pnpm ≥ 11, PostgreSQL/MySQL/MariaDB

git clone https://github.com/JustFlows/justflows-ce
cd justflows-ce
pnpm install
cp .env.example .env
# Edit .env: set DATABASE_DRIVER, DATABASE_URL, APP_URL, APP_SECRET
pnpm --filter @justflows/server dev
# → open http://localhost:3000/install
```

---

## Choosing a database

Justflows works with any of these — you do not need to know SQL:

| Database | When to use it |
|---|---|
| **PostgreSQL** *(default)* | Best choice for new installs. Included automatically in Docker. |
| **MySQL 8+** | Use this if your host already provides MySQL |
| **MariaDB 10.6+** | Use this if your host already provides MariaDB |

When using Docker you do not need to install or configure a database yourself — it is set up automatically.

To use MySQL or MariaDB with Docker:
```bash
# MySQL
docker compose -f docker/docker-compose.mysql.yml --env-file .env up

# MariaDB
docker compose -f docker/docker-compose.mariadb.yml --env-file .env up
```

---

## Installing plugins and themes

Once your site is running, open the Admin → **Plugins** or **Themes** page. You will see a drag-and-drop upload area. Download any `.jfpkg` package file and drop it there — exactly like WordPress. No terminal, no npm.

---

## What you can do

| Feature | Where |
|---|---|
| Write posts and pages | Admin → Content |
| Upload images and files | Admin → Media |
| Install plugins | Admin → Plugins → Upload .jfpkg |
| Change your theme | Admin → Themes → Upload .jfpkg → Activate |
| Manage users | Admin → Users |
| Update everything | Admin → Updates |
| Change site settings | Admin → Settings |

---

## Project structure (for developers)

```
justflows/
├── apps/
│   └── server/         Unified Express app (API + admin SPA + public site)
│       ├── src/        Express server, routes, lib, EJS views
│       └── admin-ui/   Vite + React admin dashboard
├── packages/
│   ├── core/           App lifecycle, hooks, config, logging, health
│   ├── database/       SQL schema + PostgreSQL/MySQL/MariaDB client
│   ├── sdk/            Stable public API for plugin/theme developers
│   ├── auth/           Password hashing, sessions, capabilities
│   ├── content/        Content service + revisions
│   ├── blocks/         Block registry + 11 core block types
│   ├── media/          Upload, storage adapters, image derivatives
│   ├── installer/      .jfpkg archive extractor + manifest validation
│   ├── updater/        Update lifecycle + rollback
│   └── plugin-api/     Plugin loader and runtime
├── plugins/            Write your plugin here (one folder per plugin)
│   └── hello-world/    Example — copy this folder to start
└── docker/             Docker Compose variants (Postgres, MySQL, MariaDB)
```

---

## Plugin development

Create a folder under [`plugins/`](plugins/) and start there. That is the
developer workspace: the pnpm workspace includes `plugins/*`, and the server
scans this directory when you run from source.

```bash
cp -R plugins/hello-world plugins/acme-seo
# edit plugins/acme-seo/package.json name, justflows.json, and src/index.ts
pnpm --filter acme.seo build
```

Copy [`plugins/hello-world`](plugins/hello-world). Give the plugin a namespaced
id (`acme.seo`). Import types from `@justflows/sdk`. Build to `dist/index.js` —
the runtime does not load TypeScript.

```typescript
// plugins/acme-seo/src/index.ts
import type { PluginModule } from "@justflows/sdk";

const myPlugin: PluginModule = {
  manifest: {
    id: "acme.seo",
    name: "Acme SEO",
    version: "1.0.0",
    permissions: [],
    main: "index.js",
  },

  async activate(ctx) {
    ctx.hooks.action("content.published", async (event) => {
      ctx.logger.info("A post was published!", { event });
    });
  },
};

export default myPlugin;
```

Site owners install a finished plugin as a `.jfpkg` in Admin → Plugins. They
do not add folders to `plugins/`. See [`plugins/README.md`](plugins/README.md).

---

## License

MIT

## Security note

- Never commit real `.env` files, credentials, or API keys.
- Only commit example files such as `.env.example`.
