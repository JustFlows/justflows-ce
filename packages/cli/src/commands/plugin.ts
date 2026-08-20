import { apiGet, apiPost } from "../api.js";
import fs from "node:fs/promises";

interface Plugin { id: string; name: string; version: string; status: string; }

export async function pluginCommand(args: string[]): Promise<void> {
  const [sub, ...rest] = args;

  switch (sub) {
    case "list": {
      const data = await apiGet<{ plugins: Plugin[] }>("/api/plugins");
      if (!data.plugins.length) { console.log("No plugins installed."); return; }
      console.log(`${"ID".padEnd(35)} ${"Name".padEnd(30)} ${"Version".padEnd(10)} Status`);
      console.log("─".repeat(90));
      for (const p of data.plugins) {
        console.log(`${p.id.padEnd(35)} ${p.name.padEnd(30)} ${p.version.padEnd(10)} ${p.status}`);
      }
      break;
    }

    case "install": {
      const filePath = rest[0];
      if (!filePath) { console.error("Usage: justflows plugin install <path>"); process.exitCode = 1; return; }
      const buf = await fs.readFile(filePath);
      const form = new FormData();
      form.append("file", new Blob([buf]), filePath.split("/").pop());
      const res = await fetch(`${process.env.ADMIN_URL ?? "http://localhost:3001"}/api/plugins`, { method: "POST", body: form });
      const data = await res.json() as { plugin?: Plugin; error?: string };
      if (!res.ok) { console.error(`Failed: ${data.error}`); process.exitCode = 1; return; }
      console.log(`✓ Installed: ${data.plugin?.name} v${data.plugin?.version}`);
      break;
    }

    case "activate": {
      const id = rest[0];
      if (!id) { console.error("Usage: justflows plugin activate <id>"); process.exitCode = 1; return; }
      await apiPost(`/api/plugins/${encodeURIComponent(id)}/activate`, {});
      console.log(`✓ Activated plugin: ${id}`);
      break;
    }

    case "deactivate": {
      const id = rest[0];
      if (!id) { console.error("Usage: justflows plugin deactivate <id>"); process.exitCode = 1; return; }
      await apiPost(`/api/plugins/${encodeURIComponent(id)}/deactivate`, {});
      console.log(`✓ Deactivated plugin: ${id}`);
      break;
    }

    default:
      console.log("Usage: justflows plugin <list|install|activate|deactivate>");
  }
}
