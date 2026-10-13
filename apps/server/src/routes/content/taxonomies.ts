// SPDX-License-Identifier: MIT

import { Router, type Response } from "express";
import { z } from "zod";
import {
  createTaxonomy,
  createTerm,
  deleteTaxonomy,
  deleteTerm,
  getTaxonomy,
  listTaxonomies,
  listTerms,
  TaxonomyCreateSchema,
  TaxonomyError,
  TaxonomyPatchSchema,
  TermCreateSchema,
  TermPatchSchema,
  updateTaxonomy,
  updateTerm,
} from "../../lib/content/taxonomies-db.js";
import { requireCapability } from "../../middleware/auth.js";
import { param } from "../../lib/http/params.js";
import { sendServerError } from "../../lib/http/send-error.js";

const router = Router();

function sendTaxonomyError(res: Response, err: unknown): void {
  if (err instanceof TaxonomyError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  sendServerError(res, "taxonomies", err);
}

function invalid(res: Response, error: z.ZodError): void {
  res.status(400).json({ error: error.issues[0]?.message ?? "Invalid request" });
}

const TermIdSchema = z.string().uuid();

router.get("/", requireCapability("content:read"), async (req, res) => {
  try {
    res.json({ taxonomies: await listTaxonomies(req.session!.siteId) });
  } catch (err) {
    sendTaxonomyError(res, err);
  }
});

router.post("/", requireCapability("settings:manage"), async (req, res) => {
  const body = TaxonomyCreateSchema.safeParse(req.body);
  if (!body.success) return invalid(res, body.error);
  try {
    res.status(201).json({ taxonomy: await createTaxonomy(req.session!.siteId, body.data) });
  } catch (err) {
    sendTaxonomyError(res, err);
  }
});

router.get("/:slug", requireCapability("content:read"), async (req, res) => {
  try {
    const taxonomy = await getTaxonomy(req.session!.siteId, param(req.params.slug));
    if (!taxonomy) {
      res.status(404).json({ error: "Taxonomy not found" });
      return;
    }
    res.json({ taxonomy });
  } catch (err) {
    sendTaxonomyError(res, err);
  }
});

router.patch("/:slug", requireCapability("settings:manage"), async (req, res) => {
  const body = TaxonomyPatchSchema.safeParse(req.body);
  if (!body.success) return invalid(res, body.error);
  try {
    res.json({ taxonomy: await updateTaxonomy(req.session!.siteId, param(req.params.slug), body.data) });
  } catch (err) {
    sendTaxonomyError(res, err);
  }
});

router.delete("/:slug", requireCapability("settings:manage"), async (req, res) => {
  try {
    await deleteTaxonomy(req.session!.siteId, param(req.params.slug));
    res.json({ ok: true });
  } catch (err) {
    sendTaxonomyError(res, err);
  }
});

router.get("/:slug/terms", requireCapability("content:read"), async (req, res) => {
  try {
    res.json({ terms: await listTerms(req.session!.siteId, param(req.params.slug)) });
  } catch (err) {
    sendTaxonomyError(res, err);
  }
});

// Managing terms is an editorial task: the roles that publish any entry.
router.post("/:slug/terms", requireCapability("content:publish"), async (req, res) => {
  const body = TermCreateSchema.safeParse(req.body);
  if (!body.success) return invalid(res, body.error);
  try {
    res.status(201).json({ term: await createTerm(req.session!.siteId, param(req.params.slug), body.data) });
  } catch (err) {
    sendTaxonomyError(res, err);
  }
});

router.patch("/:slug/terms/:id", requireCapability("content:publish"), async (req, res) => {
  const id = TermIdSchema.safeParse(param(req.params.id));
  if (!id.success) return invalid(res, id.error);
  const body = TermPatchSchema.safeParse(req.body);
  if (!body.success) return invalid(res, body.error);
  try {
    res.json({ term: await updateTerm(req.session!.siteId, param(req.params.slug), id.data, body.data) });
  } catch (err) {
    sendTaxonomyError(res, err);
  }
});

router.delete("/:slug/terms/:id", requireCapability("content:publish"), async (req, res) => {
  const id = TermIdSchema.safeParse(param(req.params.id));
  if (!id.success) return invalid(res, id.error);
  try {
    await deleteTerm(req.session!.siteId, param(req.params.slug), id.data);
    res.json({ ok: true });
  } catch (err) {
    sendTaxonomyError(res, err);
  }
});

export default router;
