// SPDX-License-Identifier: MIT

import type { PluginCaptchaApi } from "@justflows/sdk";
import { getCommentSettings } from "../comments/comments-settings.js";
import { CAPTCHA_META, verifyCaptcha } from "../security/captcha.js";

/** The Discussion CAPTCHA, for any plugin. The secret stays in this process. */
export function createPluginCaptchaApi(): PluginCaptchaApi {
  return {
    async config() {
      const settings = await getCommentSettings();
      if (settings.captchaProvider === "none" || !settings.captchaSiteKey) return null;
      const meta = CAPTCHA_META[settings.captchaProvider];
      return {
        provider: settings.captchaProvider,
        siteKey: settings.captchaSiteKey,
        field: meta.field,
        scriptSrc: meta.scriptSrc,
        widgetClass: meta.widgetClass,
      };
    },
    async verify(token, action = "helpdesk", ip = "") {
      const settings = await getCommentSettings();
      if (settings.captchaProvider === "none" || !settings.captchaSecretKey) return false;
      return verifyCaptcha(settings.captchaProvider, settings.captchaSecretKey, token, ip, {
        expectedAction: action,
        scoreThreshold: settings.captchaScoreThreshold,
      });
    },
  };
}
