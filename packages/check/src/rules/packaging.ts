// SPDX-License-Identifier: MIT

import { ARCHIVE_LIMITS } from "@justflows/installer";
import type { FindingInput, Rule } from "../types.js";
import { finding } from "./util.js";

const NATIVE_FILE = /\.(?:node|so|dylib|dll|exe|bin|wasm)$/i;
const MAGIC: ReadonlyArray<{ bytes: number[]; what: string }> = [
  { bytes: [0x7f, 0x45, 0x4c, 0x46], what: "Linux executable (ELF)" },
  { bytes: [0x4d, 0x5a], what: "Windows executable" },
  { bytes: [0xcf, 0xfa, 0xed, 0xfe], what: "macOS executable (Mach-O)" },
  { bytes: [0xca, 0xfe, 0xba, 0xbe], what: "macOS universal binary" },
];
const CODE = /\.(?:[cm]?js|css)$/;

export const packagingRules: Rule[] = [
  {
    id: "JF-K001",
    title: "The package stays within the installer's limits",
    category: "packaging",
    severity: "error",
    check: (target) => {
      const total = target.files.reduce((sum, file) => sum + file.size, 0);
      const out: FindingInput[] = [];
      if (total > ARCHIVE_LIMITS.maxExpandedBytes) out.push(finding(`Unpacked size ${(total / 1024 / 1024).toFixed(1)} MB exceeds the ${ARCHIVE_LIMITS.maxExpandedBytes / 1024 / 1024} MB install limit`));
      if (target.files.length > ARCHIVE_LIMITS.maxFileCount) out.push(finding(`${target.files.length} files exceed the ${ARCHIVE_LIMITS.maxFileCount}-file install limit`));
      return out;
    },
  },
  {
    id: "JF-K002",
    title: "No native binaries",
    category: "packaging",
    severity: "error",
    check: (target) =>
      target.files.flatMap((file) => {
        if (NATIVE_FILE.test(file.path)) return [finding("Native binaries are not allowed in packages", file.path)];
        if (file.size < 4 || file.size > 64 * 1024 * 1024) return [];
        const head = file.read().subarray(0, 4);
        const kind = MAGIC.find(({ bytes }) => bytes.every((byte, index) => head[index] === byte));
        return kind ? [finding(`This is a ${kind.what}; native binaries are not allowed`, file.path)] : [];
      }),
  },
  {
    id: "JF-K003",
    title: "No source maps in a built package",
    category: "packaging",
    severity: "warning",
    check: (target) => {
      if (target.mode !== "package") return [];
      return [
        ...target.files.filter((file) => file.path.endsWith(".map")).map((file) => finding("Source map in the package; it publishes your original source", file.path)),
        ...target.files
          .filter((file) => CODE.test(file.path) && /[#@] sourceMappingURL=data:/.test(file.text()))
          .map((file) => finding("Inline source map in the package", file.path)),
      ];
    },
  },
  {
    id: "JF-K004",
    title: "No development files or dependencies in a built package",
    category: "packaging",
    severity: "warning",
    check: (target) => {
      if (target.mode !== "package") return [];
      const out: FindingInput[] = [];
      const modules = target.files.filter((file) => file.path.startsWith("node_modules/") || file.path.includes("/node_modules/"));
      if (modules.length) out.push(finding(`${modules.length} files under node_modules; bundle what you need instead of shipping dependencies`, modules[0]!.path));
      for (const file of target.files) {
        if (/(^|\/)(\.git|\.github|\.vscode|\.idea|coverage|\.turbo)\//.test(file.path) || /(^|\/)(\.DS_Store|Thumbs\.db)$/.test(file.path)) {
          out.push(finding("Development file in the package", file.path));
        }
      }
      return out.slice(0, 50);
    },
  },
];
