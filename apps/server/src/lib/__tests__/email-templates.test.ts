import { describe, expect, it } from "vitest";
import { DEFAULT_EMAIL_DESIGN, listEmailTemplateDefinitions, previewValues, renderEmailSource } from "../email-templates.js";

describe("system email templates", () => {
  it("publishes a typed core registry", () => {
    const definitions = listEmailTemplateDefinitions();
    expect(definitions.map((item) => item.key)).toContain("core.password-reset");
    expect(definitions.map((item) => item.key)).toContain("core.two-factor-disabled");
    expect(definitions.every((item) => item.variables.length > 0)).toBe(true);
  });

  it("escapes text variables and rejects unsafe action URLs", () => {
    const definition = listEmailTemplateDefinitions().find((item) => item.key === "core.password-reset")!;
    const output = renderEmailSource({ key: definition.key, values: { ...previewValues(definition), display_name: '<img src=x onerror="alert(1)">', action_url: "javascript:alert(1)" }, source: definition.defaults, design: DEFAULT_EMAIL_DESIGN });
    expect(output.html).not.toContain("<img src=x");
    expect(output.html).not.toContain("javascript:");
    expect(output.html).toContain("&lt;img");
  });

  it("reports unknown and missing variables before publication", () => {
    const definition = listEmailTemplateDefinitions().find((item) => item.key === "core.password-reset")!;
    const output = renderEmailSource({ key: definition.key, values: {}, source: { ...definition.defaults, subject: "{{unknown}}" }, design: DEFAULT_EMAIL_DESIGN });
    expect(output.errors).toContain("Unknown variable: unknown");
    expect(output.errors).toContain("Missing required variable: site_name");
  });
});
