// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from "vitest";
import { sendWithPermissionApproval } from "../../src/lib/plugin-permission-approval";

function refusal() {
  return new Response(
    JSON.stringify({
      error: "Needs approval",
      code: "permission_approval_required",
      name: "Forms",
      permissions: ["files:private"],
    }),
    { status: 409 },
  );
}

describe("sendWithPermissionApproval", () => {
  it("does not ask when the server accepts the package", async () => {
    const send = vi.fn(async () => new Response("{}", { status: 200 }));
    const ask = vi.fn(() => true);
    const res = await sendWithPermissionApproval(send, ask, 1000);
    expect(res.status).toBe(200);
    expect(ask).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("retries with exactly the permissions the administrator approved", async () => {
    const send = vi.fn<(approved: string[] | undefined, signal: AbortSignal) => Promise<Response>>();
    send.mockResolvedValueOnce(refusal()).mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const ask = vi.fn(() => true);
    const res = await sendWithPermissionApproval(send, ask, 1000);
    expect(ask).toHaveBeenCalledWith("Forms", ["files:private"]);
    expect(send.mock.calls[0]?.[0]).toBeUndefined();
    expect(send.mock.calls[1]?.[0]).toEqual(["files:private"]);
    expect(res.status).toBe(200);
  });

  it("does not retry when the administrator declines", async () => {
    const send = vi.fn(async () => refusal());
    const res = await sendWithPermissionApproval(send, () => false, 1000);
    expect(res.status).toBe(409);
    expect(send).toHaveBeenCalledTimes(1);
    await expect(res.json()).resolves.toMatchObject({ error: "Needs approval" });
  });

  it("leaves other conflicts for the caller", async () => {
    const send = vi.fn(async () => new Response(JSON.stringify({ error: "Busy" }), { status: 409 }));
    const ask = vi.fn(() => true);
    await sendWithPermissionApproval(send, ask, 1000);
    expect(ask).not.toHaveBeenCalled();
  });
});
