import { useEffect, useRef, useState } from "react";
import {
  NO_HEADER_REF,
  SITE_DEFAULT_HEADER_REF,
  type HeaderTemplateOptionDTO,
  type SiteHeaderOptionDTO,
} from "../../lib/page-header";

/**
 * Per-page header picker. The header itself is built in Theme builder → Header;
 * a page only chooses which library entry (or the site default, or none) it
 * renders. The choice persists on its own the moment it changes — it is page
 * chrome config, not part of the draftable blocks/Save flow.
 */
export default function HeaderRefField({
  contentId,
  value,
  onChange,
  compact = false,
}: {
  contentId: string;
  value: string;
  onChange?: (ref: string) => void;
  compact?: boolean;
}) {
  const [items, setItems] = useState<SiteHeaderOptionDTO[]>([]);
  const [templates, setTemplates] = useState<HeaderTemplateOptionDTO[]>([]);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [current, setCurrent] = useState(value);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setCurrent(value), [value]);

  useEffect(() => {
    let alive = true;
    fetch("/api/headers/options")
      .then((r) => r.json())
      .then(
        (body: {
          defaultId?: string | null;
          items?: SiteHeaderOptionDTO[];
          templates?: HeaderTemplateOptionDTO[];
        }) => {
          if (!alive) return;
          setItems(body.items ?? []);
          setTemplates(body.templates ?? []);
          setDefaultId(body.defaultId ?? null);
        },
      )
      .catch(() => {
        if (alive) setItems([]);
      });
    return () => {
      alive = false;
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  async function choose(ref: string) {
    setCurrent(ref);
    onChange?.(ref);
    setState("saving");
    try {
      const res = await fetch(`/api/content/${contentId}/header-ref`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref }),
      });
      if (!res.ok) throw new Error();
      setState("saved");
    } catch {
      setState("error");
    }
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setState("idle"), 1800);
  }

  const defaultName = items.find((i) => i.id === defaultId)?.name;
  const ownEntries = items.filter((i) => i.id !== defaultId);
  const select = (
    <select
      className={compact ? "jf-editor__select" : "jf-input"}
      value={current}
      onChange={(e) => void choose(e.target.value)}
      aria-label="Header for this page"
    >
      <option value={SITE_DEFAULT_HEADER_REF}>
        Site default{defaultName ? ` — ${defaultName}` : ""}
      </option>
      {ownEntries.length > 0 && (
        <optgroup label="Your headers">
          {ownEntries.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </optgroup>
      )}
      {templates.length > 0 && (
        <optgroup label="From plugins">
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.source ? ` (${t.source})` : ""}
            </option>
          ))}
        </optgroup>
      )}
      <option value={NO_HEADER_REF}>None</option>
    </select>
  );

  if (compact) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
        {select}
        {state === "saving" && <span className="jf-editor__status">Saving…</span>}
        {state === "saved" && <span className="jf-editor__status jf-editor__status--ok">✓</span>}
        {state === "error" && <span className="jf-editor__status jf-editor__status--error">Failed</span>}
      </span>
    );
  }

  return (
    <div className="jf-field">
      <label className="jf-field__label">Header</label>
      {select}
      <p className="jf-field__hint">
        {state === "saving"
          ? "Saving…"
          : state === "saved"
            ? "Saved."
            : state === "error"
              ? "Could not save — try again."
              : (
                <>
                  Applies right away. Build headers in{" "}
                  <a href="/admin/themes/customize" target="_blank" rel="noopener noreferrer">
                    Theme builder → Header
                  </a>
                  .
                </>
              )}
      </p>
    </div>
  );
}
