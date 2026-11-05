// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import {
  classifyTrustedProxy,
  trustedProxyValue,
} from "../../../src/lib/security/trusted-proxy.js";

describe("trusted proxy configuration", () => {
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

  it.each(["true", "1", "2"])("rejects spoofable proxy trust setting %s", (value) => {
    expect(classifyTrustedProxy(value).mode).toBe("wide");
    expect(() => trustedProxyValue(value)).toThrow(/explicit proxy addresses\/subnets/);
  });
});
