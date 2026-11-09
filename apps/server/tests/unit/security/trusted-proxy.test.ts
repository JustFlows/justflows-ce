// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyTrustedProxy,
  trustedProxyValue,
} from "../../../src/lib/security/trusted-proxy.js";

describe("trusted proxy configuration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to a bounded same-host proxy", () => {
    expect(classifyTrustedProxy(undefined)).toEqual({ mode: "bounded", value: "loopback" });
    expect(trustedProxyValue(undefined)).toBe("loopback");
  });

  it.each([undefined, "loopback", "10.0.0.0/8", "127.0.0.1, 10.0.0.0/8"])(
    "accepts an explicit proxy boundary: %s",
    (value) => expect(() => trustedProxyValue(value)).not.toThrow(),
  );

  it.each(["", "false", "0"])("supports direct Node with %s", (value) => {
    expect(trustedProxyValue(value)).toBe(false);
  });

  it.each(["true", "1", "2"])("ignores spoofable proxy trust setting %s without failing boot", (value) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(classifyTrustedProxy(value).mode).toBe("wide");
    expect(trustedProxyValue(value)).toBe("loopback");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`TRUST_PROXY=${value}`));
  });
});
