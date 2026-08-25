import { blockScopeClass, sanitizeBlockClassName, scopeBlockCss } from "@justflows/blocks";
import { useT } from "../../i18n/I18nProvider";
import type { BlockNode } from "./types";

/**
 * Per-block presentation: extra classes, and CSS confined to this block.
 *
 * The preview line below the textarea shows the CSS exactly as the server will
 * emit it, so an editor can see what `&` resolved to before they publish.
 */
export default function BlockStylePanel({
  block,
  onChange,
}: {
  block: BlockNode;
  onChange: (props: Record<string, unknown>) => void;
}) {
  const { t } = useT();
  const props = block.props;
  const className = typeof props.className === "string" ? props.className : "";
  const css = typeof props.css === "string" ? props.css : "";
  const scope = blockScopeClass(block.id);

  function set(key: "className" | "css", value: string) {
    const next = { ...props };
    if (value.trim()) next[key] = value;
    else delete next[key];
    onChange(next);
  }

  const compiled = css.trim() && scope ? scopeBlockCss(css, `.${scope}`) : "";
  const rejected = Boolean(css.trim()) && !compiled;
  const strippedClasses = className.trim() && !sanitizeBlockClassName(className);

  return (
    <section className="jf-block-panel" aria-labelledby={`jf-style-${block.id}`}>
      <h3 id={`jf-style-${block.id}`}>{t("builder.style.title")}</h3>
      <p className="jf-block-panel__hint">{t("builder.style.hint")}</p>

      <label className="jf-block-panel__field">
        {t("builder.style.className")}
        <input
          type="text"
          value={className}
          spellCheck={false}
          placeholder="hero-lead featured"
          onChange={(e) => set("className", e.target.value)}
        />
      </label>
      {strippedClasses && (
        <p className="jf-block-panel__error">{t("builder.style.classNameInvalid")}</p>
      )}

      <label className="jf-block-panel__field">
        {t("builder.style.css")}
        <textarea
          rows={8}
          className="jf-block-panel__code"
          value={css}
          spellCheck={false}
          placeholder={"padding: 3rem 1rem;\n\n& h2 { font-size: 2.5rem }\n&:hover { background: var(--color-surface) }\n@media (max-width: 600px) { & { padding: 1rem } }"}
          onChange={(e) => set("css", e.target.value)}
        />
      </label>

      {rejected ? (
        <p className="jf-block-panel__error">{t("builder.style.cssRejected")}</p>
      ) : compiled ? (
        <details className="jf-block-panel__compiled">
          <summary>{t("builder.style.compiled")}</summary>
          <pre>{compiled}</pre>
        </details>
      ) : null}
    </section>
  );
}
