// SPDX-License-Identifier: MIT

import {
  PLACEHOLDER_KIND_RE,
  PlaceholderDefinitionSchema,
  type PlaceholderDefinition,
  type PlaceholderHtmlOptions,
  type PlaceholderImage,
} from "@justflows/sdk";

export interface RegisteredPlaceholder extends PlaceholderDefinition {
  kind: string;
  pluginId: string;
}

/**
 * Placeholder images plugins ship for their own kinds. Mirrors
 * `PluginCookieRegistry`: the host owns one instance, plugins write through
 * `ctx.media.registerPlaceholder`, and a plugin's entries go on deactivate.
 */
export class PluginPlaceholderRegistry {
  private readonly byKind = new Map<string, RegisteredPlaceholder>();

  register(pluginId: string, kind: string, input: PlaceholderDefinition): () => void {
    if (!PLACEHOLDER_KIND_RE.test(kind) || !kind.startsWith(`${pluginId}.`)) {
      throw new Error(
        `Plugin "${pluginId}" can only register placeholder kinds under its own namespace ("${pluginId}.<name>")`,
      );
    }
    const parsed = PlaceholderDefinitionSchema.safeParse(input);
    if (!parsed.success) {
      throw new Error(
        `Plugin "${pluginId}" registered an invalid placeholder: ${parsed.error.issues[0]?.message ?? "bad shape"}`,
      );
    }
    const existing = this.byKind.get(kind);
    if (existing && existing.pluginId !== pluginId) {
      throw new Error(`Placeholder kind "${kind}" is already registered`);
    }
    const entry: RegisteredPlaceholder = { ...parsed.data, kind, pluginId };
    this.byKind.set(kind, entry);
    return () => {
      if (this.byKind.get(kind) === entry) this.byKind.delete(kind);
    };
  }

  get(kind: string): RegisteredPlaceholder | undefined {
    return this.byKind.get(kind);
  }

  all(): RegisteredPlaceholder[] {
    return [...this.byKind.values()];
  }

  removePlugin(pluginId: string): void {
    for (const [kind, entry] of this.byKind) {
      if (entry.pluginId === pluginId) this.byKind.delete(kind);
    }
  }
}

function escAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** A resolved placeholder as a decorative `<img>`. */
export function placeholderImgHtml(
  image: PlaceholderImage,
  options: PlaceholderHtmlOptions = {},
): string {
  const kindClass = image.kind.replace(/[^a-z0-9-]/g, "-");
  const extra = (options.className ?? "").trim();
  const cls = `jf-placeholder jf-placeholder--${kindClass}${extra ? ` ${extra}` : ""}`;
  return [
    `<img class="${escAttr(cls)}"`,
    ` src="${escAttr(image.src)}"`,
    ` alt="${escAttr(options.alt ?? "")}"`,
    ` width="${image.width}" height="${image.height}"`,
    ` loading="${options.loading ?? "lazy"}" decoding="async"`,
    ` data-jf-placeholder="${escAttr(image.kind)}">`,
  ].join("");
}
