import fs from "node:fs";
import path from "node:path";
import { apiGet, apiPost } from "../api.js";

interface Theme {
  id: string;
  name: string;
  version: string;
  status: string;
}

interface TemplateSlot {
  slug: string;
  inTheme: boolean;
  customised: boolean;
  hasDraft: boolean;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;

function scaffoldTheme(slug: string): void {
  if (!SLUG_RE.test(slug)) {
    console.error(`Invalid theme slug: ${slug} (use lowercase letters, digits, hyphens)`);
    process.exitCode = 1;
    return;
  }
  const root = path.resolve(process.cwd(), "themes", slug);
  if (fs.existsSync(root)) {
    console.error(`Already exists: ${root}`);
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(path.join(root, "templates"), { recursive: true });
  fs.mkdirSync(path.join(root, "parts"), { recursive: true });
  fs.mkdirSync(path.join(root, "styles"), { recursive: true });

  const id = `local.${slug}`;
  fs.writeFileSync(
    path.join(root, "justflows-theme.json"),
    `${JSON.stringify(
      {
        id,
        name: slug.replace(/(^|-)([a-z])/g, (_m, _s, c: string) => ` ${c.toUpperCase()}`).trim(),
        version: "0.1.0",
        description: "A Justflows theme.",
        license: "GPL-2.0-or-later",
        engines: { justflows: ">=0.1.8 <0.2.0" },
        styles: ["styles/global.css"],
        templates: {
          index: "./templates/index.json",
          single: "./templates/single.json",
          page: "./templates/page.json",
        },
        parts: { footer: "./parts/footer.json" },
      },
      null,
      2,
    )}\n`,
  );

  const doc = (title: string, blocks: unknown[]) =>
    `${JSON.stringify({ title, blocks }, null, 2)}\n`;
  const b = (type: string, props: Record<string, unknown> = {}) => ({
    id: `${type.replace(/[^a-z]/g, "")}-1`,
    type,
    version: 1,
    props,
  });

  fs.writeFileSync(
    path.join(root, "templates", "index.json"),
    doc("Index", [
      b("core.post-title", { level: 1 }),
      b("core.post-meta"),
      b("core.post-content", { wrap: "post" }),
    ]),
  );
  fs.writeFileSync(
    path.join(root, "templates", "single.json"),
    doc("Single post", [
      b("core.post-title", { level: 1 }),
      b("core.post-meta"),
      b("core.post-excerpt"),
      b("core.post-content", { wrap: "post" }),
    ]),
  );
  fs.writeFileSync(
    path.join(root, "templates", "page.json"),
    doc("Page", [b("core.post-content", { wrap: "page" })]),
  );
  fs.writeFileSync(
    path.join(root, "parts", "footer.json"),
    doc("Footer", [b("core.html", { html: "<p>© Your site</p>" })]),
  );
  fs.writeFileSync(
    path.join(root, "styles", "global.css"),
    `:root {\n  --color-primary: #2563eb;\n  --color-text: #0f172a;\n  --color-bg: #ffffff;\n  --max-width: 720px;\n}\n\n.site-main { max-width: var(--max-width); margin: 0 auto; padding: 2rem 1.5rem 4rem; }\n`,
  );

  console.log(`✓ Scaffolded theme "${slug}" at ${root}`);
  console.log(
    `  Next: copy it under your install's themes/ (id: ${id}), then "justflows theme activate ${id}".`,
  );
}

export async function themeCommand(args: string[]): Promise<void> {
  const [sub, ...rest] = args;

  switch (sub) {
    case "list": {
      const data = await apiGet<{ themes: Theme[] }>("/api/themes");
      if (!data.themes.length) {
        console.log("No themes installed.");
        return;
      }
      for (const t of data.themes) {
        const active = t.status === "active" ? " [active]" : "";
        console.log(`  ${t.name} v${t.version} (${t.id})${active}`);
      }
      break;
    }

    case "activate": {
      const id = rest[0];
      if (!id) {
        console.error("Usage: justflows theme activate <id>");
        process.exitCode = 1;
        return;
      }
      await apiPost(`/api/themes/${encodeURIComponent(id)}/activate`, {});
      console.log(`✓ Theme activated: ${id}`);
      break;
    }

    case "templates": {
      const data = await apiGet<{ themeId?: string; slots?: TemplateSlot[]; creatable?: string[] }>(
        "/api/templates",
      );
      const slots = data.slots ?? [];
      if (data.themeId) console.log(`Active theme: ${data.themeId}`);
      if (!slots.length) {
        console.log("No template files in the active theme.");
      } else {
        for (const s of slots) {
          const tags = [
            s.inTheme ? "theme" : null,
            s.customised ? "customised" : null,
            s.hasDraft ? "draft" : null,
          ]
            .filter(Boolean)
            .join(", ");
          console.log(`  ${s.slug.padEnd(24)} ${tags}`);
        }
      }
      if (data.creatable?.length) {
        console.log(`\nAvailable slots to add: ${data.creatable.join(", ")}`);
      }
      break;
    }

    case "scaffold": {
      const slug = rest[0];
      if (!slug) {
        console.error("Usage: justflows theme scaffold <slug>");
        process.exitCode = 1;
        return;
      }
      scaffoldTheme(slug);
      break;
    }

    default:
      console.log("Usage: justflows theme <list|activate|templates|scaffold>");
  }
}
