// SPDX-License-Identifier: MIT
import type { BlockDefinition } from "../registry/block-registry.js";

/**
 * A member's own data: what the site and its plugins hold about them, a
 * download of all of it, and a request to have it removed. Only hydrated on
 * private account pages; whether downloads and removal requests are offered
 * at all is a site setting the server enforces, so these switches can only
 * hide what the site allows, never offer what it does not.
 */
export const accountDataBlock: BlockDefinition = {
  type: "core.account-data", version: 1, title: "Your data", icon: "⇩", category: "content",
  description: "Lets a signed-in member see, download, and ask to remove their data. Only rendered on private account pages.",
  schema: {
    showSummary: { type: "boolean", default: true, label: "Show what is stored", help: "Lists how many records the site and each plugin hold about the member." },
    showDownload: { type: "boolean", default: true, label: "Offer a download", help: "Shown only when downloads are turned on under Users → Data requests." },
    showRemoval: { type: "boolean", default: true, label: "Offer a removal request", help: "Shown only when removal requests are turned on under Users → Data requests." },
  },
  validateProps: raw => {
    const props = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    return { showSummary: props["showSummary"] !== false, showDownload: props["showDownload"] !== false, showRemoval: props["showRemoval"] !== false };
  },
  render: props => `<div class="jf-account jf-account-data" data-jf-account-data="1" data-summary="${props["showSummary"] !== false}" data-download="${props["showDownload"] !== false}" data-removal="${props["showRemoval"] !== false}">Your data</div>`,
};
