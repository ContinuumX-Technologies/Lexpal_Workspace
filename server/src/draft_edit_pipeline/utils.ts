/**
 * Creates a DocumentStore that can fetch full node content from a ProseMirror tree.
 * Assumes each participating block node has a unique stable id in `attrs.lexpalId`.
 */
import { PMNode } from "./edit_pipeline";

import type { NodeId } from "./edit_pipeline";

export type SeqNodeMap = Record<string, NodeId>;
export type LexpalToSequentialMap = Record<NodeId, string>;

const PIPELINE_BLOCK_TYPES = new Set([
  "doc",
  "heading",
  "paragraph",
  "table",
  "tableRow",
  "tableCell",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
]);

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;






/**
 * Returns a read‑only map of every node's stable ID to its PMNode.
 * Assumes each node stores its stable id in `attrs.lexpalId`.
 */
export const indexDocument = (root: PMNode): Record<NodeId, PMNode> => {

  const map: Record<NodeId, PMNode> = {};

  const walk = (node: PMNode) => {

    const id = node.attrs?.lexpalId;
    if (id) {
      if (map[id]) {
        throw new Error(`[indexDocument] Duplicate attrs.lexpalId detected: ${id}`);
      }
      map[id] = node;
    }
    node.content?.forEach(walk);

  };

  walk(root);

  return map;
};

/**
 * Creates an ephemeral sequential mapping for the current document version.
 * Example: { N1: <uuid>, N2: <uuid>, ... }
 *
 * Rules:
 * - Traverses in document order.
 * - Includes only block nodes that participate in the pipeline.
 * - Reads stable UUID from attrs.lexpalId.
 * - Throws on missing/invalid IDs.
 * - Throws on duplicate stable IDs.
 */
export const createSequentialNodeMap = (doc: PMNode): SeqNodeMap => {
  const seqNodeMap: SeqNodeMap = {};
  const seen = new Set<string>();
  let i = 1;

  const walk = (node: PMNode) => {
    if (PIPELINE_BLOCK_TYPES.has(node.type)) {
      const stableId = node.attrs?.lexpalId;

      if (typeof stableId !== "string" || stableId.trim() === "") {
        throw new Error(
          `[createSequentialNodeMap] Block node "${node.type}" is missing attrs.lexpalId`
        );
      }

      if (!UUID_REGEX.test(stableId)) {
        throw new Error(
          `[createSequentialNodeMap] Block node "${node.type}" has invalid attrs.lexpalId: ${stableId}`
        );
      }

      if (seen.has(stableId)) {
        throw new Error(
          `[createSequentialNodeMap] Duplicate attrs.lexpalId detected: ${stableId}`
        );
      }

      seen.add(stableId);
      seqNodeMap[`n${i}`] = stableId;
      i += 1;
    }

    node.content?.forEach(walk);
  };

  walk(doc);

  const ids = Object.values(seqNodeMap);
  if (new Set(ids).size !== ids.length) {
    throw new Error("[createSequentialNodeMap] seqNodeMap contains duplicate UUID values");
  }

  return seqNodeMap;
};

export const createLexpalToSequentialMap = (
  sequentialToLexpalMap: SeqNodeMap
): LexpalToSequentialMap => {
  const reverse: LexpalToSequentialMap = {};

  for (const [seq, lexpal] of Object.entries(sequentialToLexpalMap)) {
    if (reverse[lexpal]) {
      throw new Error(
        `[createLexpalToSequentialMap] Duplicate lexpalId in sequential map: ${lexpal}`
      );
    }

    reverse[lexpal] = seq;
  }

  return reverse;
};







/**
 * Serializes a ProseMirror document node back into PM-Lite markup string.
 * @param doc - A PMNode (typically the top-level `doc` node).
 * @returns A PM-Lite formatted string.
 */
export function pmNodeToMarkup(doc: PMNode): string {

  // ----- Helper functions -------------------------------------------------

  /**
   * Serializes a marks array into a comma-separated attribute value string.
   * e.g. `bold,link(href="https://...")`
   */
  function serializeMarks(marks: any[]): string | null {
    if (!marks || marks.length === 0) return null;
    return marks.map(m => {
      const attrs = m.attrs as Record<string, any> | undefined;
      const entries = attrs
        ? Object.entries(attrs).filter(([, v]) => v !== null && v !== undefined && v !== '')
        : [];
      if (entries.length === 0) return m.type as string;
      const attrStr = entries.map(([k, v]) => `${k}="${v}"`).join(' ');
      return `${m.type}(${attrStr})`;
    }).join(',');
  }

  /**
   * Builds a trailing attribute string from a flat key→value record.
   * Values containing spaces or special chars are double-quoted.
   */
  function buildAttrString(attrs: Record<string, any>): string {
    const parts = Object.entries(attrs)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => {
        const str = String(v);
        const needsQuotes = /[\s"=]/.test(str);
        return needsQuotes ? `${k}="${str.replace(/"/g, '\\"')}"` : `${k}=${str}`;
      });
    return parts.length > 0 ? ' ' + parts.join(' ') : '';
  }

  /**
   * Recursively serializes a single PMNode at a given indent depth.
   * Returns one or more PM-Lite lines.
   */
  function serializeNode(node: PMNode, depth: number): string[] {
    const indent = ' '.repeat(depth * 2);
    const lines: string[] = [];

    // ── text node ──────────────────────────────────────────────────────────
    if (node.type === 'text') {
      const marksStr = serializeMarks(node.marks ?? []);
      const attrPart = marksStr ? ` marks=${marksStr}` : '';
      lines.push(`${indent}!text${attrPart}: ${node.text ?? ''}`);
      return lines;
    }

    // ── block node ─────────────────────────────────────────────────────────
    const typeName = node.type;
    const rawAttrs = node.attrs ?? {};

    // Build type-specific attribute string, mirroring parsePML's mapping.
    let attrStr = '';
    if (typeName === 'heading') {
      const level = rawAttrs['level'];
      if (level !== undefined && level !== null) attrStr = ` level=${level}`;
    } else if (typeName === 'paragraph') {
      const align = rawAttrs['align'];
      if (align) attrStr = ` align=${align}`;
    } else if (typeName === 'orderedList') {
      // parsePML maps listType → order; reverse that here
      const order = rawAttrs['order'];
      if (order) attrStr = ` listType=${order}`;
    } else if (typeName === 'bulletList' || typeName === 'listItem') {
      // no special attrs
    } else {
      // Unknown node types: emit all non-null attrs
      attrStr = buildAttrString(rawAttrs);
    }

    const children = node.content ?? [];

    // Shorthand: single unmarked text child → `!type: text content`
    if (
      children.length === 1 &&
      children[0].type === 'text' &&
      (!children[0].marks || children[0].marks.length === 0)
    ) {
      lines.push(`${indent}!${typeName}${attrStr}: ${children[0].text ?? ''}`);
      return lines;
    }

    // Container node: children on subsequent indented lines.
    lines.push(`${indent}!${typeName}${attrStr}`);
    for (const child of children) {
      lines.push(...serializeNode(child, depth + 1));
    }

    return lines;
  }

  // ----- Main serialization -----------------------------------------------

  // Root `doc` is never emitted — only its children are.
  const allLines: string[] = [];
  for (const child of doc.content ?? []) {
    allLines.push(...serializeNode(child, 0));
  }

  return allLines.join('\n');
}
