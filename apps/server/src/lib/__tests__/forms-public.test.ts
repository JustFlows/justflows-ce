// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const commentSettings = {
  enabled: true,
  requireModeration: true,
  closeAfterDays: 0,
  allowUrls: true,
  notifyModerator: false,
  maxLength: 5000,
  threadMaxDepth: 6,
  pageSize: 50,
  captchaProvider: "none" as
    | "none"
    | "turnstile"
    | "hcaptcha"
    | "recaptcha"
    | "recaptcha-v3",
  captchaSiteKey: "",
  captchaScoreThreshold: 0.5,
  captchaSecretKey: "",
};

vi.mock("../themes-db.js", () => ({ getSiteId: async () => "site-1" }));
vi.mock("../plugins-db.js", () => ({ getPlugin: async () => ({ status: "active" }) }));
vi.mock("../plugin-kv.js", () => ({ getPluginSetting: async () => undefined }));
vi.mock("../comments-settings.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../comments-settings.js")>();
  return { ...actual, getCommentSettings: async () => ({ ...commentSettings }) };
});
vi.mock("../general-settings.js", () => ({
  getGeneralSettings: async () => ({ adminEmail: "" }),
}));
vi.mock("../mail.js", () => ({ sendMail: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("../runtime-blocks.js", () => ({
  getRuntimeBlockRegistry: () => ({ get: () => undefined, register: vi.fn(), unregister: vi.fn() }),
}));

/** The stored "contact" form. `data.captcha` is flipped per test. */
const CONTACT_FORM = {
  id: "contact",
  updatedAt: "2026-01-01T00:00:00.000Z",
  data: {
    name: "Contact",
    title: "Contact us",
    submitLabel: "Send",
    successMessage: "Thanks.",
    captcha: false,
    fields: [
      { id: "name", name: "name", label: "Name", type: "text", required: true },
      { id: "email", name: "email", label: "Email", type: "email", required: true },
      { id: "message", name: "message", label: "Message", type: "textarea", required: true },
    ],
  },
};

const put = vi.fn().mockResolvedValue(undefined);
vi.mock("../plugin-data.js", () => ({
  createPluginDataApi: () => ({
    list: async () => [CONTACT_FORM],
    get: async (_collection: string, id: string) => (id === "contact" ? CONTACT_FORM : undefined),
    put,
    delete: vi.fn(),
  }),
}));

import { acceptFormSubmission, renderFormBlockHtml } from "../forms-public.js";
import { resetRateLimits } from "../rate-limit.js";

function submission(extra: Record<string, unknown> = {}) {
  return {
    body: { formId: "contact", name: "Jo", email: "jo@example.com", message: "hi", ...extra },
    referer: "https://example.com/contact",
    clientIp: "203.0.113.9",
  };
}

beforeEach(() => {
  put.mockClear();
  resetRateLimits();
  CONTACT_FORM.data.captcha = false;
  Object.assign(commentSettings, {
    captchaProvider: "none",
    captchaSiteKey: "",
    captchaSecretKey: "",
    captchaScoreThreshold: 0.5,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("forms CAPTCHA", () => {
  it("renders no widget when the form has not opted in", async () => {
    commentSettings.captchaProvider = "turnstile";
    commentSettings.captchaSiteKey = "public-key";
    const html = await renderFormBlockHtml({ formId: "contact" });
    expect(html).not.toContain("cf-turnstile");
  });

  it("renders no widget when the form opts in but the shared provider is None", async () => {
    CONTACT_FORM.data.captcha = true;
    const html = await renderFormBlockHtml({ formId: "contact" });
    expect(html).not.toContain("cf-turnstile");
    expect(html).not.toContain("data-jf-recaptcha-v3");
  });

  it("renders the configured Turnstile widget when the form opts in", async () => {
    CONTACT_FORM.data.captcha = true;
    commentSettings.captchaProvider = "turnstile";
    commentSettings.captchaSiteKey = "public-key";
    const html = await renderFormBlockHtml({ formId: "contact" });
    expect(html).toContain('class="cf-turnstile jf-form__captcha" data-sitekey="public-key"');
    expect(html).toContain("https://challenges.cloudflare.com/turnstile/v0/api.js");
  });

  it("wires the reCAPTCHA v3 token flow with the form-specific action", async () => {
    CONTACT_FORM.data.captcha = true;
    commentSettings.captchaProvider = "recaptcha-v3";
    commentSettings.captchaSiteKey = "v3-key";
    const html = await renderFormBlockHtml({ formId: "contact" });
    expect(html).toContain('data-jf-recaptcha-v3 data-sitekey="v3-key" data-action="justflows_form_submit"');
    expect(html).toContain('name="g-recaptcha-response"');
    expect(html).toContain('src="/js/recaptcha-v3.js"');
  });

  it("rejects a submission whose token does not verify", async () => {
    CONTACT_FORM.data.captcha = true;
    commentSettings.captchaProvider = "turnstile";
    commentSettings.captchaSiteKey = "public-key";
    commentSettings.captchaSecretKey = "secret";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: false }) }));

    const res = await acceptFormSubmission(submission({ "cf-turnstile-response": "bad" }));

    expect(res.status).toBe(400);
    expect(res.error).toMatch(/captcha/i);
    expect(put).not.toHaveBeenCalled();
  });

  it("accepts a submission whose token verifies", async () => {
    CONTACT_FORM.data.captcha = true;
    commentSettings.captchaProvider = "turnstile";
    commentSettings.captchaSiteKey = "public-key";
    commentSettings.captchaSecretKey = "secret";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal("fetch", fetchMock);

    const res = await acceptFormSubmission(submission({ "cf-turnstile-response": "good" }));

    expect(res.status).toBe(303);
    expect(put).toHaveBeenCalledWith("submissions", expect.any(String), expect.objectContaining({ formId: "contact" }));
    const body = fetchMock.mock.calls[0]?.[1] as { body: URLSearchParams };
    expect(body.body.get("secret")).toBe("secret");
    expect(body.body.get("response")).toBe("good");
  });

  it("does not verify a token for a form that has not opted in", async () => {
    commentSettings.captchaProvider = "turnstile";
    commentSettings.captchaSiteKey = "public-key";
    commentSettings.captchaSecretKey = "secret";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await acceptFormSubmission(submission({ "cf-turnstile-response": "whatever" }));

    expect(res.status).toBe(303);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(put).toHaveBeenCalled();
  });

  it("keeps the honeypot ahead of the CAPTCHA check", async () => {
    CONTACT_FORM.data.captcha = true;
    commentSettings.captchaProvider = "turnstile";
    commentSettings.captchaSiteKey = "public-key";
    commentSettings.captchaSecretKey = "secret";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await acceptFormSubmission(submission({ _gotcha: "i am a bot" }));

    expect(res.status).toBe(303);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
});
