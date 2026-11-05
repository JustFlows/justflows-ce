// SPDX-License-Identifier: MIT

import type { Response } from "express";
import { PackageRejectedError } from "@justflows/installer";
import { describe, expect, it, vi } from "vitest";
import { sendPackageInstallError } from "../../../src/lib/extensions/package-install-error.js";
import { PluginPermissionApprovalError } from "../../../src/lib/plugins/plugin-permission-approval.js";

function response() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

describe("sendPackageInstallError", () => {
  it("answers a permission refusal with what needs approval", () => {
    const res = response();
    const cause = new PluginPermissionApprovalError("acme.forms", "Forms", ["files:private"]);
    sendPackageInstallError(res as unknown as Response, new PackageRejectedError(cause.message, cause));
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "permission_approval_required",
        name: "Forms",
        permissions: ["files:private"],
      }),
    );
  });

  it("keeps other refusals as a 400", () => {
    const res = response();
    sendPackageInstallError(res as unknown as Response, new PackageRejectedError("Not a plugin"));
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
