import type { PluginModule, PluginContext } from "@justflows/sdk";
import { pluginShouldDeleteData } from "@justflows/sdk";
import { registerConsentStyles } from "./styles.js";
import { registerRoutes } from "./http.js";
import { buildHeadHtml } from "./head.js";
import { gateEmbedsInHtml, gateScriptMarkup } from "./gating.js";
import { textFor } from "./config.js";
import { getCachedConfig, refreshConfig, siteHost } from "./state.js";

const consent: PluginModule = {
  manifest: {
    id: "justflows.consent",
    name: "Cookie Consent",
    version: "1.0.0",
    description:
      "First-party cookie consent banner, preference center, and script/embed gating. No third-party dependency; all storage is first-party.",
    author: "Justflows Team",
    license: "GPL-2.0-or-later",
    engines: { justflows: ">=0.1.8-dev.1 <0.2.0" },
    permissions: ["admin:extend"],
    main: "index.js",
    adminMenu: [
      {
        id: "consent",
        label: "Cookie Consent",
        labelKey: "nav.consent",
        path: "/admin/consent",
        icon: "🍪",
        domain: "extensions",
      },
    ],
    settingsSchema: {
      deleteDataOnUninstall: {
        type: "boolean",
        label: "Delete consent records when this plugin is removed",
        description: "When on, Admin → Plugins → Delete also erases every stored consent record.",
        default: false,
      },
    },
    registry: {
      commercialMarketplace: false,
      listed: true,
      free: true,
      comingSoon: false,
    },
  },

  async activate(ctx: PluginContext) {
    ctx.logger.info("Cookie Consent plugin activating");

    await refreshConfig(ctx);
    await registerConsentStyles(ctx);
    registerRoutes(ctx);

    // The plugin's own cookie, so it shows in its own disclosure table.
    ctx.cookies.declare({
      name: "jf_consent",
      category: "necessary",
      purpose: "Stores the visitor's cookie choices so the banner is not shown again.",
      duration: "12 months",
    });

    // 1. Inject the config island, pre-gated operator snippets, and the runtime.
    ctx.hooks.filter("html.head", (current) => {
      const extra = buildHeadHtml(getCachedConfig());
      return extra ? `${current}\n${extra}` : current;
    });

    // 2. Gate the platform-injected Google Tag behind the analytics category.
    ctx.hooks.filter("analytics.head", (markup) => {
      const config = getCachedConfig();
      if (!markup || !config.enabled || config.displayMode === "off") return markup;
      if (!config.categories.analytics) return markup;
      return gateScriptMarkup(markup, "analytics");
    });

    // 3. Replace off-site embeds in page content with an unlockable placeholder.
    //    Placeholder text is rendered in the default locale; the runtime
    //    re-localises it for the visitor on load.
    ctx.hooks.filter("content.render", (html) => {
      const config = getCachedConfig();
      if (!html || !config.enabled || config.displayMode === "off" || !config.gateEmbeds) {
        return html;
      }
      const text = textFor(config);
      return gateEmbedsInHtml(html, siteHost(), {
        title: text.embedNote,
        unlock: text.embedUnlockLabel,
      }).html;
    });

    await ctx.settings.set("activated", true);
    ctx.logger.info("Cookie Consent plugin activated");
  },

  deactivate(ctx: PluginContext) {
    // Registered hooks and routes are disposed by the host.
    ctx.logger.info("Cookie Consent plugin deactivated");
  },

  async deleteData(ctx: PluginContext) {
    if (await pluginShouldDeleteData(ctx, false)) {
      await ctx.data.clear();
      ctx.logger.info("Cookie Consent plugin deleteData: consent records cleared");
      return;
    }
    ctx.logger.info("Cookie Consent plugin deleteData: consent records kept (opt-in setting off)");
  },
};

export default consent;
