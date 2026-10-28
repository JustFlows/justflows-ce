// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { defaultCaptchaAction } from "../../../src/lib/plugins/plugin-captcha.js";

describe("defaultCaptchaAction", () => {
  it("uses the last part of the plugin id", () => {
    expect(defaultCaptchaAction("justflows.helpdesk")).toBe("helpdesk");
    expect(defaultCaptchaAction("justflows.shared-files")).toBe("shared_files");
  });
});
