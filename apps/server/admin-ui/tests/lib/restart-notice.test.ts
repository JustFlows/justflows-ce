// SPDX-License-Identifier: MIT
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { manualRestartKey, serviceUnitName } from "../../src/lib/restart-notice.js";

describe("manual restart notice", () => {
  it("names the systemd unit and keeps Plesk for Passenger only", () => {
    expect(serviceUnitName("justflows.service")).toBe("justflows");
    expect(serviceUnitName("user@1000.service")).toBe("user@1000");
    expect(serviceUnitName(undefined)).toBe("justflows");
    expect(serviceUnitName("not a unit")).toBe("justflows");

    expect(manualRestartKey("tools", "body", "systemd")).toBe("tools.manualRestartBodySystemd");
    expect(manualRestartKey("tools", "log", "passenger")).toBe("tools.manualRestartNeededLogPassenger");
    expect(manualRestartKey("updates", "body", "kubernetes")).toBe("updates.manualRestartBodyContainer");
    expect(manualRestartKey("updates", "log")).toBe("updates.log.manualRestartNeeded");
  });
});
