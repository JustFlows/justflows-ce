import type { BlockNode } from "./types";
import { sanitizeRichText } from "@justflows/blocks";

interface BlockPreviewProps {
  block: BlockNode;
  depth?: number;
  onSelect?: (id: string) => void;
  selectedId?: string | null;
  renderChildren?: (children: BlockNode[], depth: number) => React.ReactNode;
}

export function BlockPreview({ block, depth = 0, onSelect, selectedId, renderChildren }: BlockPreviewProps) {
  const p = block.props;
  const isSelected = selectedId === block.id;
  const wrap = (content: React.ReactNode, label?: string) => (
    <div
      onClick={onSelect ? (e) => { e.stopPropagation(); onSelect(block.id); } : undefined}
      style={{
        outline: isSelected ? "2px solid #3b82f6" : undefined,
        outlineOffset: 2,
        borderRadius: 4,
        cursor: onSelect ? "pointer" : undefined,
      }}
    >
      {label && depth === 0 ? null : null}
      {content}
    </div>
  );

  switch (block.type) {
    case "core.section": {
      const bgMap: Record<string, string> = {
        default: "#fff",
        muted: "#f8fafc",
        primary: "#eff6ff",
        dark: "#0f172a",
        gradient: "linear-gradient(135deg, #f8fafc 0%, #eff6ff 100%)",
      };
      const bg = bgMap[(p.background as string) ?? "default"] ?? "#fff";
      const padMap: Record<string, string> = { sm: "1rem", md: "2rem", lg: "3rem", xl: "4rem" };
      const padding = padMap[(p.padding as string) ?? "lg"] ?? "3rem";
      return wrap(
        <section style={{ background: bg, padding, color: p.background === "dark" ? "#fff" : undefined, textAlign: (p.align as string) === "center" ? "center" : "left" }}>
          {renderChildren?.(block.children ?? [], depth + 1) ?? (
            <div style={{ color: "#94a3b8", fontSize: "0.8rem", padding: "0.5rem" }}>Empty section — add blocks</div>
          )}
        </section>,
      );
    }

    case "core.container":
      return wrap(
        <div style={{ maxWidth: containerWidth(p.width as string), margin: "0 auto" }}>
          {renderChildren?.(block.children ?? [], depth + 1) ?? (
            <div style={{ color: "#94a3b8", fontSize: "0.8rem", padding: "0.5rem" }}>Empty container</div>
          )}
        </div>,
      );

    case "core.group":
      return wrap(<div>{renderChildren?.(block.children ?? [], depth + 1)}</div>);

    case "core.columns": {
      const cols = (p.columns as number) ?? 2;
      const gap = { sm: "0.75rem", md: "1.25rem", lg: "2rem" }[(p.gap as string) ?? "md"] ?? "1.25rem";
      return wrap(
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap }}>
          {renderChildren?.(block.children ?? [], depth + 1)}
        </div>,
      );
    }

    case "core.column":
      return wrap(
        <div style={{ minHeight: 48, border: depth > 0 ? "1px dashed #cbd5e1" : undefined, borderRadius: 6, padding: "0.5rem" }}>
          {block.children?.length
            ? renderChildren?.(block.children, depth + 1)
            : <div style={{ color: "#94a3b8", fontSize: "0.75rem" }}>Drop content here</div>}
        </div>,
      );

    case "core.hero":
      return wrap(
        <section style={{
          background: p.backgroundImage
            ? `linear-gradient(rgba(15,23,42,.55), rgba(15,23,42,.55)), url(${p.backgroundImage as string}) center/cover`
            : "linear-gradient(135deg, #f8fafc 0%, #eff6ff 100%)",
          padding: "4rem 2rem",
          textAlign: (p.align as string) === "center" ? "center" : "left",
          borderRadius: 8,
        }}>
          <h1 style={{ margin: "0 0 0.75rem", fontSize: "2rem", fontWeight: 900 }}>
            {(p.heading as string) || "Hero heading"}
          </h1>
          {(p.subheading as string) && <p style={{ margin: "0 0 1.5rem", color: "#64748b", maxWidth: 520 }}>{p.subheading as string}</p>}
          {(p.buttonLabel as string) && (
            <span style={{ display: "inline-block", padding: "0.6rem 1.25rem", background: "#3b82f6", color: "#fff", borderRadius: 6, fontWeight: 600, fontSize: "0.875rem" }}>
              {p.buttonLabel as string}
            </span>
          )}
        </section>,
      );

    case "core.features": {
      const items = (p.items as Array<{ icon: string; title: string; description: string }>) ?? [];
      const cols = (p.columns as number) ?? 3;
      return wrap(
        <section style={{ padding: "2rem 0" }}>
          {(p.heading as string) && <h2 style={{ textAlign: "center", marginBottom: "1.5rem" }}>{p.heading as string}</h2>}
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: "1.25rem" }}>
            {items.map((item, i) => (
              <div key={i} style={{ padding: "1.25rem", background: "#f8fafc", borderRadius: 8, textAlign: "center" }}>
                <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>{item.icon}</div>
                <h3 style={{ margin: "0 0 0.35rem", fontSize: "1rem" }}>{item.title || "Feature"}</h3>
                <p style={{ margin: 0, fontSize: "0.85rem", color: "#64748b" }}>{item.description}</p>
              </div>
            ))}
          </div>
        </section>,
      );
    }

    case "core.cta": {
      const dark = p.variant === "dark";
      return wrap(
        <section style={{
          padding: "3rem 2rem",
          background: dark ? "#0f172a" : "#eff6ff",
          color: dark ? "#fff" : "#0f172a",
          borderRadius: 8,
          textAlign: "center",
        }}>
          <h2 style={{ margin: "0 0 0.5rem" }}>{(p.heading as string) || "Call to action"}</h2>
          {(p.text as string) && <p style={{ margin: "0 0 1.25rem", opacity: 0.85 }}>{p.text as string}</p>}
          {(p.buttonLabel as string) && (
            <span style={{ display: "inline-block", padding: "0.6rem 1.25rem", background: "#3b82f6", color: "#fff", borderRadius: 6, fontWeight: 600 }}>
              {p.buttonLabel as string}
            </span>
          )}
        </section>,
      );
    }

    case "core.paragraph":
      return wrap(
        <p style={{ margin: 0 }} dangerouslySetInnerHTML={{ __html: sanitizeRichText((p.text as string) || "") || "<em style='color:#94a3b8'>Empty paragraph</em>" }} />,
      );

    case "core.heading": {
      const Tag = `h${Math.min(6, Math.max(1, (p.level as number) ?? 2))}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return wrap(<Tag style={{ margin: 0 }}>{(p.text as string) || <em style={{ color: "#94a3b8" }}>Heading</em>}</Tag>);
    }

    case "core.image":
      return wrap(
        (p.src as string) ? (
          <figure style={{ margin: 0 }}>
            <img src={p.src as string} alt={(p.alt as string) ?? ""} style={{ maxWidth: "100%", borderRadius: 6 }} />
            {(p.caption as string) ? <figcaption style={{ fontSize: "0.8rem", color: "#64748b", marginTop: "0.25rem" }}>{p.caption as string}</figcaption> : null}
          </figure>
        ) : <div style={{ background: "#f1f5f9", padding: "1.5rem", borderRadius: 6, textAlign: "center", color: "#94a3b8" }}>No image</div>,
      );

    case "core.quote":
      return wrap(
        <blockquote style={{ margin: 0, paddingLeft: "1rem", borderLeft: "3px solid #3b82f6" }}>
          <p style={{ margin: 0 }}>{(p.text as string) || <em style={{ color: "#94a3b8" }}>Quote</em>}</p>
          {(p.attribution as string) ? <cite style={{ fontSize: "0.8rem", color: "#64748b" }}>— {p.attribution as string}</cite> : null}
        </blockquote>,
      );

    case "core.button":
      return wrap(
        <span style={{ display: "inline-block", padding: "0.5rem 1rem", background: "#3b82f6", color: "#fff", borderRadius: 5, fontWeight: 600 }}>
          {(p.label as string) || "Button"}
        </span>,
      );

    case "core.divider":
      return wrap(<hr style={{ border: "none", borderTop: "2px solid #e2e8f0", margin: "0.5rem 0" }} />);

    case "core.spacer":
      return wrap(
        <div style={{ height: `${(p.height as number) ?? 40}px`, background: "repeating-linear-gradient(45deg, #f8fafc, #f8fafc 5px, #f1f5f9 5px, #f1f5f9 10px)", borderRadius: 4 }} />,
      );

    case "core.code":
      return wrap(
        <pre style={{ margin: 0, padding: "0.75rem", background: "#0f172a", color: "#e2e8f0", borderRadius: 4, fontSize: "0.8rem", overflow: "auto" }}>
          <code>{(p.code as string) || "// code"}</code>
        </pre>,
      );

    case "core.embed":
      return wrap(
        <div style={{ background: "#f1f5f9", padding: "1rem", borderRadius: 6, textAlign: "center", color: "#64748b", fontSize: "0.875rem" }}>
          Embed: {(p.url as string) || "no URL"}
        </div>,
      );

    case "core.html":
      return wrap(
        <div style={{ background: "#fef9c3", padding: "0.5rem", borderRadius: 4, fontSize: "0.8rem", fontFamily: "monospace" }}>
          {(p.html as string) || "<p>HTML</p>"}
        </div>,
      );

    case "justflows.gallery.grid": {
      const items = (Array.isArray(p.items) ? p.items : []) as Array<{ src?: string; alt?: string }>;
      const cols = Math.min(6, Math.max(2, Number(p.columns) || 3));
      if (items.length === 0) {
        return wrap(<div style={{ background: "#f1f5f9", padding: "1.5rem", borderRadius: 6, textAlign: "center", color: "#94a3b8" }}>Empty gallery</div>);
      }
      return wrap(
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: "0.5rem" }}>
          {items.slice(0, 12).map((item, i) => (
            item.src
              ? <img key={i} src={item.src} alt={item.alt ?? ""} style={{ width: "100%", height: 72, objectFit: "cover", borderRadius: 4 }} />
              : <div key={i} style={{ height: 72, background: "#e2e8f0", borderRadius: 4 }} />
          ))}
        </div>,
      );
    }

    default:
      return wrap(<div style={{ color: "#94a3b8", fontSize: "0.8rem" }}>{block.type}</div>);
  }
}

function containerWidth(width: string): string {
  switch (width) {
    case "narrow": return "560px";
    case "wide": return "1100px";
    case "full": return "100%";
    default: return "720px";
  }
}
