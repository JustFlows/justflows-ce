// SPDX-License-Identifier: MIT

import { randomUUID } from "node:crypto";
import { esc, sanitizeRichText } from "@justflows/blocks";
import { getDb } from "./db.js";
import { getRuntimeBlockRegistry } from "./runtime-blocks.js";
import { consumeRateLimit } from "./rate-limit.js";
import { getGeneralSettings } from "./general-settings.js";
import {
  commentsStateFor,
  getCommentSettings,
  type CaptchaProvider,
  type CommentSettings,
} from "./comments-settings.js";

export const COMMENTS_BLOCK_TYPE = "justflows.comments.thread";

// ─── CAPTCHA providers ──────────────────────────────────────────────────────

interface CaptchaMeta {
  verifyUrl: string;
  /** Widget script the public form loads. */
  scriptSrc: string;
  /** Hosts to add to the public CSP when this provider is active. */
  csp: { script: string[]; frame: string[]; connect: string[] };
  /** Form field the provider's widget submits the solved token in. */
  field: string;
  widgetClass: string;
}

export const CAPTCHA_META: Record<Exclude<CaptchaProvider, "none">, CaptchaMeta> = {
  turnstile: {
    verifyUrl: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    scriptSrc: "https://challenges.cloudflare.com/turnstile/v0/api.js",
    csp: {
      script: ["https://challenges.cloudflare.com"],
      frame: ["https://challenges.cloudflare.com"],
      connect: ["https://challenges.cloudflare.com"],
    },
    field: "cf-turnstile-response",
    widgetClass: "cf-turnstile",
  },
  hcaptcha: {
    verifyUrl: "https://api.hcaptcha.com/siteverify",
    scriptSrc: "https://js.hcaptcha.com/1/api.js",
    csp: {
      script: ["https://hcaptcha.com", "https://*.hcaptcha.com"],
      frame: ["https://hcaptcha.com", "https://*.hcaptcha.com"],
      connect: ["https://hcaptcha.com", "https://*.hcaptcha.com"],
    },
    field: "h-captcha-response",
    widgetClass: "h-captcha",
  },
};

async function verifyCaptcha(
  provider: Exclude<CaptchaProvider, "none">,
  secret: string,
  token: string,
  ip: string,
): Promise<boolean> {
  if (!secret || !token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip && ip !== "unknown") body.set("remoteip", ip);
    const res = await fetch(CAPTCHA_META[provider].verifyUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (err) {
    console.error("[justflows] captcha verification failed:", err);
    return false;
  }
}

// ─── Block props ────────────────────────────────────────────────────────────

export interface CommentsBlockProps {
  title: string;
  order: "oldest" | "newest";
}

export function parseCommentsBlockProps(raw: unknown): CommentsBlockProps {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    title: String(row.title ?? "Comments").slice(0, 120) || "Comments",
    order: row.order === "newest" ? "newest" : "oldest",
  };
}

/**
 * Core block, registered once at startup (see the call site in public-site.ts).
 * The real thread + form HTML is produced by renderCommentsBlockHtml on the
 * public render path, which has the per-request context; this static render is
 * only the page-builder placeholder.
 */
export function registerCommentsBlock(): void {
  const registry = getRuntimeBlockRegistry();
  if (registry.get(COMMENTS_BLOCK_TYPE)) return;
  registry.register({
    type: COMMENTS_BLOCK_TYPE,
    version: 1,
    title: "Comments",
    description: "Public comment thread and submission form. Drop it on a post to enable discussion.",
    icon: "💬",
    category: "content",
    schema: {
      title: { type: "text", default: "Comments" },
      order: { type: "select", options: ["oldest", "newest"], default: "oldest" },
    },
    validateProps: (raw) => parseCommentsBlockProps(raw) as unknown as Record<string, unknown>,
    render: () => `<p class="jf-comments__placeholder">Comments will appear here.</p>`,
  });
}

// ─── Public render ──────────────────────────────────────────────────────────

export type CommentsBannerState = "posted" | "pending" | "error" | "captcha";

export interface CommentsRenderContext {
  siteId: string;
  content: {
    id: string;
    type: string;
    publishedAt: Date | string | null;
    fields: unknown;
  };
  currentUser?: { id: string; name: string; email: string } | null;
  /** Banner to show above the form after a redirect back from a submission. */
  banner?: CommentsBannerState | null;
  /** Comment id the visitor clicked "reply" on. */
  replyTo?: string | null;
  /** 1-based page of top-level comments. */
  page: number;
  /** Permalink of the page the block sits on, for reply / pagination links. */
  basePath: string;
  locale: string;
  t: (key: string) => string;
}

interface CommentRow {
  id: string;
  parent_id: string | null;
  author_name: string;
  author_url: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
}

interface ThreadNode extends CommentRow {
  children: ThreadNode[];
}

function buildThread(rows: CommentRow[]): ThreadNode[] {
  const byId = new Map<string, ThreadNode>();
  for (const row of rows) byId.set(row.id, { ...row, children: [] });
  const roots: ThreadNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function formatWhen(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function authorLink(name: string, url: string | null, allowUrls: boolean): string {
  const safeName = esc(name);
  if (!allowUrls || !url) return safeName;
  let href = "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") href = parsed.toString();
  } catch {
    href = "";
  }
  if (!href) return safeName;
  return `<a href="${esc(href)}" rel="nofollow ugc noopener" target="_blank">${safeName}</a>`;
}

function renderNode(
  node: ThreadNode,
  ctx: CommentsRenderContext,
  settings: CommentSettings,
  accepting: boolean,
  depth: number,
): string {
  const clampedChildren = depth + 1 >= settings.threadMaxDepth ? flatten(node.children) : node.children;
  const childrenHtml = clampedChildren.length
    ? `<ol class="jf-comments__list jf-comments__list--replies">${clampedChildren
        .map((child) => renderNode(child, ctx, settings, accepting, Math.min(depth + 1, settings.threadMaxDepth)))
        .join("")}</ol>`
    : "";
  const when = formatWhen(node.created_at);
  const edited = node.edited_at ? ` <span class="jf-comment__edited">(${esc(ctx.t("comments.edited"))})</span>` : "";
  const replyLink = accepting
    ? ` · <a class="jf-comment__reply-link" href="${esc(replyUrl(ctx.basePath, node.id))}#jf-comment-form">${esc(
        ctx.t("comments.reply"),
      )}</a>`
    : "";
  return `<li class="jf-comment" id="jf-comment-${esc(node.id)}">
    <article class="jf-comment__body">
      <header class="jf-comment__meta">
        <span class="jf-comment__author">${authorLink(node.author_name, node.author_url, settings.allowUrls)}</span>
        ${when ? `<time datetime="${esc(node.created_at)}">${esc(when)}</time>` : ""}${edited}${replyLink}
      </header>
      <div class="jf-comment__text">${node.body}</div>
    </article>
    ${childrenHtml}
  </li>`;
}

function flatten(nodes: ThreadNode[]): ThreadNode[] {
  const out: ThreadNode[] = [];
  const walk = (list: ThreadNode[]) => {
    for (const n of list) {
      out.push({ ...n, children: [] });
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

function replyUrl(basePath: string, commentId: string): string {
  const base = basePath || "/";
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}reply=${encodeURIComponent(commentId)}`;
}

function pageUrl(basePath: string, page: number): string {
  const base = basePath || "/";
  const sep = base.includes("?") ? "&" : "?";
  return page <= 1 ? base : `${base}${sep}comment-page=${page}`;
}

function bannerHtml(ctx: CommentsRenderContext): string {
  if (!ctx.banner) return "";
  const key =
    ctx.banner === "posted"
      ? "comments.posted_ok"
      : ctx.banner === "pending"
        ? "comments.awaiting_moderation"
        : ctx.banner === "captcha"
          ? "comments.captcha_failed"
          : "comments.error_generic";
  const tone = ctx.banner === "posted" || ctx.banner === "pending" ? "success" : "error";
  const role = tone === "success" ? "status" : "alert";
  return `<p class="jf-comments__banner jf-comments__banner--${tone}" role="${role}">${esc(ctx.t(key))}</p>`;
}

function fieldRow(id: string, label: string, control: string, hint = ""): string {
  return `<p class="jf-comments__field">
    <label for="${id}">${esc(label)}</label>
    ${control}
    ${hint ? `<span class="jf-comments__hint">${esc(hint)}</span>` : ""}
  </p>`;
}

function formHtml(ctx: CommentsRenderContext, settings: CommentSettings): string {
  const user = ctx.currentUser ?? null;
  const nameControl = user
    ? `<input id="jf-comment-name" type="text" name="author_name" value="${esc(user.name)}" readonly>`
    : `<input id="jf-comment-name" type="text" name="author_name" maxlength="120" required autocomplete="name">`;
  const emailControl = user
    ? `<input id="jf-comment-email" type="email" name="author_email" value="${esc(user.email)}" readonly>`
    : `<input id="jf-comment-email" type="email" name="author_email" maxlength="320" autocomplete="email">`;

  const replyingTo = ctx.replyTo
    ? `<p class="jf-comments__replying">${esc(ctx.t("comments.replying"))}
        <a href="${esc(ctx.basePath || "/")}#jf-comment-form">${esc(ctx.t("comments.cancel_reply"))}</a></p>`
    : "";

  let captchaWidget = "";
  if (settings.captchaProvider !== "none" && settings.captchaSiteKey) {
    const meta = CAPTCHA_META[settings.captchaProvider];
    captchaWidget = `<div class="${meta.widgetClass} jf-comments__captcha" data-sitekey="${esc(
      settings.captchaSiteKey,
    )}"></div>
    <script src="${esc(meta.scriptSrc)}" async defer></script>`;
  }

  return `<form class="jf-comments__form" id="jf-comment-form" method="post" action="/justflows-comments/submit">
    <h3 class="jf-comments__form-title">${esc(ctx.t("comments.form_title"))}</h3>
    ${replyingTo}
    <input type="hidden" name="content_id" value="${esc(ctx.content.id)}">
    ${ctx.replyTo ? `<input type="hidden" name="parent_id" value="${esc(ctx.replyTo)}">` : ""}
    <input type="hidden" name="return_to" value="${esc(ctx.basePath || "/")}">
    <div class="jf-comments__hp" aria-hidden="true">
      <label for="jf-comment-url">Leave this field empty</label>
      <input id="jf-comment-url" type="text" name="website_url" tabindex="-1" autocomplete="off">
    </div>
    ${fieldRow("jf-comment-name", ctx.t("comments.name"), nameControl)}
    ${fieldRow("jf-comment-email", ctx.t("comments.email"), emailControl, ctx.t("comments.email_hint"))}
    ${
      settings.allowUrls
        ? fieldRow(
            "jf-comment-website",
            ctx.t("comments.website"),
            `<input id="jf-comment-website" type="url" name="author_url" maxlength="500" autocomplete="url">`,
          )
        : ""
    }
    ${fieldRow(
      "jf-comment-body",
      ctx.t("comments.message"),
      `<textarea id="jf-comment-body" name="body" rows="5" maxlength="${settings.maxLength}" required></textarea>`,
    )}
    <p class="jf-comments__field jf-comments__field--check">
      <label><input type="checkbox" name="notify" value="1"> ${esc(ctx.t("comments.notify_me"))}</label>
    </p>
    ${captchaWidget}
    <button type="submit" class="jf-comments__submit">${esc(ctx.t("comments.submit"))}</button>
  </form>`;
}

export async function renderCommentsBlockHtml(
  rawProps: unknown,
  ctx: CommentsRenderContext,
): Promise<string> {
  const props = parseCommentsBlockProps(rawProps);
  const settings = await getCommentSettings(ctx.siteId);
  const state = commentsStateFor(
    { fields: ctx.content.fields, publishedAt: ctx.content.publishedAt },
    settings,
  );
  if (!state.visible) return "";

  const db = await getDb();
  const pageSize = settings.pageSize;
  const page = Math.max(1, ctx.page || 1);

  // Bounded: fetch this content's approved comments in one pass, then page the
  // top-level nodes in memory so replies always render under their parent even
  // when the parent is on an earlier page. The per-content row count is what an
  // editor moderates, so the ceiling is generous rather than tight.
  const MAX_ROWS = 2000;
  const rows = await db.query<CommentRow>(
    `SELECT id, parent_id, author_name, author_url, body, created_at, edited_at
       FROM comments
      WHERE site_id = ? AND content_id = ? AND status = 'approved'
      ORDER BY created_at ASC
      LIMIT ?`,
    [ctx.siteId, ctx.content.id, MAX_ROWS],
  );

  let roots = buildThread(rows);
  if (props.order === "newest") roots = [...roots].reverse();
  const totalPages = Math.max(1, Math.ceil(roots.length / pageSize));
  const clampedPage = Math.min(page, totalPages);
  const pageRoots = roots.slice((clampedPage - 1) * pageSize, clampedPage * pageSize);

  const listHtml = pageRoots.length
    ? `<ol class="jf-comments__list">${pageRoots
        .map((node) => renderNode(node, ctx, settings, state.accepting, 0))
        .join("")}</ol>`
    : `<p class="jf-comments__empty">${esc(ctx.t("comments.empty"))}</p>`;

  const pager =
    totalPages > 1
      ? `<nav class="jf-comments__pager" aria-label="${esc(ctx.t("comments.heading"))}">
          ${clampedPage > 1 ? `<a href="${esc(pageUrl(ctx.basePath, clampedPage - 1))}#jf-comments">«</a>` : ""}
          <span>${clampedPage} / ${totalPages}</span>
          ${
            clampedPage < totalPages
              ? `<a href="${esc(pageUrl(ctx.basePath, clampedPage + 1))}#jf-comments">»</a>`
              : ""
          }
        </nav>`
      : "";

  const count = rows.length;
  const heading = `<h2 class="jf-comments__heading">${esc(props.title || ctx.t("comments.heading"))}${
    count ? ` <span class="jf-comments__count">(${count})</span>` : ""
  }</h2>`;

  const form = state.accepting
    ? formHtml(ctx, settings)
    : `<p class="jf-comments__closed">${esc(ctx.t("comments.closed"))}</p>`;

  return `<section class="jf-comments" id="jf-comments">
    ${heading}
    ${bannerHtml(ctx)}
    ${listHtml}
    ${pager}
    ${form}
  </section>`;
}

// ─── Submission ─────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@<>,;:"'\\()[\]]{1,64}@[a-z0-9.-]{1,255}\.[a-z]{2,}$/i;

/**
 * Turn a submitted comment into safe stored HTML: blank lines become
 * paragraphs, single newlines become <br>, then sanitizeRichText keeps only a
 * small formatting whitelist (bold, italic, links, lists, quote, code) and
 * discards everything else — scripts and their contents included.
 */
export function sanitizeCommentBody(raw: string): string {
  const html = raw
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("");
  return sanitizeRichText(html);
}

/** Visible text of a stored comment body, for length checks and email digests. */
export function commentPlainText(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function headerText(value: string, max = 160): string {
  return value.replace(/[\r\n\0]/g, " ").trim().slice(0, max);
}

function sameOrigin(host: string | undefined, origin: string | undefined, referer: string | undefined): boolean {
  if (!host) return false;
  const candidate = origin || referer;
  if (!candidate) return false;
  try {
    return new URL(candidate).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

function countLinks(html: string): number {
  return (html.match(/https?:\/\//gi) ?? []).length;
}

function returnLocation(returnTo: string | undefined, referer: string | undefined, banner: CommentsBannerState): string {
  let path = "/";
  const source = returnTo || referer || "/";
  try {
    const url = new URL(source, "http://localhost");
    path = url.pathname + url.search;
  } catch {
    path = typeof source === "string" && source.startsWith("/") ? source : "/";
  }
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}comment=${banner}#jf-comments`;
}

export interface CommentSubmissionInput {
  body: Record<string, unknown>;
  host?: string;
  origin?: string;
  referer?: string;
  clientIp?: string;
  session?: { userId: string; siteId: string; email?: string } | null;
}

export interface CommentSubmissionResult {
  status: number;
  location?: string;
  error?: string;
}

export async function acceptCommentSubmission(
  input: CommentSubmissionInput,
): Promise<CommentSubmissionResult> {
  const ip = input.clientIp ?? "unknown";
  // Unauthenticated write. Without a ceiling a script fills the table and the
  // moderation queue; the honeypot below only stops the naive bots.
  if (!consumeRateLimit(`comment:ip:${ip}`, 5, 10 * 60 * 1000)) {
    return { status: 429, error: "Too many comments. Please try again later." };
  }

  if (!sameOrigin(input.host, input.origin, input.referer)) {
    return { status: 403, error: "Bad origin" };
  }

  const b = input.body;
  const returnTo = typeof b.return_to === "string" ? b.return_to : undefined;

  // Honeypot: a filled `website_url` is a bot. Behave like success so it learns
  // nothing, but write nothing.
  if (String(b.website_url ?? "").trim()) {
    return { status: 303, location: returnLocation(returnTo, input.referer, "pending") };
  }

  const db = await getDb();
  const siteRows = await db.query<{ id: string }>("SELECT id FROM sites LIMIT 1");
  const siteId = siteRows[0]?.id;
  if (!siteId) return { status: 404, error: "Comments are not available" };

  const settings = await getCommentSettings(siteId);

  const contentId = String(b.content_id ?? "").trim();
  if (!contentId) return { status: 400, error: "Missing post" };
  const contentRows = await db.query<{
    id: string;
    type: string;
    status: string;
    published_at: string | null;
    fields: unknown;
  }>(
    "SELECT id, type, status, published_at, fields FROM content WHERE id = ? AND site_id = ? LIMIT 1",
    [contentId, siteId],
  );
  const content = contentRows[0];
  if (!content || content.status !== "published") {
    return { status: 404, error: "Post not found" };
  }

  const fields = typeof content.fields === "string" ? safeParse(content.fields) : content.fields;
  const state = commentsStateFor({ fields, publishedAt: content.published_at }, settings);
  if (!state.visible || !state.accepting) {
    return { status: 403, error: "Comments are closed for this post" };
  }

  // CAPTCHA, when configured.
  if (settings.captchaProvider !== "none" && settings.captchaSiteKey) {
    const meta = CAPTCHA_META[settings.captchaProvider];
    const token = String(b[meta.field] ?? "").trim();
    const ok = await verifyCaptcha(settings.captchaProvider, settings.captchaSecretKey, token, ip);
    if (!ok) return { status: 400, location: returnLocation(returnTo, input.referer, "captcha") };
  }

  // Parent must be an approved comment on the same post, not too deep.
  let parentId: string | null = null;
  const rawParent = String(b.parent_id ?? "").trim();
  if (rawParent) {
    const parentRows = await db.query<{ id: string; parent_id: string | null; status: string; content_id: string }>(
      "SELECT id, parent_id, status, content_id FROM comments WHERE id = ? AND site_id = ? LIMIT 1",
      [rawParent, siteId],
    );
    const parent = parentRows[0];
    if (!parent || parent.status !== "approved" || parent.content_id !== contentId) {
      return { status: 400, error: "Cannot reply to that comment" };
    }
    if ((await commentDepth(db, siteId, parent.id)) + 1 >= settings.threadMaxDepth + 4) {
      return { status: 400, error: "Reply nesting is too deep" };
    }
    parentId = parent.id;
  }

  // Identity: a signed-in user's name/email is authoritative; otherwise take
  // what was typed.
  let authorName = String(b.author_name ?? "").trim().slice(0, 120);
  let authorEmail = String(b.author_email ?? "").trim().slice(0, 320);
  let userId: string | null = null;
  if (input.session?.userId) {
    const userRows = await db.query<{ display_name: string; username: string; email: string }>(
      "SELECT display_name, username, email FROM users WHERE id = ? AND site_id = ? LIMIT 1",
      [input.session.userId, siteId],
    );
    const u = userRows[0];
    if (u) {
      authorName = (u.display_name || u.username).slice(0, 120);
      authorEmail = u.email;
      userId = input.session.userId;
    }
  }

  if (!authorName) return { status: 400, error: "Name is required" };
  if (authorEmail && !EMAIL_RE.test(authorEmail)) return { status: 400, error: "Email looks invalid" };

  let authorUrl = "";
  if (settings.allowUrls) {
    const rawUrl = String(b.author_url ?? "").trim().slice(0, 500);
    if (rawUrl) {
      try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") authorUrl = parsed.toString();
      } catch {
        authorUrl = "";
      }
    }
  }

  const rawBody = String(b.body ?? "").trim();
  if (rawBody.length < 2) return { status: 400, error: "Comment is empty" };
  if (rawBody.length > settings.maxLength) return { status: 400, error: "Comment is too long" };
  const cleanBody = sanitizeCommentBody(rawBody);
  if (!commentPlainText(cleanBody)) {
    return { status: 400, error: "Comment is empty" };
  }

  const wantsNotify = (b.notify === "1" || b.notify === "on" || b.notify === true) && Boolean(authorEmail);
  const linky = countLinks(cleanBody) > 2;
  const status = settings.requireModeration || linky ? "pending" : "approved";

  const id = randomUUID();
  const nowIso = new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
  await db.run(
    `INSERT INTO comments
       (id, site_id, content_id, parent_id, author_name, author_email, author_url, body, status, user_id, ip_address, notify, unsubscribe_token, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      siteId,
      contentId,
      parentId,
      authorName,
      authorEmail || null,
      authorUrl || null,
      cleanBody,
      status,
      userId,
      ip.slice(0, 64),
      wantsNotify,
      wantsNotify ? randomUUID().replace(/-/g, "") : null,
      nowIso,
      nowIso,
    ],
  );

  if (status === "pending" && settings.notifyModerator) {
    void notifyModerator(siteId, authorName, cleanBody).catch(() => undefined);
  }
  if (status === "approved") {
    // A visible new comment invalidates the cached post page for everyone else.
    void import("./cache-revalidate.js")
      .then(({ revalidateOnUpdate }) => revalidateOnUpdate("content", { siteId }))
      .catch(() => undefined);
    if (parentId) void notifyParentAuthor(siteId, parentId, id).catch(() => undefined);
  }

  return {
    status: 303,
    location: returnLocation(returnTo, input.referer, status === "approved" ? "posted" : "pending"),
  };
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

async function commentDepth(
  db: Awaited<ReturnType<typeof getDb>>,
  siteId: string,
  commentId: string,
): Promise<number> {
  let depth = 0;
  let current: string | null = commentId;
  // Bounded walk up the parent chain.
  for (let i = 0; i < 50 && current; i++) {
    const rows: Array<{ parent_id: string | null }> = await db.query<{ parent_id: string | null }>(
      "SELECT parent_id FROM comments WHERE id = ? AND site_id = ? LIMIT 1",
      [current, siteId],
    );
    current = rows[0]?.parent_id ?? null;
    if (current) depth++;
  }
  return depth;
}

async function notifyModerator(siteId: string, author: string, body: string): Promise<void> {
  const general = await getGeneralSettings(siteId);
  if (!general.adminEmail) return;
  const { sendMail } = await import("./mail.js");
  const text = body.replace(/<[^>]*>/g, "").slice(0, 2000);
  const appUrl = process.env.APP_URL ?? "";
  await sendMail({
    to: general.adminEmail,
    subject: `New comment awaiting moderation from ${headerText(author, 80)}`,
    text: `A new comment is waiting in the moderation queue.\n\nFrom: ${headerText(
      author,
      80,
    )}\n\n${text}\n\n${appUrl ? `${appUrl.replace(/\/$/, "")}/admin/comments` : "Admin → Comments"}`,
  });
}

async function notifyParentAuthor(siteId: string, parentId: string, newCommentId: string): Promise<void> {
  const db = await getDb();
  const parentRows = await db.query<{ author_email: string | null; notify: unknown; unsubscribe_token: string | null }>(
    "SELECT author_email, notify, unsubscribe_token FROM comments WHERE id = ? AND site_id = ? LIMIT 1",
    [parentId, siteId],
  );
  const parent = parentRows[0];
  if (!parent?.author_email || !truthy(parent.notify)) return;

  const childRows = await db.query<{ author_name: string; body: string; content_id: string }>(
    "SELECT author_name, body, content_id FROM comments WHERE id = ? AND site_id = ? LIMIT 1",
    [newCommentId, siteId],
  );
  const child = childRows[0];
  if (!child) return;

  const slugRows = await db.query<{ slug: string; locale: string }>(
    "SELECT slug, locale FROM content WHERE id = ? LIMIT 1",
    [child.content_id],
  );
  const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");
  const postUrl = slugRows[0] ? `${appUrl}/${slugRows[0].slug}#jf-comment-${newCommentId}` : appUrl;
  const unsubUrl =
    appUrl && parent.unsubscribe_token
      ? `${appUrl}/justflows-comments/unsubscribe?token=${encodeURIComponent(parent.unsubscribe_token)}`
      : "";

  const { sendMail } = await import("./mail.js");
  const text = child.body.replace(/<[^>]*>/g, "").slice(0, 1500);
  await sendMail({
    to: parent.author_email,
    subject: `${headerText(child.author_name, 80)} replied to your comment`,
    text: `${headerText(child.author_name, 80)} replied to your comment:\n\n${text}\n\n${postUrl}${
      unsubUrl ? `\n\nStop these emails: ${unsubUrl}` : ""
    }`,
  });
}

function truthy(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "t" || value === "true";
}

/**
 * Called from the moderation route when a pending comment is approved, so a
 * reply that was held for moderation still notifies the parent author.
 */
export async function notifyOnApproval(siteId: string, commentIds: string[]): Promise<void> {
  const db = await getDb();
  for (const id of commentIds) {
    const rows = await db.query<{ parent_id: string | null; status: string }>(
      "SELECT parent_id, status FROM comments WHERE id = ? AND site_id = ? LIMIT 1",
      [id, siteId],
    );
    const row = rows[0];
    if (row?.status === "approved" && row.parent_id) {
      await notifyParentAuthor(siteId, row.parent_id, id).catch(() => undefined);
    }
  }
}

/** Unsubscribe a commenter from reply notifications. Returns rows touched. */
export async function clearCommentNotify(token: string): Promise<boolean> {
  const clean = token.trim();
  if (!clean || clean.length > 64) return false;
  const db = await getDb();
  const rows = await db.query<{ id: string }>(
    "SELECT id FROM comments WHERE unsubscribe_token = ? LIMIT 1",
    [clean],
  );
  if (!rows[0]) return false;
  await db.run("UPDATE comments SET notify = ? WHERE unsubscribe_token = ?", [false, clean]);
  return true;
}
