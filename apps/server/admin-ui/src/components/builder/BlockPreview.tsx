import type { BlockNode } from "./types";
import { sanitizeRichText } from "@justflows/blocks";
import MotionPreview from "./MotionPreview";

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
        outline: isSelected ? "2px solid var(--jf-accent)" : undefined,
        outlineOffset: 2,
        borderRadius: 4,
        cursor: onSelect ? "pointer" : undefined,
      }}
    >
      {label && depth === 0 ? null : null}
      <MotionPreview blockId={block.id} animation={p.animation}>
        {content}
      </MotionPreview>
    </div>
  );

  switch (block.type) {
    case "core.section": {
      const bgMap: Record<string, string> = {
        default: "#fff",
        muted: "var(--jf-surface-2)",
        primary: "var(--jf-accent-soft)",
        dark: "var(--jf-text)",
        gradient: "linear-gradient(135deg, var(--jf-surface-2) 0%, var(--jf-accent-soft) 100%)",
      };
      const bg = bgMap[(p.background as string) ?? "default"] ?? "#fff";
      const padMap: Record<string, string> = { sm: "1rem", md: "2rem", lg: "3rem", xl: "4rem" };
      const padding = padMap[(p.padding as string) ?? "lg"] ?? "3rem";
      return wrap(
        <section style={{ background: bg, padding, color: p.background === "dark" ? "#fff" : undefined, textAlign: (p.align as string) === "center" ? "center" : "left" }}>
          {renderChildren?.(block.children ?? [], depth + 1) ?? (
            <div style={{ color: "var(--jf-text-3)", fontSize: "0.8rem", padding: "0.5rem" }}>Empty section — add blocks</div>
          )}
        </section>,
      );
    }

    case "core.container":
      return wrap(
        <div style={{ maxWidth: containerWidth(p.width as string), margin: "0 auto" }}>
          {renderChildren?.(block.children ?? [], depth + 1) ?? (
            <div style={{ color: "var(--jf-text-3)", fontSize: "0.8rem", padding: "0.5rem" }}>Empty container</div>
          )}
        </div>,
      );

    case "core.group":
      return wrap(<div>{renderChildren?.(block.children ?? [], depth + 1)}</div>);

    case "core.columns": {
      const cols = (p.columns as number) ?? 2;
      const gap = { sm: "0.75rem", md: "1.25rem", lg: "2rem" }[(p.gap as string) ?? "md"] ?? "1.25rem";
      return wrap(
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap, alignItems: "start" }}>
          {renderChildren?.(block.children ?? [], depth + 1)}
        </div>,
      );
    }

    case "core.column":
      return wrap(
        <div style={{ minHeight: 72, border: depth > 0 ? "1px dashed var(--jf-border-strong)" : undefined, borderRadius: 6, padding: "0.5rem" }}>
          {renderChildren?.(block.children ?? [], depth + 1) ?? (
            <div style={{ color: "var(--jf-text-3)", fontSize: "0.75rem" }}>Drop content here</div>
          )}
        </div>,
      );

    case "core.hero":
      return wrap(
        <section style={{
          background: p.backgroundImage
            ? `linear-gradient(rgba(15,23,42,.55), rgba(15,23,42,.55)), url(${p.backgroundImage as string}) center/cover`
            : "linear-gradient(135deg, var(--jf-surface-2) 0%, var(--jf-accent-soft) 100%)",
          padding: "4rem 2rem",
          textAlign: (p.align as string) === "center" ? "center" : "left",
          borderRadius: 8,
        }}>
          <h1 style={{ margin: "0 0 0.75rem", fontSize: "2rem", fontWeight: 900 }}>
            {(p.heading as string) || "Hero heading"}
          </h1>
          {(p.subheading as string) && <p style={{ margin: "0 0 1.5rem", color: "var(--jf-text-3)", maxWidth: 520 }}>{p.subheading as string}</p>}
          {(p.buttonLabel as string) && (
            <span style={{ display: "inline-block", padding: "0.6rem 1.25rem", background: "var(--jf-accent)", color: "#fff", borderRadius: 6, fontWeight: 600, fontSize: "0.875rem" }}>
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
              <div key={i} style={{ padding: "1.25rem", background: "var(--jf-surface-2)", borderRadius: 8, textAlign: "center" }}>
                <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>{item.icon}</div>
                <h3 style={{ margin: "0 0 0.35rem", fontSize: "1rem" }}>{item.title || "Feature"}</h3>
                <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--jf-text-3)" }}>{item.description}</p>
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
          background: dark ? "var(--jf-text)" : "var(--jf-accent-soft)",
          color: dark ? "#fff" : "var(--jf-text)",
          borderRadius: 8,
          textAlign: "center",
        }}>
          <h2 style={{ margin: "0 0 0.5rem" }}>{(p.heading as string) || "Call to action"}</h2>
          {(p.text as string) && <p style={{ margin: "0 0 1.25rem", opacity: 0.85 }}>{p.text as string}</p>}
          {(p.buttonLabel as string) && (
            <span style={{ display: "inline-block", padding: "0.6rem 1.25rem", background: "var(--jf-accent)", color: "#fff", borderRadius: 6, fontWeight: 600 }}>
              {p.buttonLabel as string}
            </span>
          )}
        </section>,
      );
    }

    case "core.paragraph":
      return wrap(
        <p style={{ margin: 0 }} dangerouslySetInnerHTML={{ __html: sanitizeRichText((p.text as string) || "") || "<em style='color:var(--jf-text-3)'>Empty paragraph</em>" }} />,
      );

    case "core.heading": {
      const Tag = `h${Math.min(6, Math.max(1, (p.level as number) ?? 2))}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return wrap(<Tag style={{ margin: 0 }}>{(p.text as string) || <em style={{ color: "var(--jf-text-3)" }}>Heading</em>}</Tag>);
    }

    case "core.image":
      return wrap(
        (p.src as string) ? (
          <figure style={{ margin: 0 }}>
            <img src={p.src as string} alt={(p.alt as string) ?? ""} style={{ maxWidth: "100%", borderRadius: 6 }} />
            {(p.caption as string) ? <figcaption style={{ fontSize: "0.8rem", color: "var(--jf-text-3)", marginTop: "0.25rem" }}>{p.caption as string}</figcaption> : null}
          </figure>
        ) : <div style={{ background: "var(--jf-surface-3)", padding: "1.5rem", borderRadius: 6, textAlign: "center", color: "var(--jf-text-3)" }}>No image</div>,
      );

    case "core.quote":
      return wrap(
        <blockquote style={{ margin: 0, paddingLeft: "1rem", borderLeft: "3px solid var(--jf-accent)" }}>
          <p style={{ margin: 0 }}>{(p.text as string) || <em style={{ color: "var(--jf-text-3)" }}>Quote</em>}</p>
          {(p.attribution as string) ? <cite style={{ fontSize: "0.8rem", color: "var(--jf-text-3)" }}>— {p.attribution as string}</cite> : null}
        </blockquote>,
      );

    case "core.button":
      return wrap(
        <span style={{ display: "inline-block", padding: "0.5rem 1rem", background: "var(--jf-accent)", color: "#fff", borderRadius: 5, fontWeight: 600 }}>
          {(p.label as string) || "Button"}
        </span>,
      );

    case "core.divider":
      return wrap(<hr style={{ border: "none", borderTop: "2px solid var(--jf-border)", margin: "0.5rem 0" }} />);

    case "core.spacer":
      return wrap(
        <div style={{ height: `${(p.height as number) ?? 40}px`, background: "repeating-linear-gradient(45deg, var(--jf-surface-2), var(--jf-surface-2) 5px, var(--jf-surface-3) 5px, var(--jf-surface-3) 10px)", borderRadius: 4 }} />,
      );

    case "core.code":
      return wrap(
        <pre style={{ margin: 0, padding: "0.75rem", background: "var(--jf-text)", color: "var(--jf-border)", borderRadius: 4, fontSize: "0.8rem", overflow: "auto" }}>
          <code>{(p.code as string) || "// code"}</code>
        </pre>,
      );

    case "core.embed":
      return wrap(
        <div style={{ background: "var(--jf-surface-3)", padding: "1rem", borderRadius: 6, textAlign: "center", color: "var(--jf-text-3)", fontSize: "0.875rem" }}>
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
      const layout = (p.layout as string) || "grid";
      const cols = layout === "carousel" || layout === "slideshow" || layout === "list" ? 1 : Math.min(6, Math.max(2, Number(p.columns) || 3));
      if (items.length === 0) {
        return wrap(<div style={{ background: "var(--jf-surface-3)", padding: "1.5rem", borderRadius: 6, textAlign: "center", color: "var(--jf-text-3)" }}>Empty gallery</div>);
      }
      const shown = layout === "carousel" || layout === "slideshow" ? items.slice(0, 1) : items.slice(0, 12);
      return wrap(
        <div>
          {layout !== "grid" && (
            <div style={{ fontSize: "0.7rem", color: "var(--jf-text-3)", marginBottom: "0.35rem", textTransform: "capitalize" }}>{layout}</div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: "0.5rem" }}>
            {shown.map((item, i) => (
              item.src
                ? <img key={i} src={item.src} alt={item.alt ?? ""} style={{ width: "100%", height: layout === "list" ? 140 : 72, objectFit: "cover", borderRadius: 4 }} />
                : <div key={i} style={{ height: 72, background: "var(--jf-border)", borderRadius: 4 }} />
            ))}
          </div>
        </div>,
      );
    }

    case "core.grid":
      return wrap(renderChildren ? <>{renderChildren(block.children ?? [], depth + 1)}</> : <div />);

    case "core.color-scheme":
      return wrap(
        <div style={{ display: "inline-flex", gap: 6, ...widgetAlign(p.align as string) }}>
          <span style={widgetChip}>☀ Light</span>
          <span style={widgetChip}>☾ Dark</span>
          {p.showSystem === true ? <span style={widgetChip}>◐ Auto</span> : null}
        </div>,
      );

    case "core.language-switcher":
      return wrap(
        <div style={{ display: "inline-flex", gap: 6, ...widgetAlign(p.align as string) }}>
          <span style={{ ...widgetChip, fontWeight: 700 }}>EN</span>
          <span style={widgetChip}>NL</span>
        </div>,
      );

    case "core.auth-links":
      return wrap(
        <div style={{ display: "inline-flex", gap: 8, alignItems: "center", ...widgetAlign(p.align as string) }}>
          {p.showLogin !== false ? (
            <span style={{ ...widgetChip, background: "#fff", border: "1px solid var(--jf-border-strong)" }}>
              {(p.loginLabel as string) || "Log in"}
            </span>
          ) : null}
          {p.showRegister !== false ? (
            <span style={{ ...widgetChip, background: "var(--jf-accent)", color: "#fff" }}>
              {(p.registerLabel as string) || "Register"}
            </span>
          ) : null}
        </div>,
      );

    default:
      return wrap(<div style={{ color: "var(--jf-text-3)", fontSize: "0.8rem" }}>{block.type}</div>);
  }
}

const widgetChip: React.CSSProperties = {
  display: "inline-block",
  padding: "0.35rem 0.7rem",
  borderRadius: 999,
  background: "var(--jf-surface-3)",
  fontSize: "0.8rem",
  fontWeight: 600,
};

function widgetAlign(align: string): React.CSSProperties {
  if (align === "center") return { justifyContent: "center", width: "100%" };
  if (align === "right") return { justifyContent: "flex-end", width: "100%" };
  return { justifyContent: "flex-start" };
}

function containerWidth(width: string): string {
  switch (width) {
    case "narrow": return "560px";
    case "wide": return "1100px";
    case "full": return "100%";
    default: return "720px";
  }
}
