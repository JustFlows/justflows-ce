// SPDX-License-Identifier: MIT

import { TemplateDocSchema } from "@justflows/sdk";
import type { FindingInput, Rule } from "../types.js";
import { filesMatching, finding, lineOf } from "./util.js";

const COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(|\boklch\s*\(/g;

/** A CSS declaration that is not a custom property and holds a literal color. */
function hardCodedColors(css: string): number[] {
  const lines: number[] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));
  for (const match of text.matchAll(/(^|[;{\s])([a-z-]+)\s*:\s*([^;{}]+)/gi)) {
    const property = match[2] ?? "";
    const value = match[3] ?? "";
    if (property.startsWith("--")) continue;
    COLOR.lastIndex = 0;
    if (COLOR.test(value.replace(/var\([^)]*\)/g, ""))) lines.push(lineOf(text, match.index ?? 0));
  }
  return lines;
}

export const themeRules: Rule[] = [
  {
    id: "JF-T001",
    title: "The theme has the index template",
    category: "theme",
    severity: "error",
    types: ["theme"],
    check: (target) => (target.files.some((file) => file.path === "templates/index.json") ? [] : [finding("templates/index.json is missing; it is the fallback for every page")]),
  },
  {
    id: "JF-T002",
    title: "Templates and parts are valid block documents",
    category: "theme",
    severity: "error",
    types: ["theme"],
    check: (target) =>
      filesMatching(target, /^(templates|parts|patterns)\/[^/]+\.json$/).flatMap((file): FindingInput[] => {
        let value: unknown;
        try {
          value = JSON.parse(file.text());
        } catch (error) {
          return [finding(`Not valid JSON: ${error instanceof Error ? error.message : String(error)}`, file.path)];
        }
        if (file.path.startsWith("patterns/")) return [];
        const parsed = TemplateDocSchema.safeParse(value);
        return parsed.success ? [] : [finding(`Not a block document: ${parsed.error.issues[0]?.message ?? "invalid"}`, file.path)];
      }),
  },
  {
    id: "JF-T003",
    title: "Colors come from design tokens",
    category: "theme",
    severity: "warning",
    types: ["theme", "css-provider"],
    check: (target) =>
      filesMatching(target, /\.css$/).flatMap((file) => {
        const lines = hardCodedColors(file.text());
        return lines.length
          ? [finding(`${lines.length} declaration${lines.length === 1 ? "" : "s"} with a literal color; use var(--color-…) tokens so the customizer and dark mode apply`, file.path, lines[0])]
          : [];
      }),
  },
  {
    id: "JF-T004",
    title: "Keyboard focus stays visible",
    category: "accessibility",
    severity: "warning",
    types: ["theme", "css-provider"],
    check: (target) =>
      filesMatching(target, /\.css$/).flatMap((file): FindingInput[] => {
        const text = file.text().replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));
        const out: FindingInput[] = [];
        for (const match of text.matchAll(/([^{}]*):focus(?!-visible|-within)[^{]*\{([^}]*)\}/g)) {
          if (!/outline\s*:\s*(?:none|0)\b/.test(match[2] ?? "")) continue;
          const selector = (match[1] ?? "").trim().split(",").pop()?.trim() ?? "";
          const replaced = selector && text.includes(`${selector}:focus-visible`);
          if (!replaced && !/box-shadow|border/.test(match[2] ?? "")) {
            out.push(finding("Removes the focus outline with no visible replacement; keyboard users cannot see where they are", file.path, lineOf(text, (match.index ?? 0) + (match[1]?.length ?? 0))));
          }
        }
        return out;
      }),
  },
  {
    id: "JF-T005",
    title: "No color-scheme flash on first paint",
    category: "theme",
    severity: "warning",
    types: ["theme"],
    check: (target) =>
      filesMatching(target, /\.(?:[cm]?js)$/).flatMap((file) => {
        const text = file.text();
        const match = /document\.documentElement\.(?:classList\.(?:add|toggle|remove)\s*\(\s*["'](?:dark|light)|dataset\.(?:theme|colorScheme)\s*=|setAttribute\s*\(\s*["']data-(?:theme|color-scheme))/.exec(text);
        return match
          ? [finding("Sets the color scheme from a script after the page loads, which flashes the wrong colors; use prefers-color-scheme in CSS", file.path, lineOf(text, match.index))]
          : [];
      }),
  },
];
