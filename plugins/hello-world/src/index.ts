import type { PluginModule, PluginContext } from "@justflows/sdk";

let dispose: (() => void) | undefined;

const helloWorld: PluginModule = {
  manifest: {
    id: "justflows.hello-world",
    name: "Hello World",
    version: "1.0.0",
    description: "The official example plugin that demonstrates the Justflows plugin lifecycle.",
    author: "Justflows Team",
    license: "GPL-2.0-or-later",
    permissions: [],
    main: "index.js",
  },

  async activate(ctx: PluginContext) {
    ctx.logger.info("Hello World plugin activating");

    dispose = ctx.hooks.action("content.published", async (event) => {
      ctx.logger.info("Hello World: content was published", {
        event: event as Record<string, unknown>,
      });
    });

    await ctx.settings.set("activated", true);
    ctx.logger.info("Hello World plugin activated");
  },

  async deactivate(ctx: PluginContext) {
    dispose?.();
    dispose = undefined;
    ctx.logger.info("Hello World plugin deactivated");
  },
};

export default helloWorld;
