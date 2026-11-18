// SPDX-License-Identifier: MIT

import { checkAccessibility, type AccessibilityIssue, type AccessibilitySeverity } from "@justflows/blocks";
import { loadAdminCatalog } from "../i18n/admin-catalog.js";
import { createTranslator } from "../i18n/translate.js";
import { getRuntimeBlockRegistry } from "../rendering/runtime-blocks.js";

/**
 * The builder's accessibility checks for API callers and the assistant
 * (justflows-ce#313).
 *
 * Runs the same `checkAccessibility` as the builder's Checks tab, with the
 * same rule for blocks it cannot look inside (plugin and theme blocks, and
 * core types this server does not know), and words each issue with the
 * builder's own messages, so a document gets the same feedback wherever it
 * is edited.
 */

export interface AccessibilityReportIssue {
  code: AccessibilityIssue["code"];
  severity: AccessibilitySeverity;
  blockId: string;
  blockType: string;
  field?: string;
  message: string;
}

export interface AccessibilityReport {
  issues: AccessibilityReportIssue[];
  counts: Record<AccessibilitySeverity, number>;
  /** What the checks can and cannot tell, in the builder's words. */
  note: string;
}

const MESSAGE_KEYS: Record<AccessibilityIssue["code"], string> = {
  "image-alt": "builder.checks.imageAlt",
  "link-text": "builder.checks.linkText",
  "link-target": "builder.checks.linkTarget",
  "heading-empty": "builder.checks.headingEmpty",
  "heading-skip": "builder.checks.headingSkip",
  "heading-level-one": "builder.checks.headingLevelOne",
  contrast: "builder.checks.contrast",
  "contrast-unknown": "builder.checks.contrastUnknown",
  "hidden-on-mobile": "builder.checks.hiddenOnMobile",
  "reading-order": "builder.checks.readingOrder",
  "icon-label": "builder.checks.iconLabel",
  "table-header": "builder.checks.tableHeader",
  "content-unchecked": "builder.checks.contentUnchecked",
};

const SEVERITY_ORDER: AccessibilitySeverity[] = ["error", "warning", "unavailable"];

/**
 * Check a block document. `locale` picks the admin language of the messages
 * (English when it is not one of them).
 */
export async function accessibilityReport(blocks: unknown, locale = "en"): Promise<AccessibilityReport> {
  const registry = getRuntimeBlockRegistry();
  const found = checkAccessibility(Array.isArray(blocks) ? blocks : [], {
    isOpaqueType: (type) => !type.startsWith("core.") || !registry.get(type),
  });
  const code = locale.split(/[-_]/)[0]?.toLowerCase() ?? "en";
  const [catalog, english] = await Promise.all([loadAdminCatalog(code), code === "en" ? Promise.resolve(undefined) : loadAdminCatalog("en")]);
  const t = createTranslator(catalog, english);
  const message = (issue: AccessibilityIssue): string => {
    const params = Object.fromEntries(Object.entries(issue.params ?? {}).map(([k, v]) => [k, String(v)]));
    if (issue.code === "link-text" && issue.params?.item) return t("builder.checks.linkTextItem", params);
    return t(MESSAGE_KEYS[issue.code], params);
  };
  const issues = found
    .map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      blockId: issue.blockId,
      blockType: issue.type,
      ...(issue.field ? { field: issue.field } : {}),
      message: message(issue),
    }))
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  const counts = { error: 0, warning: 0, unavailable: 0 };
  for (const issue of issues) counts[issue.severity]++;
  return { issues, counts, note: t("builder.checks.disclaimer") };
}
