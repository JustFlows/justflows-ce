import { useEffect, useRef, useState } from "react";
import type { BlockNode, BlockCatalogEntry } from "./types";
import { syncColumnCount } from "./block-defaults";
import AnimationPanel from "./AnimationPanel";
import BlockStylePanel from "./BlockStylePanel";
import BlockJsonPanel from "./BlockJsonPanel";
import GridPlacementPanel from "./GridPlacementPanel";
import BlockLayoutPanel from "./BlockLayoutPanel";
import ReusablePanel, { type ReusableItem } from "./ReusablePanel";
import { GRID_BLOCK_TYPE } from "./grid";

const GALLERY_LAYOUTS = ["grid", "masonry", "carousel", "slideshow", "list"] as const;
type GalleryLayoutValue = (typeof GALLERY_LAYOUTS)[number];

const fieldLabel: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
  fontSize: "0.8rem",
  fontWeight: 600,
  color: "var(--jf-text-2)",
  marginBottom: "0.75rem",
};

const fieldInput: React.CSSProperties = {
  padding: "0.4rem 0.6rem",
  border: "1px solid var(--jf-border-strong)",
  borderRadius: 5,
  fontSize: "0.875rem",
  fontFamily: "inherit",
  width: "100%",
  boxSizing: "border-box",
};

interface BlockInspectorProps {
  block: BlockNode;
  catalogEntry?: BlockCatalogEntry;
  onChange: (props: Record<string, unknown>) => void;
  onSyncBlock?: (block: BlockNode) => void;
  /** Type of the block this one sits in, so grid children can be placed. */
  parentType?: string | null;
  /** Column count of the grid parent, when there is one. */
  parentColumns?: number;
  reusable?: ReusableItem[];
  onReloadReusable?: () => void;
  onConvertToReusable?: (ref: string) => void;
}

export default function BlockInspector({
  block,
  catalogEntry,
  onChange,
  onSyncBlock,
  parentType = null,
  parentColumns = 12,
  reusable = [],
  onReloadReusable,
  onConvertToReusable,
}: BlockInspectorProps) {
  const p = block.props;
  const set = (key: string, val: unknown) => {
    const next = { ...p, [key]: val };
    onChange(next);
    if (block.type === "core.columns" && key === "columns") {
      onSyncBlock?.(syncColumnCount({ ...block, props: next }));
    }
  };

  const textArea = (key: string, label: string, rows = 3) => (
    <label style={fieldLabel}>
      {label}
      <textarea rows={rows} style={fieldInput} value={(p[key] as string) ?? ""} onChange={(e) => set(key, e.target.value)} />
    </label>
  );

  const textInput = (key: string, label: string, placeholder = "") => (
    <label style={fieldLabel}>
      {label}
      <input type="text" style={fieldInput} placeholder={placeholder} value={(p[key] as string) ?? ""} onChange={(e) => set(key, e.target.value)} />
    </label>
  );

  const select = (key: string, label: string, options: { value: string; label: string }[]) => (
    <label style={fieldLabel}>
      {label}
      <select style={fieldInput} value={String(p[key] ?? options[0]?.value)} onChange={(e) => set(key, e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );

  let fields: React.ReactNode;

  switch (block.type) {
    case "core.section":
      fields = <>
        {select("background", "Background", [
          { value: "default", label: "Default" },
          { value: "muted", label: "Muted" },
          { value: "primary", label: "Primary tint" },
          { value: "dark", label: "Dark" },
          { value: "gradient", label: "Gradient" },
        ])}
        {select("padding", "Padding", [
          { value: "sm", label: "Small" },
          { value: "md", label: "Medium" },
          { value: "lg", label: "Large" },
          { value: "xl", label: "Extra large" },
        ])}
        {select("align", "Alignment", [
          { value: "left", label: "Left" },
          { value: "center", label: "Center" },
        ])}
      </>;
      break;

    case "core.container":
      fields = select("width", "Width", [
        { value: "narrow", label: "Narrow" },
        { value: "default", label: "Default" },
        { value: "wide", label: "Wide" },
        { value: "full", label: "Full" },
      ]);
      break;

    case "core.columns":
      fields = <>
        <label style={fieldLabel}>Columns
          <input type="number" style={fieldInput} min={2} max={4} value={(p.columns as number) ?? 2} onChange={(e) => set("columns", Number(e.target.value))} />
        </label>
        {select("gap", "Gap", [
          { value: "sm", label: "Small" },
          { value: "md", label: "Medium" },
          { value: "lg", label: "Large" },
        ])}
      </>;
      break;

    case "core.hero":
      fields = <>
        {textInput("heading", "Heading")}
        {textArea("subheading", "Subheading", 2)}
        {textInput("buttonLabel", "Button label")}
        {textInput("buttonUrl", "Button URL", "https://")}
        {textInput("backgroundImage", "Background image URL")}
        {select("align", "Alignment", [
          { value: "left", label: "Left" },
          { value: "center", label: "Center" },
        ])}
      </>;
      break;

    case "core.features":
      fields = <FeaturesEditor items={(p.items as FeatureItem[]) ?? []} heading={(p.heading as string) ?? ""} columns={(p.columns as number) ?? 3} onChange={onChange} p={p} />;
      break;

    case "core.cta":
      fields = <>
        {textInput("heading", "Heading")}
        {textArea("text", "Text", 2)}
        {textInput("buttonLabel", "Button label")}
        {textInput("buttonUrl", "Button URL")}
        {select("variant", "Style", [
          { value: "primary", label: "Primary" },
          { value: "dark", label: "Dark" },
        ])}
      </>;
      break;

    case "core.paragraph": fields = textArea("text", "Text", 5); break;
    case "core.heading":
      fields = <>
        {textInput("text", "Heading text")}
        <label style={fieldLabel}>Level
          <select style={fieldInput} value={(p.level as number) ?? 2} onChange={(e) => set("level", Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>H{n}</option>)}
          </select>
        </label>
      </>;
      break;
    case "core.image":
      fields = <>
        {textInput("src", "Image URL")}
        {textInput("alt", "Alt text")}
        {textInput("caption", "Caption")}
      </>;
      break;
    case "core.quote":
      fields = <>{textArea("text", "Quote", 3)}{textInput("attribution", "Attribution")}</>;
      break;
    case "core.button":
      fields = <>
        {textInput("label", "Label")}
        {textInput("url", "URL")}
        {select("variant", "Variant", [
          { value: "primary", label: "Primary" },
          { value: "secondary", label: "Secondary" },
          { value: "outline", label: "Outline" },
        ])}
      </>;
      break;
    case "core.spacer":
      fields = (
        <label style={fieldLabel}>Height (px)
          <input type="number" style={fieldInput} min={8} max={500} value={(p.height as number) ?? 40} onChange={(e) => set("height", Number(e.target.value))} />
        </label>
      );
      break;
    case "core.code":
      fields = <>{textArea("code", "Code", 8)}{textInput("language", "Language")}</>;
      break;
    case "core.embed": fields = textInput("url", "URL"); break;
    case "core.html": fields = textArea("html", "HTML", 6); break;
    case "core.divider":
      fields = <p style={{ color: "var(--jf-text-3)", fontSize: "0.8rem", margin: 0 }}>No settings.</p>;
      break;
    case "core.color-scheme":
      fields = <>
        {select("style", "Style", [
          { value: "buttons", label: "Buttons" },
          { value: "icons", label: "Icons" },
        ])}
        {select("align", "Alignment", [
          { value: "left", label: "Left" },
          { value: "center", label: "Center" },
          { value: "right", label: "Right" },
        ])}
        <label style={{ ...fieldLabel, flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
          <input type="checkbox" checked={p.showSystem === true} onChange={(e) => set("showSystem", e.target.checked)} />
          Show an “Auto” option
        </label>
        <p style={{ color: "var(--jf-text-3)", fontSize: "0.8rem", margin: 0 }}>
          Visitors who have not chosen already follow their device setting. Auto lets them go back to it.
        </p>
      </>;
      break;
    case "core.language-switcher":
      fields = <>
        {select("style", "Style", [
          { value: "codes", label: "Language codes" },
          { value: "names", label: "Language names" },
        ])}
        {select("align", "Alignment", [
          { value: "left", label: "Left" },
          { value: "center", label: "Center" },
          { value: "right", label: "Right" },
        ])}
        <p style={{ color: "var(--jf-text-3)", fontSize: "0.8rem", margin: 0 }}>Shown when the site has more than one active language.</p>
      </>;
      break;
    case "core.auth-links":
      fields = <>
        <label style={{ ...fieldLabel, flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
          <input type="checkbox" checked={p.showLogin !== false} onChange={(e) => set("showLogin", e.target.checked)} />
          Show login
        </label>
        <label style={{ ...fieldLabel, flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
          <input type="checkbox" checked={p.showRegister !== false} onChange={(e) => set("showRegister", e.target.checked)} />
          Show register
        </label>
        {textInput("loginLabel", "Login label")}
        {textInput("registerLabel", "Register label")}
        {select("style", "Style", [
          { value: "buttons", label: "Buttons" },
          { value: "links", label: "Links" },
        ])}
        {select("align", "Alignment", [
          { value: "left", label: "Left" },
          { value: "center", label: "Center" },
          { value: "right", label: "Right" },
        ])}
        <p style={{ color: "var(--jf-text-3)", fontSize: "0.8rem", margin: 0 }}>
          Register is shown on the public site only when Settings → Anyone can register is on.
        </p>
      </>;
      break;
    case "core.group":
    case "core.column":
      fields = <p style={{ color: "var(--jf-text-3)", fontSize: "0.8rem", margin: 0 }}>Add content blocks inside this container.</p>;
      break;
    case "justflows.forms.form":
      fields = <FormBlockPicker formId={String(p.formId ?? "contact")} onChange={(formId) => set("formId", formId)} />;
      break;
    case "justflows.gallery.grid":
      fields = (
        <GalleryEditor
          items={(Array.isArray(p.items) ? p.items : []) as GalleryItem[]}
          layout={GALLERY_LAYOUTS.includes(p.layout as GalleryLayoutValue) ? (p.layout as GalleryLayoutValue) : "grid"}
          columns={Number(p.columns) || 3}
          lightbox={p.lightbox !== false}
          onChange={onChange}
          p={p}
        />
      );
      break;
    default:
      fields = <p style={{ color: "var(--jf-text-3)", fontSize: "0.8rem", margin: 0 }}>No settings for this block.</p>;
  }

  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: "0.75rem", color: "var(--jf-text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.75rem" }}>
        {catalogEntry?.icon} {catalogEntry?.title ?? block.type}
      </div>
      {fields}
      <AnimationPanel
        blockId={block.id}
        value={p.animation}
        onChange={(animation) => {
          if (!animation) {
            const next = { ...p };
            delete next.animation;
            onChange(next);
            return;
          }
          onChange({ ...p, animation });
        }}
      />
      {parentType === GRID_BLOCK_TYPE && (
        <GridPlacementPanel block={block} columns={parentColumns} onChange={onChange} />
      )}
      {onConvertToReusable && onReloadReusable && (
        <ReusablePanel
          block={block}
          items={reusable}
          onReload={onReloadReusable}
          onConvert={onConvertToReusable}
        />
      )}
      <BlockLayoutPanel block={block} onChange={onChange} />
      <BlockStylePanel block={block} onChange={onChange} />
      {onSyncBlock && <BlockJsonPanel key={block.id} block={block} onApply={onSyncBlock} />}
    </div>
  );
}

interface FeatureItem { icon: string; title: string; description: string }

function FeaturesEditor({ items, heading, columns, onChange, p }: {
  items: FeatureItem[];
  heading: string;
  columns: number;
  onChange: (props: Record<string, unknown>) => void;
  p: Record<string, unknown>;
}) {
  const [open, setOpen] = useState<number | null>(0);

  function updateItem(i: number, patch: Partial<FeatureItem>) {
    const next = items.map((item, idx) => (idx === i ? { ...item, ...patch } : item));
    onChange({ ...p, items: next });
  }

  function addItem() {
    onChange({ ...p, items: [...items, { icon: "✦", title: "New feature", description: "" }] });
    setOpen(items.length);
  }

  function removeItem(i: number) {
    onChange({ ...p, items: items.filter((_, idx) => idx !== i) });
  }

  return (
    <>
      <label style={fieldLabel}>Section heading
        <input type="text" style={fieldInput} value={heading} onChange={(e) => onChange({ ...p, heading: e.target.value })} />
      </label>
      <label style={fieldLabel}>Columns
        <input type="number" style={fieldInput} min={2} max={4} value={columns} onChange={(e) => onChange({ ...p, columns: Number(e.target.value) })} />
      </label>
      <div style={{ marginTop: "0.5rem" }}>
        {items.map((item, i) => (
          <div key={i} style={{ border: "1px solid var(--jf-border)", borderRadius: 6, marginBottom: "0.5rem", overflow: "hidden" }}>
            <button
              type="button"
              onClick={() => setOpen(open === i ? null : i)}
              style={{ width: "100%", padding: "0.5rem 0.75rem", background: "var(--jf-surface-2)", border: "none", textAlign: "left", fontWeight: 600, fontSize: "0.8rem", cursor: "pointer" }}
            >
              {item.icon} {item.title || `Feature ${i + 1}`}
            </button>
            {open === i && (
              <div style={{ padding: "0.75rem" }}>
                <label style={fieldLabel}>Icon
                  <input type="text" style={fieldInput} value={item.icon} onChange={(e) => updateItem(i, { icon: e.target.value })} />
                </label>
                <label style={fieldLabel}>Title
                  <input type="text" style={fieldInput} value={item.title} onChange={(e) => updateItem(i, { title: e.target.value })} />
                </label>
                <label style={fieldLabel}>Description
                  <textarea rows={2} style={fieldInput} value={item.description} onChange={(e) => updateItem(i, { description: e.target.value })} />
                </label>
                <button type="button" onClick={() => removeItem(i)} style={{ color: "var(--jf-danger)", background: "none", border: "none", fontSize: "0.75rem", cursor: "pointer" }}>Remove</button>
              </div>
            )}
          </div>
        ))}
        <button type="button" onClick={addItem} style={{ width: "100%", padding: "0.4rem", border: "1px dashed var(--jf-border-strong)", borderRadius: 5, background: "#fff", cursor: "pointer", fontSize: "0.8rem" }}>
          + Add feature
        </button>
      </div>
    </>
  );
}

function FormBlockPicker({ formId, onChange }: { formId: string; onChange: (formId: string) => void }) {
  const [forms, setForms] = useState<Array<{ id: string; name: string }>>([]);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    fetch("/api/forms")
      .then((r) => r.json())
      .then((body: { enabled?: boolean; forms?: Array<{ id: string; data?: { name?: string } }> }) => {
        setEnabled(body.enabled !== false);
        setForms((body.forms ?? []).map((form) => ({ id: form.id, name: form.data?.name ?? form.id })));
      })
      .catch(() => setForms([]));
  }, []);

  if (!enabled) {
    return <p style={{ color: "var(--jf-text-3)", fontSize: "0.8rem", margin: 0 }}>Install and keep the Forms plugin available to use this block.</p>;
  }

  return (
    <>
      <label style={fieldLabel}>
        Form
        <select style={fieldInput} value={formId} onChange={(e) => onChange(e.target.value)}>
          {forms.map((form) => (
            <option key={form.id} value={form.id}>{form.name}</option>
          ))}
        </select>
      </label>
      <p style={{ color: "var(--jf-text-3)", fontSize: "0.8rem", margin: 0 }}>
        Edit fields under Extensions → Forms.
      </p>
    </>
  );
}

interface GalleryItem { src: string; alt: string; caption: string }

function GalleryEditor({
  items,
  layout,
  columns,
  lightbox,
  onChange,
  p,
}: {
  items: GalleryItem[];
  layout: GalleryLayoutValue;
  columns: number;
  lightbox: boolean;
  onChange: (props: Record<string, unknown>) => void;
  p: Record<string, unknown>;
}) {
  const [library, setLibrary] = useState<Array<{ url: string; filename: string }>>([]);
  const [showLibrary, setShowLibrary] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  function emit(patch: Record<string, unknown>) {
    onChange({ ...p, items, layout, columns, lightbox, ...patch });
  }

  function loadLibrary() {
    setShowLibrary(true);
    fetch("/api/media?limit=80")
      .then((r) => r.json())
      .then((body: { items?: Array<{ url?: string; filename?: string; mime_type?: string; mimeType?: string }> }) => {
        const images = (body.items ?? []).filter((item) => {
          const mime = String(item.mimeType ?? item.mime_type ?? "");
          return mime.startsWith("image/") && item.url;
        });
        setLibrary(images.map((item) => ({ url: String(item.url), filename: String(item.filename ?? item.url) })));
      })
      .catch(() => setLibrary([]));
  }

  function addUrl(url: string) {
    if (!url) return;
    emit({ items: [...items, { src: url, alt: "", caption: "" }] });
  }

  async function uploadFiles(files: FileList) {
    setUploading(true);
    setUploadError("");
    const uploaded: GalleryItem[] = [];
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/media", { method: "POST", body: form });
        const data = (await res.json()) as { url?: string; error?: string };
        if (!res.ok || !data.url) throw new Error(data.error ?? "Upload failed");
        uploaded.push({ src: data.url, alt: "", caption: "" });
        setLibrary((prev) => [{ url: data.url as string, filename: file.name }, ...prev]);
      }
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e));
    } finally {
      if (uploaded.length) emit({ items: [...items, ...uploaded] });
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <>
      <label style={fieldLabel}>
        Layout
        <select style={fieldInput} value={layout} onChange={(e) => emit({ layout: e.target.value })}>
          <option value="grid">Grid</option>
          <option value="masonry">Masonry</option>
          <option value="carousel">Carousel</option>
          <option value="slideshow">Slideshow (fade)</option>
          <option value="list">List</option>
        </select>
      </label>
      {(layout === "grid" || layout === "masonry") && (
        <label style={fieldLabel}>
          Columns
          <input type="number" min={2} max={6} style={fieldInput} value={columns} onChange={(e) => emit({ columns: Number(e.target.value) })} />
        </label>
      )}
      {(layout === "carousel" || layout === "slideshow") && (
        <p style={{ color: "var(--jf-text-3)", fontSize: "0.8rem", margin: "0 0 0.75rem" }}>
          One image shown at a time, with dots to jump between them. Reorder images below to change the order.
        </p>
      )}
      <label style={{ ...fieldLabel, flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
        <input type="checkbox" checked={lightbox} onChange={(e) => emit({ lightbox: e.target.checked })} />
        Lightbox
      </label>

      {items.map((item, index) => (
        <div key={`${item.src}-${index}`} style={{ border: "1px solid var(--jf-border)", borderRadius: 6, padding: "0.6rem", marginBottom: "0.5rem" }}>
          {item.src ? (
            <img src={item.src} alt="" style={{ width: "100%", height: 72, objectFit: "cover", borderRadius: 4, marginBottom: "0.4rem" }} />
          ) : null}
          <input
            style={{ ...fieldInput, marginBottom: "0.35rem" }}
            placeholder="Image URL"
            value={item.src}
            onChange={(e) => emit({ items: items.map((row, i) => (i === index ? { ...row, src: e.target.value } : row)) })}
          />
          <input
            style={{ ...fieldInput, marginBottom: "0.35rem" }}
            placeholder="Alt text"
            value={item.alt}
            onChange={(e) => emit({ items: items.map((row, i) => (i === index ? { ...row, alt: e.target.value } : row)) })}
          />
          <input
            style={{ ...fieldInput, marginBottom: "0.35rem" }}
            placeholder="Caption"
            value={item.caption}
            onChange={(e) => emit({ items: items.map((row, i) => (i === index ? { ...row, caption: e.target.value } : row)) })}
          />
          <button type="button" onClick={() => emit({ items: items.filter((_, i) => i !== index) })} style={{ color: "var(--jf-danger)", background: "none", border: "none", fontSize: "0.75rem", cursor: "pointer" }}>
            Remove
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        style={{ width: "100%", padding: "0.4rem", border: "1px dashed var(--jf-border-strong)", borderRadius: 5, background: "#fff", cursor: uploading ? "default" : "pointer", fontSize: "0.8rem", marginBottom: "0.4rem" }}
      >
        {uploading ? "Uploading…" : "⇧ Upload from device"}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,image/avif,image/svg+xml"
        multiple
        hidden
        onChange={(e) => { if (e.target.files?.length) void uploadFiles(e.target.files); }}
      />
      {uploadError ? (
        <p style={{ color: "var(--jf-danger)", fontSize: "0.75rem", margin: "0 0 0.4rem" }}>{uploadError}</p>
      ) : null}
      <button type="button" onClick={() => addUrl("")} style={{ width: "100%", padding: "0.4rem", border: "1px dashed var(--jf-border-strong)", borderRadius: 5, background: "#fff", cursor: "pointer", fontSize: "0.8rem", marginBottom: "0.4rem" }}>
        + Add image URL
      </button>
      <button type="button" onClick={loadLibrary} style={{ width: "100%", padding: "0.4rem", border: "1px dashed var(--jf-border-strong)", borderRadius: 5, background: "#fff", cursor: "pointer", fontSize: "0.8rem" }}>
        Add from media library
      </button>
      {showLibrary && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.35rem", marginTop: "0.5rem", maxHeight: 180, overflow: "auto" }}>
          {library.length === 0 ? (
            <p style={{ color: "var(--jf-text-3)", fontSize: "0.75rem", gridColumn: "1 / -1" }}>No images in the media library yet.</p>
          ) : library.map((file) => (
            <button
              key={file.url}
              type="button"
              onClick={() => addUrl(file.url)}
              style={{ padding: 0, border: "1px solid var(--jf-border)", borderRadius: 4, overflow: "hidden", cursor: "pointer", background: "#fff" }}
              title={file.filename}
            >
              <img src={file.url} alt="" style={{ display: "block", width: "100%", height: 56, objectFit: "cover" }} />
            </button>
          ))}
        </div>
      )}
    </>
  );
}
