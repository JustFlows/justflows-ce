import { useRef } from "react";
import type { BlockDocument } from "./types";
import { downloadJson, parseThemeDesignJson, readJsonFile } from "./block-json";

interface BlockJsonToolsProps {
  blocks: BlockDocument;
  mods?: Record<string, unknown>;
  onImport: (blocks: BlockDocument, mods?: Record<string, unknown>) => void;
  exportFilename?: string;
  variant?: "bar" | "inline";
}

export default function BlockJsonTools({
  blocks,
  mods,
  onImport,
  exportFilename = "theme-design.json",
  variant = "bar",
}: BlockJsonToolsProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  function handleExport() {
    downloadJson(exportFilename, {
      version: 1,
      type: "justflows/theme-design",
      blocks: blocks.blocks,
      ...(mods ? { mods } : {}),
    });
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    try {
      const raw = await readJsonFile(file);
      const parsed = parseThemeDesignJson(raw);
      const replace =
        blocks.blocks.length === 0 ||
        window.confirm("Replace all blocks with the imported design? Cancel to append instead.");
      const imported = replace
        ? parsed.blocks
        : { version: 1 as const, blocks: [...blocks.blocks, ...parsed.blocks.blocks] };
      onImport(imported, parsed.mods);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
  }

  const btnClass = variant === "bar" ? "jf-btn jf-btn--onbar" : "jf-btn jf-btn--ghost";

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={handleFileChange}
      />
      <button type="button" className={btnClass} onClick={() => fileRef.current?.click()}>
        Import JSON
      </button>
      <button type="button" className={btnClass} onClick={handleExport}>
        Export JSON
      </button>
    </>
  );
}
