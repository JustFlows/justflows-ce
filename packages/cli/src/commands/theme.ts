import { apiGet, apiPost } from "../api.js";

interface Theme { id: string; name: string; version: string; status: string; }

export async function themeCommand(args: string[]): Promise<void> {
  const [sub, ...rest] = args;

  switch (sub) {
    case "list": {
      const data = await apiGet<{ themes: Theme[] }>("/api/themes");
      if (!data.themes.length) { console.log("No themes installed."); return; }
      for (const t of data.themes) {
        const active = t.status === "active" ? " [active]" : "";
        console.log(`  ${t.name} v${t.version} (${t.id})${active}`);
      }
      break;
    }

    case "activate": {
      const id = rest[0];
      if (!id) { console.error("Usage: justflows theme activate <id>"); process.exitCode = 1; return; }
      await apiPost(`/api/themes/${encodeURIComponent(id)}/activate`, {});
      console.log(`✓ Theme activated: ${id}`);
      break;
    }

    default:
      console.log("Usage: justflows theme <list|activate>");
  }
}
