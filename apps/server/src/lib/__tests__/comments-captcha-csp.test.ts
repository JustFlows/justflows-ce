// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { withCaptchaCsp } from "../comments-captcha-csp.js";

describe("withCaptchaCsp", () => {
  it("allows the Google reCAPTCHA v2 script, frame, and connection hosts", () => {
    const csp = withCaptchaCsp(
      "default-src 'self'; script-src 'self'; frame-src 'self'; connect-src 'self'",
      "recaptcha",
    );

    expect(csp).toContain("script-src 'self' https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/");
    expect(csp).toContain(
      "frame-src 'self' https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/",
    );
    expect(csp).toContain("connect-src 'self' https://www.google.com/recaptcha/");
  });
});
