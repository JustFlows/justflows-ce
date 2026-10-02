// SPDX-License-Identifier: MIT

import { randomUUID } from "node:crypto";
import type { BlockDefinition, BlockRegistry } from "@justflows/blocks";

/**
 * Strict validation of block content written by an AI agent.
 *
 * The admin editor can only produce block types it lists, so the write path
 * only sanitizes. An agent can send anything, so its block document is checked
 * against the live block registry first: unknown types are rejected with the
 * list of valid ones, required schema fields must be present, select fields
 * must hold one of their options, children are allowed only where the block
 * supports them, and each block's own `validateProps` must accept the props.
 * The platform sanitizer still runs afterwards in the shared write path.
 *
 * Errors are phrased for a model to act on: they name the block's path and
 * what to change.
 */

export interface BlockValidationResult {
  ok: boolean;
  /** Normalized `{ version: 1, blocks }` with an `id` on every node. */
  document: { version: 1; blocks: unknown[] };
  errors: string[];
}

const MAX_DEPTH = 12;
const MAX_NODES = 2_000;

/** Props every block carries that the platform owns (see docs/BLOCKS.md), listed for describeBlockCatalog. */
export const PLATFORM_PROPS = ["animation", "className", "css", "gridPlacement", "style", "devices"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function validTypesHint(registry: BlockRegistry): string {
  const types = registry
    .list()
    .map((def) => def.type)
    .sort();
  return types.join(", ");
}

function checkProps(def: BlockDefinition, props: Record<string, unknown>, where: string, errors: string[]): void {
  for (const [field, spec] of Object.entries(def.schema ?? {})) {
    const value = props[field];
    if (spec.required && isBlank(value)) {
      errors.push(`${where} (${def.type}): required prop "${field}" is missing.`);
      continue;
    }
    if (spec.type === "select" && spec.options?.length && value !== undefined && value !== null && value !== "") {
      const values = spec.multiple && Array.isArray(value) ? value : [value];
      const bad = values.filter((item) => !spec.options!.includes(String(item)));
      if (bad.length > 0) {
        errors.push(
          `${where} (${def.type}): prop "${field}" must be one of ${spec.options.join(", ")}; got ${JSON.stringify(bad[0])}.`,
        );
      }
    }
    if (spec.type === "number" && value !== undefined && value !== null && value !== "" && !Number.isFinite(Number(value))) {
      errors.push(`${where} (${def.type}): prop "${field}" must be a number.`);
    }
    if (spec.type === "boolean" && value !== undefined && value !== null && typeof value !== "boolean") {
      errors.push(`${where} (${def.type}): prop "${field}" must be true or false.`);
    }
  }
  // Props outside `schema` are not an error: platform props (PLATFORM_PROPS)
  // are owned by the sanitizer, and a plugin block may accept props it does not
  // list. validateProps decides what survives.
  try {
    def.validateProps(props);
  } catch (err) {
    errors.push(
      `${where} (${def.type}): props were rejected — ${err instanceof Error ? err.message : String(err)}.`,
    );
  }
}

export function validateAgentBlockDocument(input: unknown, registry: BlockRegistry): BlockValidationResult {
  const errors: string[] = [];
  let count = 0;
  let unknownReported = false;

  const raw = Array.isArray(input) ? input : isRecord(input) ? input.blocks : undefined;
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      document: { version: 1, blocks: [] },
      errors: ['Block content must be { "version": 1, "blocks": [ … ] } or an array of blocks.'],
    };
  }

  function visit(node: unknown, where: string, depth: number, parent: BlockDefinition | null): unknown {
    count += 1;
    if (count > MAX_NODES) {
      if (count === MAX_NODES + 1) errors.push(`Too many blocks: the limit is ${MAX_NODES}.`);
      return null;
    }
    if (!isRecord(node)) {
      errors.push(`${where}: each block must be an object with "type" and "props".`);
      return null;
    }
    const type = typeof node.type === "string" ? node.type : "";
    const def = type ? registry.get(type) : undefined;
    if (!def) {
      errors.push(
        `${where}: unknown block type ${JSON.stringify(type)}.` +
          (unknownReported ? "" : ` Valid types: ${validTypesHint(registry)}.`),
      );
      unknownReported = true;
      return null;
    }
    if (parent?.allowedChildTypes?.length && !parent.allowedChildTypes.includes(type)) {
      errors.push(`${where}: ${parent.type} only accepts ${parent.allowedChildTypes.join(", ")} as children.`);
    }
    const props = isRecord(node.props) ? node.props : {};
    if (node.props !== undefined && !isRecord(node.props)) {
      errors.push(`${where} (${type}): "props" must be an object.`);
    }
    checkProps(def, props, where, errors);

    let children: unknown[] | undefined;
    if (node.children !== undefined) {
      if (!Array.isArray(node.children)) {
        errors.push(`${where} (${type}): "children" must be an array.`);
      } else if (node.children.length > 0 && !def.supportsChildren) {
        errors.push(`${where} (${type}): this block cannot contain child blocks.`);
      } else if (depth >= MAX_DEPTH) {
        errors.push(`${where}: blocks are nested too deeply (limit ${MAX_DEPTH}).`);
      } else {
        children = node.children.map((child, index) => visit(child, `${where}.children[${index}]`, depth + 1, def));
      }
    }
    const id = typeof node.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(node.id) ? node.id : randomUUID();
    return { id, type, props, ...(children ? { children } : {}) };
  }

  const blocks = raw.map((node, index) => visit(node, `blocks[${index}]`, 0, null));
  return { ok: errors.length === 0, document: { version: 1, blocks }, errors: errors.slice(0, 25) };
}

/** A compact, model-readable catalog of the registered blocks and their props. */
export function describeBlockCatalog(registry: BlockRegistry) {
  return registry
    .list()
    .map((def) => ({
      type: def.type,
      title: def.title,
      description: def.description,
      category: def.category ?? "content",
      supportsChildren: def.supportsChildren ?? false,
      allowedChildTypes: def.allowedChildTypes,
      props: Object.fromEntries(
        Object.entries(def.schema ?? {}).map(([name, spec]) => [
          name,
          {
            type: spec.type,
            ...(spec.required ? { required: true } : {}),
            ...(spec.default !== undefined ? { default: spec.default } : {}),
            ...(spec.options ? { options: spec.options } : {}),
            ...(spec.multiple ? { multiple: true } : {}),
            ...(spec.help ? { help: spec.help } : {}),
          },
        ]),
      ),
    }))
    .sort((a, b) => a.type.localeCompare(b.type));
}
