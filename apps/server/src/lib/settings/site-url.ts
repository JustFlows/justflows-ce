// SPDX-License-Identifier: MIT

import { z } from "zod";

/**
 * The site's public address.
 *
 * The install wizard validated this and POST /api/settings did not, though the
 * value ends up in the same place: process.env.APP_URL, which decides the
 * `secure` flag on the session cookie outside production, forms the origin in
 * outbound mail, and anchors canonical URLs and the sitemap.
 */
export const SiteUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }, "Site URL must be a full http:// or https:// address");
