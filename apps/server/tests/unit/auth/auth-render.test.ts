// SPDX-License-Identifier: MIT
import { createBlockRegistrySync } from "@justflows/blocks";
import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({ usersCanRegister: false, passwordResetEnabled: true }));
vi.mock("../../../src/lib/settings/general-settings.js", () => ({ getGeneralSettings: async () => settings }));

const { renderAuthBlocks } = await import("../../../src/lib/auth/auth-render.js");

const registry = createBlockRegistrySync();
const block = (form: string, props: Record<string, unknown> = {}) => registry.renderNode({ type: "core.auth-form", props: { form, ...props } });

describe("renderAuthBlocks", () => {
  beforeEach(() => { settings.usersCanRegister = false; settings.passwordResetEnabled = true; });

  it.each([
    ["login", 'autocomplete="current-password"'],
    ["register", 'name="username"'],
    ["forgot-password", 'type="email"'],
    ["reset-password", 'name="confirm"'],
  ])("renders the %s form", async (form, marker) => {
    settings.usersCanRegister = true;
    const html = await renderAuthBlocks(block(form));
    expect(html).toContain(`data-jf-auth="${form}"`);
    expect(html).toContain(marker);
  });
  it.each(["login", "register", "forgot-password", "reset-password"])("never links to or names the admin on %s", async (form) => {
    settings.usersCanRegister = true;
    expect(await renderAuthBlocks(block(form))).not.toMatch(/admin/i);
  });
  it("links only to the flows the site has switched on", async () => {
    const html = await renderAuthBlocks(block("login"));
    expect(html).toContain('href="/forgot-password"');
    expect(html).not.toContain('href="/register"');
    settings.usersCanRegister = true;
    expect(await renderAuthBlocks(block("login", { showLinks: false }))).not.toContain("<a ");
  });
  it("shows a notice instead of a form for a flow that is switched off", async () => {
    settings.passwordResetEnabled = false;
    expect(await renderAuthBlocks(block("register"))).not.toContain("<form");
    expect(await renderAuthBlocks(block("forgot-password"))).not.toContain("<form");
  });
  it("renders a single form per page", async () => {
    expect((await renderAuthBlocks(block("login") + block("login"))).match(/<form/g)).toHaveLength(1);
  });
  it("leaves pages without the block untouched", async () => {
    expect(await renderAuthBlocks("<p>Hi</p>")).toBe("<p>Hi</p>");
  });
});
