// SPDX-License-Identifier: MIT

interface ReCaptchaV3 {
  ready(callback: () => void): void;
  execute(siteKey: string, options: { action: string }): Promise<string>;
}

declare global {
  interface Window {
    grecaptcha?: ReCaptchaV3;
  }
}

(function () {
  "use strict";

  document.querySelectorAll<HTMLFormElement>("form[data-jf-recaptcha-v3]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      if (form.dataset.jfCaptchaSubmitting === "1") return;

      event.preventDefault();
      const siteKey = form.dataset.sitekey || "";
      const action = form.dataset.action || "";
      const input = form.querySelector<HTMLInputElement>('input[name="g-recaptcha-response"]');

      function submitWithToken(token: string): void {
        if (input) input.value = token || "";
        form.dataset.jfCaptchaSubmitting = "1";
        form.requestSubmit();
      }

      if (!siteKey || !action || !input || !window.grecaptcha) {
        submitWithToken("");
        return;
      }

      try {
        window.grecaptcha.ready(() => {
          window
            .grecaptcha!.execute(siteKey, { action })
            .then(submitWithToken)
            .catch(() => submitWithToken(""));
        });
      } catch (_error) {
        submitWithToken("");
      }
    });
  });
})();

export {};
