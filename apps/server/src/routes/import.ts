import { Router } from "express";
import { randomUUID } from "node:crypto";
import { requireRole } from "../middleware/auth.js";
import { getDb } from "../lib/db.js";
import multer from "multer";
import { sanitizeHtmlBlock } from "@justflows/blocks";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function now(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 200) || "untitled"
  );
}

function extractTag(xml: string, tag: string): string {
  const cdataRe = new RegExp(`<${tag}>[^<]*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>[^<]*</${tag}>`, "i");
  const plainRe = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i");
  return (xml.match(cdataRe)?.[1] ?? xml.match(plainRe)?.[1] ?? "").trim();
}

function extractAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, "g");
  return xml.match(re) ?? [];
}

router.post("/wordpress", requireRole("administrator"), upload.single("file"), async (req, res) => {
  const session = req.session!;

  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }
    if (!file.originalname.endsWith(".xml")) {
      res.status(400).json({ error: "Please upload a WordPress .xml export file" });
      return;
    }

    const xml = file.buffer.toString("utf-8");
    if (!xml.includes("xmlns:wp=") && !xml.includes("WXR")) {
      res.status(422).json({ error: "File does not appear to be a WordPress WXR export" });
      return;
    }

    const db = await getDb();
    const result = { imported: { posts: 0, pages: 0, skipped: 0 }, errors: [] as string[] };
    const items = extractAll(xml, "item");

    for (const item of items) {
      try {
        const postType = extractTag(item, "wp:post_type");
        if (postType !== "post" && postType !== "page") {
          result.imported.skipped++;
          continue;
        }

        const status = extractTag(item, "wp:status");
        const mappedStatus = status === "publish" ? "published" : "draft";
        const title = extractTag(item, "title") || "Untitled";
        const wpSlug = extractTag(item, "wp:post_name");
        const slug = wpSlug ? slugify(wpSlug) : slugify(title);
        const content = extractTag(item, "content:encoded");
        const excerpt = extractTag(item, "excerpt:encoded");
        const pubDate = extractTag(item, "pubDate");

        const blocks = {
          version: 1 as const,
          blocks: content
            ? [{ id: randomUUID(), type: "core.html", version: 1, props: { html: sanitizeHtmlBlock(content) } }]
            : [],
        };

        const id = randomUUID();
        const publishedAt = pubDate
          ? new Date(pubDate).toISOString().replace("T", " ").replace(/\.\d+Z$/, "")
          : null;

        await db
          .run(
            `INSERT INTO content (id, site_id, type, title, slug, excerpt, blocks, fields, status, author_id, published_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?)`,
            [
              id,
              session.siteId,
              postType,
              title,
              slug,
              excerpt || null,
              JSON.stringify(blocks),
              mappedStatus,
              session.userId,
              publishedAt,
              now(),
              now(),
            ],
          )
          .catch(async (e: unknown) => {
            const msg = String(e);
            if (msg.includes("Duplicate") || msg.includes("unique")) {
              return db.run(
                `INSERT INTO content (id, site_id, type, title, slug, excerpt, blocks, fields, status, author_id, published_at, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?)`,
                [
                  id,
                  session.siteId,
                  postType,
                  title,
                  `${slug}-${id.slice(0, 8)}`,
                  excerpt || null,
                  JSON.stringify(blocks),
                  mappedStatus,
                  session.userId,
                  publishedAt,
                  now(),
                  now(),
                ],
              );
            }
            throw e;
          });

        if (postType === "post") result.imported.posts++;
        else result.imported.pages++;
      } catch (err) {
        result.errors.push(String(err));
      }
    }

    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
