// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from "vitest";

let installed: { manifest: Record<string, unknown> } | null = null;

vi.mock("../../../src/lib/plugins/plugins-db.js", () => ({
  getPlugin: async () => installed,
}));

const {
  addedPluginPermissions,
  approvedPermissionsDetail,
  assertPluginPermissionsApproved,
  PluginPermissionApprovalError,
} = await import("../../../src/lib/plugins/plugin-permission-approval.js");

const update = { id: "acme.forms", name: "Forms", permissions: ["content:read", "files:private"] };

beforeEach(() => {
  installed = { manifest: { permissions: ["content:read"] } };
});

describe("addedPluginPermissions", () => {
  it("lists only permissions the installed version did not declare", () => {
    expect(addedPluginPermissions({ permissions: ["a"] }, { permissions: ["a", "b", "b"] })).toEqual(["b"]);
  });

  it("treats removed permissions as no change", () => {
    expect(addedPluginPermissions({ permissions: ["a", "b"] }, { permissions: ["a"] })).toEqual([]);
  });

  it("treats a malformed installed manifest as declaring nothing", () => {
    expect(addedPluginPermissions({ permissions: "a" }, { permissions: ["a"] })).toEqual(["a"]);
    expect(addedPluginPermissions(null, { permissions: [1, "a"] })).toEqual(["a"]);
  });
});

describe("assertPluginPermissionsApproved", () => {
  it("passes a first install, which has nothing to compare with", async () => {
    installed = null;
    await expect(assertPluginPermissionsApproved("site-1", update)).resolves.toEqual([]);
  });

  it("passes an update with no new permissions", async () => {
    installed = { manifest: { permissions: update.permissions } };
    await expect(assertPluginPermissionsApproved("site-1", update)).resolves.toEqual([]);
  });

  it("refuses an unapproved addition and names it", async () => {
    const error = await assertPluginPermissionsApproved("site-1", update).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(PluginPermissionApprovalError);
    expect(error).toMatchObject({ pluginName: "Forms", permissions: ["files:private"] });
  });

  it("refuses when approval covers only some additions", async () => {
    const wider = { ...update, permissions: ["content:read", "files:private", "platform:network"] };
    await expect(assertPluginPermissionsApproved("site-1", wider, ["files:private"])).rejects.toMatchObject({
      permissions: ["files:private", "platform:network"],
    });
  });

  it("does not accept an approval for a different permission", async () => {
    await expect(assertPluginPermissionsApproved("site-1", update, ["jobs:register"])).rejects.toBeInstanceOf(
      PluginPermissionApprovalError,
    );
  });

  it("returns the approved additions for the audit log", async () => {
    await expect(assertPluginPermissionsApproved("site-1", update, ["files:private"])).resolves.toEqual([
      "files:private",
    ]);
  });
});

describe("approvedPermissionsDetail", () => {
  it("keeps untrusted manifest text on one line", () => {
    expect(approvedPermissionsDetail(["a\nforged entry"])).toBe("added: a forged entry");
  });
});
