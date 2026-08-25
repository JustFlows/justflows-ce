// SPDX-License-Identifier: MIT

import { getSiteSetting, setSiteSetting } from "./site-settings.js";
import { parsePageHeader, type PageHeaderConfig } from "./page-header.js";

/**
 * Saved headers: named snapshots of a page's header configuration that can be
 * applied to any other page.
 *
 * Unlike reusable blocks, a saved header is copied on apply rather than
 * resolved live at render — layout, sticky, and background are page-level
 * choices, so linking them would mean editing one page's header could
 * silently change another's. "Show header on this page" already covers the
 * "shared everywhere" case via the footer template part; this is for "start
 * from what I already built."
 */

const KEY = "header_presets";
const MAX_ITEMS = 100;
const MAX_NAME = 120;

export interface HeaderPreset {
  id: string;
  name: string;
  header: PageHeaderConfig;
  updatedAt: string;
}

function asName(raw: unknown, fallback: string): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  return (name || fallback).slice(0, MAX_NAME);
}

function asId(raw: unknown): string {
  const id = typeof raw === "string" ? raw : "";
  // Ids are used in URLs and matched on read; keep them boring.
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : "";
}

function normalize(raw: unknown): HeaderPreset | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const id = asId(item.id);
  if (!id) return null;
  return {
    id,
    name: asName(item.name, id),
    header: parsePageHeader(item.header),
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date().toISOString(),
  };
}

export async function listHeaderPresets(siteId: string): Promise<HeaderPreset[]> {
  const stored = await getSiteSetting<unknown[]>(siteId, KEY);
  if (!Array.isArray(stored)) return [];
  return stored.map(normalize).filter((item): item is HeaderPreset => item !== null);
}

export async function getHeaderPreset(siteId: string, id: string): Promise<HeaderPreset | null> {
  const list = await listHeaderPresets(siteId);
  return list.find((item) => item.id === id) ?? null;
}

/** Save the current header as a new named preset. Returns the stored form, id and all. */
export async function saveHeaderPreset(
  siteId: string,
  input: { name?: string; header: unknown },
): Promise<HeaderPreset> {
  const list = await listHeaderPresets(siteId);
  if (list.length >= MAX_ITEMS) throw new Error(`A site may hold at most ${MAX_ITEMS} saved headers`);
  const id = crypto.randomUUID();
  const entry = normalize({ id, name: input.name, header: input.header, updatedAt: new Date().toISOString() });
  if (!entry) throw new Error("Invalid header preset");
  await setSiteSetting(siteId, KEY, [entry, ...list]);
  return entry;
}

export async function deleteHeaderPreset(siteId: string, id: string): Promise<void> {
  const list = await listHeaderPresets(siteId);
  await setSiteSetting(siteId, KEY, list.filter((item) => item.id !== id));
}
