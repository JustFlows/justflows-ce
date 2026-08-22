import axe from "axe-core";
import { expect } from "vitest";

/** jsdom cannot compute real contrast; that is covered by admin CSS tokens. */
const JSDOM_AXE_OPTIONS: axe.RunOptions = {
  rules: {
    "color-contrast": { enabled: false },
  },
};

export async function expectNoCriticalAxe(container: HTMLElement): Promise<void> {
  const results = await axe.run(container, JSDOM_AXE_OPTIONS);
  const blocking = results.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
  expect(blocking, formatViolations(blocking)).toEqual([]);
}

function formatViolations(violations: axe.Result[]): string {
  if (violations.length === 0) return "";
  return violations
    .map((violation) => {
      const nodes = violation.nodes.map((node) => node.html).join("\n");
      return `${violation.id} (${violation.impact}): ${violation.help}\n${nodes}`;
    })
    .join("\n\n");
}
