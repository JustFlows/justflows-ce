// SPDX-License-Identifier: MIT

(function () {
  "use strict";

  document.querySelectorAll("form[data-jf-recaptcha-v3]").forEach(function (form) {
    form.addEventListener("submit", function (event) {
      if (form.dataset.jfCaptchaSubmitting === "1") return;

      event.preventDefault();
      var siteKey = form.dataset.sitekey || "";
      var action = form.dataset.action || "";
      var input = form.querySelector('input[name="g-recaptcha-response"]');

      function submitWithToken(token) {
        if (input) input.value = token || "";
        form.dataset.jfCaptchaSubmitting = "1";
        form.requestSubmit();
      }

      if (!siteKey || !action || !input || !window.grecaptcha) {
        submitWithToken("");
        return;
      }

      try {
        window.grecaptcha.ready(function () {
          window.grecaptcha.execute(siteKey, { action: action }).then(submitWithToken).catch(function () {
            submitWithToken("");
          });
        });
      } catch (_error) {
        submitWithToken("");
      }
    });
  });
})();
