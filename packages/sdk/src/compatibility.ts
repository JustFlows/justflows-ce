// SPDX-License-Identifier: MIT

import { z } from "zod";

/** Host requirements shared by plugin, theme, and CSS-provider manifests. */
export const ExtensionEnginesSchema = z.object({
  justflows: z.string().min(1),
});

export type ExtensionEngines = z.infer<typeof ExtensionEnginesSchema>;
