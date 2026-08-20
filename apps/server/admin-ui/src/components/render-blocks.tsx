import type { BlockDocument, BlockNode } from "@components/builder/types";
import { sanitizeHtmlBlock, sanitizeRichText, safeHref, safeMediaSrc } from "@justflows/blocks";

export function renderBlock(block: BlockNode): React.ReactNode {
  const p = block.props;
  const children = block.children?.map(renderBlock);

  switch (block.type) {
    case "core.section":
      return (
        <section key={block.id} className={`jf-section jf-section--bg-${p.background ?? "default"} jf-section--pad-${p.padding ?? "lg"} jf-section--align-${p.align ?? "left"}`}>
          <div className="jf-section__inner">{children}</div>
        </section>
      );
    case "core.container":
      return <div key={block.id} className={`jf-container jf-container--${p.width ?? "default"}`}>{children}</div>;
    case "core.group":
      return <div key={block.id} className="jf-group">{children}</div>;
    case "core.columns":
      return (
        <div key={block.id} className={`jf-columns jf-columns--${p.columns ?? 2} jf-columns--gap-${p.gap ?? "md"}`}>
          {children}
        </div>
      );
    case "core.column":
      return <div key={block.id} className="jf-column">{children}</div>;
    case "core.hero":
      return (
        <section
          key={block.id}
          className={`jf-hero jf-hero--align-${p.align ?? "center"}`}
          style={p.backgroundImage ? { backgroundImage: `linear-gradient(rgba(15,23,42,.55), rgba(15,23,42,.55)), url(${safeMediaSrc(p.backgroundImage as string)})` } : undefined}
        >
          <div className="jf-hero__inner">
            <h1 className="jf-hero__heading">{p.heading as string}</h1>
            {p.subheading ? <p className="jf-hero__sub">{p.subheading as string}</p> : null}
            {p.buttonLabel ? <a href={safeHref((p.buttonUrl as string) || "#")} className="btn btn--primary">{p.buttonLabel as string}</a> : null}
          </div>
        </section>
      );
    case "core.features": {
      const items = (p.items as Array<{ icon: string; title: string; description: string }>) ?? [];
      return (
        <section key={block.id} className="jf-features">
          <div className="jf-container jf-container--wide">
            {p.heading ? <h2 className="jf-features__heading">{p.heading as string}</h2> : null}
            <div className={`jf-features__grid jf-features__grid--${p.columns ?? 3}`}>
              {items.map((item, i) => (
                <div key={i} className="jf-feature">
                  <span className="jf-feature__icon">{item.icon}</span>
                  <h3 className="jf-feature__title">{item.title}</h3>
                  <p className="jf-feature__desc">{item.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      );
    }
    case "core.cta":
      return (
        <section key={block.id} className={`jf-cta jf-cta--${p.variant ?? "primary"}`}>
          <div className="jf-container jf-container--default">
            <h2 className="jf-cta__heading">{p.heading as string}</h2>
            {p.text ? <p className="jf-cta__text">{p.text as string}</p> : null}
            {p.buttonLabel ? <a href={safeHref((p.buttonUrl as string) || "#")} className="btn btn--primary jf-cta__btn">{p.buttonLabel as string}</a> : null}
          </div>
        </section>
      );
    case "core.paragraph":
      return <p key={block.id} dangerouslySetInnerHTML={{ __html: sanitizeRichText((p.text as string) ?? "") }} />;
    case "core.heading": {
      const level = Math.min(6, Math.max(1, (p.level as number) ?? 2));
      const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return <Tag key={block.id}>{p.text as string}</Tag>;
    }
    case "core.image":
      return (
        <figure key={block.id}>
          <img src={safeMediaSrc(p.src as string)} alt={(p.alt as string) ?? ""} />
          {p.caption ? <figcaption>{p.caption as string}</figcaption> : null}
        </figure>
      );
    case "core.quote":
      return (
        <blockquote key={block.id}>
          <p dangerouslySetInnerHTML={{ __html: sanitizeRichText((p.text as string) ?? "") }} />
          {p.attribution ? <cite>— {p.attribution as string}</cite> : null}
        </blockquote>
      );
    case "core.button":
      return (
        <a key={block.id} href={safeHref((p.url as string) || "#")} className={`btn btn--${p.variant ?? "primary"}`}>
          {(p.label as string) || "Button"}
        </a>
      );
    case "core.divider":
      return <hr key={block.id} />;
    case "core.spacer":
      return <div key={block.id} style={{ height: `${(p.height as number) ?? 40}px` }} aria-hidden="true" />;
    case "core.code":
      return <pre key={block.id}><code>{(p.code as string) ?? ""}</code></pre>;
    case "core.embed":
      return (
        <figure key={block.id} className="embed">
          <a href={safeHref(p.url as string)}>{p.url as string}</a>
          {p.caption ? <figcaption>{p.caption as string}</figcaption> : null}
        </figure>
      );
    case "core.html":
      return <div key={block.id} dangerouslySetInnerHTML={{ __html: sanitizeHtmlBlock((p.html as string) ?? "") }} />;
    default:
      return null;
  }
}

export function renderBlocks(blocks: BlockDocument | undefined): React.ReactNode {
  return blocks?.blocks.map(renderBlock);
}
