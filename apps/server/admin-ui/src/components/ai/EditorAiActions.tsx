import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n/I18nProvider";
import { aiJson, type AssistantStatus, type ModelChoice } from "../../lib/ai-api";
import { useAssistant } from "./AssistantProvider";

/**
 * One-click AI actions in the content editor (#159). Each one asks the server
 * for a suggestion, shows it for review, and only touches the editor's state
 * when the user applies it — nothing is saved until they save as usual.
 */

interface BlockNode {
  id?: string;
  type: string;
  props?: Record<string, unknown>;
  children?: BlockNode[];
}

export interface EditorAiItem {
  id: string;
  type: string;
  title: string;
  excerpt?: string;
  locale?: string;
  blocks?: { version: 1; blocks: BlockNode[] } | unknown;
  fields?: Record<string, unknown>;
}

export interface EditorAiChanges {
  title?: string;
  excerpt?: string;
  blocks?: unknown;
  fields?: Record<string, unknown>;
}

type Selection =
  | { kind: "input"; element: HTMLInputElement | HTMLTextAreaElement; start: number; end: number; text: string }
  | { kind: "range"; range: Range; text: string };

type Review =
  | { action: "text"; mode: "rewrite" | "shorten" | "expand"; original: string; result: string; selection: Selection | null }
  | { action: "excerpt_seo"; excerpt: string; seoTitle: string; seoDescription: string }
  | { action: "draft"; title: string; excerpt: string; blocks: unknown }
  | { action: "alt_text"; images: { path: number[]; src: string; altText: string }[] }
  | { action: "translate"; locale: string; title: string; slug: string; excerpt: string; blocks: unknown; fields: Record<string, unknown> };

function captureSelection(): Selection | null {
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement || (active instanceof HTMLInputElement && active.type === "text")) {
    const start = active.selectionStart ?? 0;
    const end = active.selectionEnd ?? 0;
    if (end > start) return { kind: "input", element: active, start, end, text: active.value.slice(start, end) };
  }
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
    const text = selection.toString();
    if (text.trim()) return { kind: "range", range: selection.getRangeAt(0).cloneRange(), text };
  }
  return null;
}

/** Replace the captured selection so React-controlled fields see the change. */
function replaceSelection(selection: Selection, text: string): boolean {
  if (selection.kind === "input") {
    const { element, start, end } = selection;
    if (!element.isConnected) return false;
    const next = element.value.slice(0, start) + text + element.value.slice(end);
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(element, next);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }
  const container = selection.range.commonAncestorContainer;
  const editable = (container instanceof Element ? container : container.parentElement)?.closest("[contenteditable='true']");
  if (!editable || !editable.isConnected) return false;
  (editable as HTMLElement).focus();
  const current = window.getSelection();
  current?.removeAllRanges();
  current?.addRange(selection.range);
  return document.execCommand("insertText", false, text);
}

function blockList(doc: unknown): BlockNode[] {
  const blocks = (doc as { blocks?: unknown } | undefined)?.blocks;
  return Array.isArray(blocks) ? (blocks as BlockNode[]) : [];
}

function findImages(nodes: BlockNode[], path: number[] = []): { path: number[]; src: string }[] {
  return nodes.flatMap((node, index) => {
    const here = [...path, index];
    const own =
      node.type === "core.image" && typeof node.props?.src === "string" && node.props.src && !String(node.props.alt ?? "").trim()
        ? [{ path: here, src: node.props.src as string }]
        : [];
    return [...own, ...findImages(node.children ?? [], here)];
  });
}

function setAlt(nodes: BlockNode[], path: number[], alt: string): BlockNode[] {
  const [head, ...rest] = path;
  return nodes.map((node, index) => {
    if (index !== head) return node;
    if (rest.length === 0) return { ...node, props: { ...(node.props ?? {}), alt } };
    return { ...node, children: setAlt(node.children ?? [], rest, alt) };
  });
}

function plainText(nodes: BlockNode[]): string {
  return nodes
    .map((node) => {
      const own = ["text", "heading", "label", "alt", "caption", "html"]
        .map((key) => node.props?.[key])
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.replace(/<[^>]*>/g, " "))
        .join(" ");
      return [own, plainText(node.children ?? [])].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .slice(0, 28_000);
}

export default function EditorAiActions({
  item,
  languages,
  onApply,
  onTranslationCreated,
}: {
  item: EditorAiItem;
  languages: { code: string; nativeName: string }[];
  onApply: (changes: EditorAiChanges) => void;
  onTranslationCreated: (id: string) => void;
}) {
  const { t } = useT();
  const assistant = useAssistant();
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [brief, setBrief] = useState<string | null>(null);
  const [translateTo, setTranslateTo] = useState<string | null>(null);
  const selectionRef = useRef<Selection | null>(null);

  useEffect(() => {
    if (!assistant.available) return;
    aiJson<AssistantStatus>("/api/ai/assistant/status")
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [assistant.available]);

  if (!assistant.available || !status?.enabled || status.providers.length === 0) return null;
  const first = status.providers[0]!;
  const choice: ModelChoice = (() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem("jf.assistant.model") ?? "null") as ModelChoice | null;
      if (stored && status.providers.some((p) => p.provider === stored.provider && p.source === stored.source) && stored.model) return stored;
    } catch {
      // fall back to the first provider
    }
    return { source: first.source, provider: first.provider, model: first.defaultModel ?? first.models[0] ?? "" };
  })();

  async function run<T>(name: string, body: Record<string, unknown>): Promise<T | null> {
    setBusy(name);
    setError("");
    setOpen(false);
    try {
      const response = await aiJson<{ result: T }>(
        "/api/ai/assistant/action",
        { method: "POST", body: JSON.stringify({ ...choice, ...body }) },
        t("common.requestFailed"),
      );
      return response.result;
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
      return null;
    } finally {
      setBusy("");
    }
  }

  async function textAction(mode: "rewrite" | "shorten" | "expand") {
    const selection = selectionRef.current;
    const original = selection?.text ?? item.excerpt ?? "";
    if (!original.trim()) {
      setError(t("ai.actions.selectText"));
      setOpen(false);
      return;
    }
    const result = await run<{ text: string }>(mode, { action: mode, text: original });
    if (result) setReview({ action: "text", mode, original, result: result.text, selection });
  }

  async function excerptSeo() {
    const result = await run<{ excerpt: string; seoTitle: string; seoDescription: string }>("excerpt_seo", {
      action: "excerpt_seo",
      title: item.title,
      text: plainText(blockList(item.blocks)) || item.excerpt || item.title,
    });
    if (result) setReview({ action: "excerpt_seo", ...result });
  }

  async function draft() {
    if (!brief?.trim()) return;
    const text = brief;
    setBrief(null);
    const result = await run<{ title: string; excerpt: string; blocks: unknown }>("draft", {
      action: "draft",
      brief: text,
      type: item.type,
      locale: item.locale,
    });
    if (result) setReview({ action: "draft", ...result });
  }

  async function altText() {
    const images = findImages(blockList(item.blocks));
    if (images.length === 0) {
      setError(t("ai.actions.noImages"));
      setOpen(false);
      return;
    }
    const results: { path: number[]; src: string; altText: string }[] = [];
    for (const image of images.slice(0, 10)) {
      const result = await run<{ altText: string }>("alt_text", { action: "alt_text", src: image.src, locale: item.locale });
      if (!result) return;
      results.push({ ...image, altText: result.altText });
    }
    setReview({ action: "alt_text", images: results });
  }

  async function translate() {
    if (!translateTo) return;
    const locale = translateTo;
    setTranslateTo(null);
    const result = await run<{ title: string; slug: string; excerpt: string; blocks: unknown; fields: Record<string, unknown> }>("translate", {
      action: "translate",
      contentId: item.id,
      locale,
    });
    if (result) setReview({ action: "translate", locale, ...result });
  }

  async function apply() {
    if (!review) return;
    setError("");
    switch (review.action) {
      case "text":
        if (!review.selection || !replaceSelection(review.selection, review.result)) {
          void navigator.clipboard.writeText(review.result);
          setError(t("ai.actions.copiedInstead"));
        }
        break;
      case "excerpt_seo":
        onApply({
          excerpt: review.excerpt,
          fields: { ...(item.fields ?? {}), seoTitle: review.seoTitle, seoDescription: review.seoDescription },
        });
        break;
      case "draft":
        onApply({ title: review.title, excerpt: review.excerpt, blocks: review.blocks });
        break;
      case "alt_text": {
        let nodes = blockList(item.blocks);
        for (const image of review.images) nodes = setAlt(nodes, image.path, image.altText);
        onApply({ blocks: { version: 1, blocks: nodes } });
        break;
      }
      case "translate": {
        setBusy("translate");
        try {
          // The existing translate route links the new draft into the group;
          // the reviewed translation then replaces its copied content.
          const created = await fetch(`/api/content/${encodeURIComponent(item.id)}/translate`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ locale: review.locale }),
          });
          const draftEntry = (await created.json()) as { id?: string; version?: number; error?: string };
          if (!created.ok || !draftEntry.id) throw new Error(draftEntry.error ?? t("content.translationCreateFailed"));
          await aiJson(
            `/api/content/${encodeURIComponent(draftEntry.id)}`,
            {
              method: "PATCH",
              body: JSON.stringify({
                title: review.title,
                ...(review.slug ? { slug: review.slug } : {}),
                excerpt: review.excerpt,
                blocks: review.blocks,
                fields: review.fields,
                expectedVersion: draftEntry.version,
              }),
            },
            t("common.requestFailed"),
          );
          setReview(null);
          onTranslationCreated(draftEntry.id);
        } catch (err) {
          setError(err instanceof Error ? err.message : t("common.requestFailed"));
        } finally {
          setBusy("");
        }
        return;
      }
    }
    setReview(null);
  }

  const otherLanguages = languages.filter((lang) => lang.code !== item.locale);

  return (
    <div className="jf-ai-actions">
      <button
        type="button"
        className="jf-btn jf-btn--ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy !== ""}
        // Capture before the click moves focus away from the selected text.
        onMouseDown={() => {
          selectionRef.current = captureSelection();
        }}
        onClick={() => setOpen((value) => !value)}
      >
        {busy ? t("ai.actions.working") : t("ai.actions.menu")}
      </button>
      {open && (
        <div className="jf-ai-actions__menu" role="menu">
          <button type="button" role="menuitem" onClick={() => void textAction("rewrite")}>{t("ai.actions.rewrite")}</button>
          <button type="button" role="menuitem" onClick={() => void textAction("shorten")}>{t("ai.actions.shorten")}</button>
          <button type="button" role="menuitem" onClick={() => void textAction("expand")}>{t("ai.actions.expand")}</button>
          <button type="button" role="menuitem" onClick={() => void excerptSeo()}>{t("ai.actions.excerptSeo")}</button>
          <button type="button" role="menuitem" onClick={() => void altText()}>{t("ai.actions.altText")}</button>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); setBrief(""); }}>{t("ai.actions.draft")}</button>
          {otherLanguages.length > 0 && (
            <button type="button" role="menuitem" onClick={() => { setOpen(false); setTranslateTo(otherLanguages[0]!.code); }}>
              {t("ai.actions.translate")}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              assistant.open(`Editing ${item.type} entry id ${item.id} titled "${item.title}" (locale ${item.locale ?? "default"}).`);
            }}
          >
            {t("ai.actions.openAssistant")}
          </button>
        </div>
      )}
      {error && (
        <div className="jf-alert jf-alert--error" role="alert" style={{ marginTop: "0.5rem" }}>
          {error}
        </div>
      )}

      {brief !== null && (
        <div className="jf-ai-review" role="dialog" aria-modal="true" aria-label={t("ai.actions.draft")}>
          <div className="jf-ai-review__card">
            <h2 className="jf-card__title">{t("ai.actions.draft")}</h2>
            <p className="jf-field__hint">{t("ai.actions.draftHint")}</p>
            <textarea className="jf-input" rows={6} value={brief} aria-label={t("ai.actions.brief")} onChange={(e) => setBrief(e.target.value)} />
            <div className="jf-row">
              <button type="button" className="jf-btn jf-btn--primary" disabled={!brief.trim()} onClick={() => void draft()}>
                {t("ai.actions.generate")}
              </button>
              <button type="button" className="jf-btn" onClick={() => setBrief(null)}>
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {translateTo !== null && (
        <div className="jf-ai-review" role="dialog" aria-modal="true" aria-label={t("ai.actions.translate")}>
          <div className="jf-ai-review__card">
            <h2 className="jf-card__title">{t("ai.actions.translate")}</h2>
            <select className="jf-input" value={translateTo} aria-label={t("content.locale")} onChange={(e) => setTranslateTo(e.target.value)}>
              {otherLanguages.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.nativeName} ({lang.code})
                </option>
              ))}
            </select>
            <div className="jf-row">
              <button type="button" className="jf-btn jf-btn--primary" onClick={() => void translate()}>
                {t("ai.actions.generate")}
              </button>
              <button type="button" className="jf-btn" onClick={() => setTranslateTo(null)}>
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {review && (
        <div className="jf-ai-review" role="dialog" aria-modal="true" aria-label={t("ai.actions.reviewTitle")}>
          <div className="jf-ai-review__card">
            <h2 className="jf-card__title">{t("ai.actions.reviewTitle")}</h2>
            <p className="jf-field__hint">{t("ai.actions.reviewHint")}</p>
            {review.action === "text" && (
              <>
                <div className="jf-assistant__before">{review.original}</div>
                <textarea
                  className="jf-input"
                  rows={8}
                  value={review.result}
                  aria-label={t("ai.actions.result")}
                  onChange={(e) => setReview({ ...review, result: e.target.value })}
                />
              </>
            )}
            {review.action === "excerpt_seo" && (
              <>
                <label className="jf-field">
                  <span className="jf-field__label">{t("content.excerpt")}</span>
                  <textarea className="jf-input" rows={3} value={review.excerpt} onChange={(e) => setReview({ ...review, excerpt: e.target.value })} />
                </label>
                <label className="jf-field">
                  <span className="jf-field__label">{t("content.seoTitleLabel")}</span>
                  <input className="jf-input" value={review.seoTitle} onChange={(e) => setReview({ ...review, seoTitle: e.target.value })} />
                </label>
                <label className="jf-field">
                  <span className="jf-field__label">{t("ai.actions.seoDescription")}</span>
                  <textarea className="jf-input" rows={3} value={review.seoDescription} onChange={(e) => setReview({ ...review, seoDescription: e.target.value })} />
                </label>
              </>
            )}
            {(review.action === "draft" || review.action === "translate") && (
              <>
                <label className="jf-field">
                  <span className="jf-field__label">{t("ai.actions.titleLabel")}</span>
                  <input className="jf-input" value={review.title} onChange={(e) => setReview({ ...review, title: e.target.value })} />
                </label>
                <label className="jf-field">
                  <span className="jf-field__label">{t("content.excerpt")}</span>
                  <textarea className="jf-input" rows={2} value={review.excerpt} onChange={(e) => setReview({ ...review, excerpt: e.target.value })} />
                </label>
                <pre className="jf-code-snippet">{plainText(blockList(review.blocks)).slice(0, 4000)}</pre>
                {review.action === "draft" && <p className="jf-field__hint">{t("ai.actions.draftReplaces")}</p>}
                {review.action === "translate" && <p className="jf-field__hint">{t("ai.actions.translateCreates", { locale: review.locale })}</p>}
              </>
            )}
            {review.action === "alt_text" &&
              review.images.map((image, index) => (
                <label className="jf-field" key={image.path.join(".")}>
                  <span className="jf-field__label jf-truncate">{image.src}</span>
                  <input
                    className="jf-input"
                    value={image.altText}
                    onChange={(e) =>
                      setReview({
                        ...review,
                        images: review.images.map((img, i) => (i === index ? { ...img, altText: e.target.value } : img)),
                      })
                    }
                  />
                </label>
              ))}
            <div className="jf-row">
              <button type="button" className="jf-btn jf-btn--primary" disabled={busy !== ""} onClick={() => void apply()}>
                {review.action === "translate" ? t("ai.actions.createTranslation") : t("ai.actions.apply")}
              </button>
              <button type="button" className="jf-btn" onClick={() => setReview(null)}>
                {t("ai.actions.discard")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
