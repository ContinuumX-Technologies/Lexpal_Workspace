/**
 * parseDocxToPMJson.ts
 *
 * Production-grade DOCX → ProseMirror JSON parser.
 *
 * Supported extensions (matching your TipTap setup):
 *   StarterKit (doc, paragraph, text, heading, bold, italic, strike,
 *               code, codeBlock, blockquote, bulletList, listItem,
 *               hardBreak, horizontalRule)
 *   OrderedListStyled  – ordered list (maps to orderedList node)
 *   Table / TableRow / TableCell / TableHeader
 *   TextStyle + FontFamily + FontSize + Color  – inline style marks
 *   Highlight (multicolor)
 *   Underline
 *   Image (inline)
 *   TextAlign (paragraph / heading)
 *   PageBreak  – custom node
 *
 * Dependencies (already common in React projects):
 *   
 *   jszip    – npm install jszip   (mammoth already depends on it)
 */


import JSZip from "jszip";

// ─── Types ───────────────────────────────────────────────────────────────────

interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  marks?: PMMark[];
  text?: string;
}

interface PMMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface RunFormatting {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  code?: boolean;
  color?: string | null;
  highlight?: string | null;
  fontSize?: string | null;
  fontFamily?: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const A_NS  = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PIC_NS = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const MC_NS = "http://schemas.openxmlformats.org/markup-compatibility/2006";

// Word heading style ids → ProseMirror heading level
const HEADING_LEVEL: Record<string, number> = {
  heading1: 1, heading2: 2, heading3: 3,
  heading4: 4, heading5: 5, heading6: 6,
  // some docs use Title / Subtitle
  title: 1, subtitle: 2,
};

// Word list number formats → whether to treat as ordered
const ORDERED_FORMATS = new Set([
  "decimal", "upperRoman", "lowerRoman",
  "upperLetter", "lowerLetter", "ordinal",
  "decimalZero", "decimalFullWidth",
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function wTag(el: Element, local: string): Element | null {
  return el.getElementsByTagNameNS(W_NS, local)[0] ?? null;
}

function wTags(el: Element, local: string): Element[] {
  return Array.from(el.getElementsByTagNameNS(W_NS, local));
}

function wAttr(el: Element | null, local: string): string | null {
  if (!el) return null;
  return el.getAttributeNS(W_NS, local) ?? el.getAttribute(`w:${local}`) ?? null;
}

function parseXml(raw: string): Document {
  return new DOMParser().parseFromString(raw, "application/xml");
}

/** Convert half-points (Word) to "Xpt" string for FontSize */
function halfPtToPt(hp: string | null): string | null {
  if (!hp) return null;
  const n = parseInt(hp, 10);
  if (isNaN(n)) return null;
  return `${n / 2}pt`;
}

/** Strip leading # from Word theme colour hex, return #RRGGBB or null */
function normaliseColor(raw: string | null): string | null {
  if (!raw || raw.toLowerCase() === "auto" || raw.toLowerCase() === "none") return null;
  const hex = raw.replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return `#${hex.toUpperCase()}`;
}

/** Word highlight name → CSS color */
const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: "#FFFF00", green: "#00FF00", cyan: "#00FFFF",
  magenta: "#FF00FF", blue: "#0000FF", red: "#FF0000",
  darkBlue: "#000080", darkCyan: "#008080", darkGreen: "#008000",
  darkMagenta: "#800080", darkRed: "#800000", darkYellow: "#808000",
  darkGray: "#808080", lightGray: "#C0C0C0", black: "#000000", white: "#FFFFFF",
};

function highlightNameToColor(name: string | null): string | null {
  if (!name || name === "none") return null;
  return HIGHLIGHT_COLORS[name] ?? null;
}

/** Convert Word EMU to pixels (96 dpi) */
function emuToPx(emu: number): number {
  return Math.round(emu / 914400 * 96);
}

// ─── Numbering resolver ───────────────────────────────────────────────────────

interface ListLevel {
  ordered: boolean;
  start: number;
  indent: number;
}

interface AbstractNum {
  levels: Map<number, ListLevel>;
}

class NumberingResolver {
  private abstractNums = new Map<string, AbstractNum>();
  private numMap = new Map<string, string>(); // numId → abstractNumId

  load(xml: Document): void {
    // Abstract nums
    for (const abstractNum of Array.from(xml.getElementsByTagNameNS(W_NS, "abstractNum"))) {
      const id = wAttr(abstractNum, "abstractNumId") ?? "";
      const levels = new Map<number, ListLevel>();

      for (const lvl of Array.from(abstractNum.getElementsByTagNameNS(W_NS, "lvl"))) {
        const ilvl = parseInt(wAttr(lvl, "ilvl") ?? "0", 10);
        const numFmt = wAttr(wTag(lvl, "numFmt"), "val") ?? "bullet";
        const startEl = wTag(lvl, "start");
        const start = parseInt(wAttr(startEl, "val") ?? "1", 10);
        const indEl = wTag(wTag(lvl, "pPr") ?? lvl, "ind");
        const indent = parseInt(wAttr(indEl, "left") ?? "0", 10);
        levels.set(ilvl, { ordered: ORDERED_FORMATS.has(numFmt), start, indent });
      }
      this.abstractNums.set(id, { levels });
    }

    // Num → abstractNum mapping
    for (const num of Array.from(xml.getElementsByTagNameNS(W_NS, "num"))) {
      const numId = wAttr(num, "numId") ?? "";
      const abstractNumId = wAttr(wTag(num, "abstractNumId"), "val") ?? "";
      this.numMap.set(numId, abstractNumId);
    }
  }

  resolve(numId: string, ilvl: number): ListLevel | null {
    const abstractId = this.numMap.get(numId);
    if (!abstractId) return null;
    const abs = this.abstractNums.get(abstractId);
    if (!abs) return null;
    return abs.levels.get(ilvl) ?? { ordered: false, start: 1, indent: 0 };
  }
}

// ─── Image resolver ───────────────────────────────────────────────────────────

class ImageResolver {
  private rels = new Map<string, string>();        // rId → target path in zip
  private blobs = new Map<string, string>();        // path → data-URI

  async load(zip: JSZip, relsPath: string): Promise<void> {
    const relsFile = zip.file(relsPath);
    if (!relsFile) return;
    const raw = await relsFile.async("string");
    const doc = parseXml(raw);
    for (const rel of Array.from(doc.getElementsByTagName("Relationship"))) {
      const id     = rel.getAttribute("Id") ?? "";
      const type   = rel.getAttribute("Type") ?? "";
      const target = rel.getAttribute("Target") ?? "";
      if (type.endsWith("/image")) {
        // target is relative to word/
        const fullPath = target.startsWith("/")
          ? target.slice(1)
          : `word/${target.replace(/^\.\//, "")}`;
        this.rels.set(id, fullPath);
      }
    }
  }

  async resolveBlob(zip: JSZip, rId: string): Promise<string | null> {
    const path = this.rels.get(rId);
    if (!path) return null;
    if (this.blobs.has(path)) return this.blobs.get(path)!;

    const file = zip.file(path);
    if (!file) return null;

    const ext = path.split(".").pop()?.toLowerCase() ?? "png";
    const mime: Record<string, string> = {
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
      gif: "image/gif", bmp: "image/bmp", svg: "image/svg+xml",
      webp: "image/webp", tiff: "image/tiff", emf: "image/x-emf",
    };
    const mimeType = mime[ext] ?? "application/octet-stream";
    const b64 = await file.async("base64");
    const dataUri = `data:${mimeType};base64,${b64}`;
    this.blobs.set(path, dataUri);
    return dataUri;
  }
}

// ─── Run formatting ───────────────────────────────────────────────────────────

function extractRunFormatting(rPr: Element | null): RunFormatting {
  if (!rPr) return {};

  const fmt: RunFormatting = {};

  // Bold
  const bold = wTag(rPr, "b");
  if (bold) {
    const val = wAttr(bold, "val");
    fmt.bold = val !== "false" && val !== "0";
  }

  // Italic
  const italic = wTag(rPr, "i");
  if (italic) {
    const val = wAttr(italic, "val");
    fmt.italic = val !== "false" && val !== "0";
  }

  // Underline
  const u = wTag(rPr, "u");
  if (u) {
    const val = wAttr(u, "val");
    fmt.underline = val !== "none" && val != null;
  }

  // Strikethrough
  const strike = wTag(rPr, "strike") ?? wTag(rPr, "dstrike");
  if (strike) {
    const val = wAttr(strike, "val");
    fmt.strikethrough = val !== "false" && val !== "0";
  }

  // Code (vertAlign = superscript/subscript handled separately)
  // Word has no native "code" run style; we detect monospace fonts below

  // Font
  const rFonts = wTag(rPr, "rFonts");
  if (rFonts) {
    const font =
      rFonts.getAttributeNS(W_NS, "ascii") ??
      rFonts.getAttribute("w:ascii") ??
      rFonts.getAttributeNS(W_NS, "hAnsi") ??
      rFonts.getAttribute("w:hAnsi") ?? null;
    if (font) {
      fmt.fontFamily = font;
      // Heuristic: treat common monospace fonts as inline code
      if (/courier|consolas|monospace|lucida console|monaco|menlo/i.test(font)) {
        fmt.code = true;
      }
    }
  }

  // Font size (half-points)
  const sz = wTag(rPr, "sz");
  if (sz) fmt.fontSize = halfPtToPt(wAttr(sz, "val"));

  // Color
  const color = wTag(rPr, "color");
  if (color) fmt.color = normaliseColor(wAttr(color, "val"));

  // Highlight
  const highlight = wTag(rPr, "highlight");
  if (highlight) fmt.highlight = highlightNameToColor(wAttr(highlight, "val"));

  // shd (cell/para shading) as highlight fallback — skip for runs unless explicit
  return fmt;
}

function formattingToMarks(fmt: RunFormatting): PMMark[] {
  const marks: PMMark[] = [];

  if (fmt.bold)          marks.push({ type: "bold" });
  if (fmt.italic)        marks.push({ type: "italic" });
  if (fmt.underline)     marks.push({ type: "underline" });
  if (fmt.strikethrough) marks.push({ type: "strike" });
  if (fmt.code)          marks.push({ type: "code" });

  // TextStyle — only emit if we have something to say
  if (fmt.color || fmt.fontSize || fmt.fontFamily) {
    const attrs: Record<string, unknown> = {};
    if (fmt.color)      attrs.color      = fmt.color;
    if (fmt.fontSize)   attrs.fontSize   = fmt.fontSize;
    if (fmt.fontFamily) attrs.fontFamily = fmt.fontFamily;
    marks.push({ type: "textStyle", attrs });
  }

  if (fmt.highlight) {
    marks.push({ type: "highlight", attrs: { color: fmt.highlight } });
  }

  return marks;
}

// ─── Paragraph alignment ──────────────────────────────────────────────────────

function extractAlignment(pPr: Element | null): string | null {
  if (!pPr) return null;
  const jc = wTag(pPr, "jc");
  const val = wAttr(jc, "val");
  const map: Record<string, string> = {
    left: "left", right: "right", center: "center",
    both: "justify", distribute: "justify",
  };
  return val ? (map[val] ?? null) : null;
}

// ─── Main parser ─────────────────────────────────────────────────────────────

export async function parseDocxToPMJson(file: File): Promise<PMNode> {
  // ── 1. Load ZIP ──────────────────────────────────────────────────────────
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  // ── 2. Load relationships & numbering ───────────────────────────────────
  const numbering = new NumberingResolver();
  const numberingFile = zip.file("word/numbering.xml");
  if (numberingFile) {
    const raw = await numberingFile.async("string");
    numbering.load(parseXml(raw));
  }

  const images = new ImageResolver();
  await images.load(zip, "word/_rels/document.xml.rels");

  // ── 3. Parse document.xml ───────────────────────────────────────────────
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("Not a valid DOCX: word/document.xml missing");

  const docRaw = await docFile.async("string");
  const docXml = parseXml(docRaw);

  const body = docXml.getElementsByTagNameNS(W_NS, "body")[0];
  if (!body) throw new Error("word/document.xml has no <w:body>");

  const children = await parseBody(body, numbering, images, zip);

  // ProseMirror doc always needs at least one child
  if (children.length === 0) {
    children.push({ type: "paragraph", content: [] });
  }

  return { type: "doc", content: children };
}

// ─── Body ─────────────────────────────────────────────────────────────────────

async function parseBody(
  body: Element,
  numbering: NumberingResolver,
  images: ImageResolver,
  zip: JSZip,
): Promise<PMNode[]> {
  const nodes: PMNode[] = [];
  const directChildren = Array.from(body.childNodes).filter(
    (n): n is Element => n.nodeType === Node.ELEMENT_NODE,
  );

  // We process paragraphs in sequence; list items need to be grouped
  // into list nodes.  We use a stack for nested lists.
  interface ListFrame {
    node: PMNode;           // bulletList / orderedList
    numId: string;
    ilvl: number;
  }
  const listStack: ListFrame[] = [];

  const flushLists = () => {
    while (listStack.length) {
      const frame = listStack.pop()!;
      // If there's a parent frame, push into it; otherwise push to nodes
      if (listStack.length) {
        const parent = listStack[listStack.length - 1];
        const lastListItem = parent.node.content![parent.node.content!.length - 1];
        (lastListItem.content = lastListItem.content ?? []).push(frame.node);
      } else {
        nodes.push(frame.node);
      }
    }
  };

  for (const el of directChildren) {
    const localName = el.localName ?? el.nodeName.split(":").pop() ?? "";

    if (localName === "p") {
      const result = await parseParagraph(el, numbering, images, zip);

      if (result.listInfo) {
        const { numId, ilvl, ordered, start, pmNode: listItem } = result.listInfo;

        // Determine if we need to push / pop stack frames
        // Find the matching level in the stack
        let matchIdx = -1;
        for (let i = listStack.length - 1; i >= 0; i--) {
          if (listStack[i].numId === numId && listStack[i].ilvl === ilvl) {
            matchIdx = i;
            break;
          }
        }

        if (matchIdx === listStack.length - 1 && matchIdx >= 0) {
          // Same level — append listItem
          listStack[matchIdx].node.content!.push(listItem);
        } else if (ilvl > (listStack.length ? listStack[listStack.length - 1].ilvl : -1)) {
          // Deeper level — push new list
          const newList: PMNode = {
            type: ordered ? "orderedList" : "bulletList",
            attrs: ordered ? { start, "data-list-style-type": "decimal" } : {},
            content: [listItem],
          };
          listStack.push({ node: newList, numId, ilvl });
        } else {
          // Shallower or different list — flush down to matching level
          while (
            listStack.length > 0 &&
            (listStack[listStack.length - 1].ilvl > ilvl ||
              listStack[listStack.length - 1].numId !== numId)
          ) {
            const popped = listStack.pop()!;
            if (listStack.length) {
              const parent = listStack[listStack.length - 1];
              const lastItem = parent.node.content![parent.node.content!.length - 1];
              (lastItem.content = lastItem.content ?? []).push(popped.node);
            } else {
              nodes.push(popped.node);
            }
          }

          if (listStack.length && listStack[listStack.length - 1].ilvl === ilvl) {
            listStack[listStack.length - 1].node.content!.push(listItem);
          } else {
            const newList: PMNode = {
              type: ordered ? "orderedList" : "bulletList",
              attrs: ordered ? { start, "data-list-style-type": "decimal" } : {},
              content: [listItem],
            };
            listStack.push({ node: newList, numId, ilvl });
          }
        }
      } else {
        // Not a list item — flush pending lists first
        flushLists();
        if (result.pmNode) nodes.push(result.pmNode);
      }
    } else if (localName === "tbl") {
      flushLists();
      const tableNode = await parseTable(el, numbering, images, zip);
      if (tableNode) nodes.push(tableNode);
    } else if (localName === "sdt") {
      // Structured Document Tag — recurse into sdtContent
      flushLists();
      const sdtContent = el.getElementsByTagNameNS(W_NS, "sdtContent")[0];
      if (sdtContent) {
        const inner = await parseBody(sdtContent as Element, numbering, images, zip);
        nodes.push(...inner);
      }
    }
    // sectPr and others are intentionally ignored
  }

  flushLists();
  return nodes;
}

// ─── Paragraph ────────────────────────────────────────────────────────────────

interface ParagraphResult {
  pmNode: PMNode | null;
  listInfo?: {
    numId: string;
    ilvl: number;
    ordered: boolean;
    start: number;
    pmNode: PMNode; // the listItem node
  };
}

async function parseParagraph(
  p: Element,
  numbering: NumberingResolver,
  images: ImageResolver,
  zip: JSZip,
): Promise<ParagraphResult> {
  const pPr   = wTag(p, "pPr");
  const pStyle = wAttr(wTag(pPr ?? p, "pStyle"), "val") ?? "";
  const normalised = pStyle.toLowerCase().replace(/\s+/g, "");

  // ── Detect list paragraph ───────────────────────────────────────────────
  const numPr  = pPr ? wTag(pPr, "numPr") : null;
  const numId  = wAttr(wTag(numPr ?? p, "numId"), "val");
  const ilvlEl = wTag(numPr ?? p, "ilvl");
  const ilvl   = parseInt(wAttr(ilvlEl, "val") ?? "0", 10);

  // ── Page break detection ────────────────────────────────────────────────
  // <w:lastRenderedPageBreak> or <w:br w:type="page">
  const allBrs = Array.from(p.getElementsByTagNameNS(W_NS, "br"));
  const hasPageBreak = allBrs.some(
    (br) => (wAttr(br, "type") ?? "textWrapping") === "page",
  );

  // ── Parse inline content ────────────────────────────────────────────────
  const inlineContent = await parseInlineContent(p, images, zip);

  // If paragraph is ONLY a page break, return a pageBreak node
  if (hasPageBreak && inlineContent.length === 0) {
    return { pmNode: { type: "pageBreak" } };
  }

  // ── Heading detection ────────────────────────────────────────────────────
  const headingLevel = HEADING_LEVEL[normalised];
  if (headingLevel) {
    const align = extractAlignment(pPr);
    const attrs: Record<string, unknown> = { level: headingLevel };
    if (align) attrs.textAlign = align;
    return {
      pmNode: {
        type: "heading",
        attrs,
        content: inlineContent.length ? inlineContent : [{ type: "text", text: "" }],
      },
    };
  }

  // ── Code block ──────────────────────────────────────────────────────────
  if (normalised === "codeblock" || normalised === "code") {
    const text = inlineContent.map((n) => n.text ?? "").join("");
    return {
      pmNode: {
        type: "codeBlock",
        attrs: { language: null },
        content: [{ type: "text", text }],
      },
    };
  }

  // ── Blockquote ───────────────────────────────────────────────────────────
  if (normalised === "blocktext" || normalised === "quote" || normalised === "blockquote") {
    const align = extractAlignment(pPr);
    const paraAttrs: Record<string, unknown> = {};
    if (align) paraAttrs.textAlign = align;
    return {
      pmNode: {
        type: "blockquote",
        content: [
          {
            type: "paragraph",
            attrs: Object.keys(paraAttrs).length ? paraAttrs : undefined,
            content: inlineContent,
          },
        ],
      },
    };
  }

  // ── Horizontal rule ─────────────────────────────────────────────────────
  if (normalised === "horizontalline" || normalised === "separator") {
    return { pmNode: { type: "horizontalRule" } };
  }
  // Also detect an empty paragraph preceded by a border bottom
  if (pPr) {
    const pBdr = wTag(pPr, "pBdr");
    const bottom = pBdr ? wTag(pBdr, "bottom") : null;
    if (bottom && inlineContent.length === 0) {
      return { pmNode: { type: "horizontalRule" } };
    }
  }

  // ── List item ───────────────────────────────────────────────────────────
  if (numId && numId !== "0") {
    const lvlInfo = numbering.resolve(numId, ilvl);
    const ordered = lvlInfo?.ordered ?? false;
    const start   = lvlInfo?.start ?? 1;
    const align   = extractAlignment(pPr);
    const paraAttrs: Record<string, unknown> = {};
    if (align) paraAttrs.textAlign = align;

    const listItemContent: PMNode[] = [
      {
        type: "paragraph",
        attrs: Object.keys(paraAttrs).length ? paraAttrs : undefined,
        content: inlineContent,
      },
    ];

    return {
      pmNode: null,
      listInfo: {
        numId,
        ilvl,
        ordered,
        start,
        pmNode: { type: "listItem", content: listItemContent },
      },
    };
  }

  // ── Regular paragraph ────────────────────────────────────────────────────
  const align = extractAlignment(pPr);
  const paraAttrs: Record<string, unknown> = {};
  if (align) paraAttrs.textAlign = align;

  // Insert pageBreak node before paragraph content if mid-paragraph break
  if (hasPageBreak) {
    return {
      pmNode: {
        type: "paragraph",
        attrs: Object.keys(paraAttrs).length ? paraAttrs : undefined,
        content: [
          { type: "hardBreak" },
          ...inlineContent,
        ],
      },
    };
  }

  return {
    pmNode: {
      type: "paragraph",
      attrs: Object.keys(paraAttrs).length ? paraAttrs : undefined,
      content: inlineContent,
    },
  };
}

// ─── Inline content (runs, hyperlinks, drawings) ──────────────────────────────

async function parseInlineContent(
  p: Element,
  images: ImageResolver,
  zip: JSZip,
): Promise<PMNode[]> {
  const nodes: PMNode[] = [];

  for (const child of Array.from(p.childNodes)) {
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as Element;
    const local = el.localName ?? el.nodeName.split(":").pop() ?? "";

    if (local === "r") {
      const runNodes = await parseRun(el, images, zip);
      nodes.push(...runNodes);
    } else if (local === "hyperlink") {
      // Recurse into hyperlink runs, apply link mark
      const inner = await parseInlineContent(el, images, zip);
      // We don't have a link extension in the list, but StarterKit has Link.
      // Wrap in a link mark if present; otherwise just emit text.
      // Since Link isn't listed, emit runs without the href mark.
      nodes.push(...inner);
    } else if (local === "ins") {
      // Tracked insertion — accept the change
      const inner = await parseInlineContent(el, images, zip);
      nodes.push(...inner);
    } else if (local === "del") {
      // Tracked deletion — skip (accept deletions)
    } else if (local === "smartTag" || local === "customXml") {
      const inner = await parseInlineContent(el, images, zip);
      nodes.push(...inner);
    } else if (local === "sdt") {
      const sdtContent = el.getElementsByTagNameNS(W_NS, "sdtContent")[0];
      if (sdtContent) {
        const inner = await parseInlineContent(sdtContent as Element, images, zip);
        nodes.push(...inner);
      }
    }
  }

  return mergeAdjacentTextNodes(nodes);
}

async function parseRun(
  r: Element,
  images: ImageResolver,
  zip: JSZip,
): Promise<PMNode[]> {
  const rPr = wTag(r, "rPr");
  const fmt  = extractRunFormatting(rPr);
  const marks = formattingToMarks(fmt);
  const nodes: PMNode[] = [];

  for (const child of Array.from(r.childNodes)) {
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as Element;
    const local = el.localName ?? el.nodeName.split(":").pop() ?? "";

    if (local === "t") {
      const text = el.textContent ?? "";
      if (text) {
        const node: PMNode = { type: "text", text };
        if (marks.length) node.marks = marks;
        nodes.push(node);
      }
    } else if (local === "br") {
      const brType = wAttr(el, "type") ?? "textWrapping";
      if (brType === "page") {
        // We'll handle page breaks at the paragraph level; skip here
      } else {
        // line break → hardBreak
        nodes.push({ type: "hardBreak" });
      }
    } else if (local === "drawing") {
      const imgNode = await parseDrawing(el, images, zip);
      if (imgNode) nodes.push(imgNode);
    } else if (local === "pict") {
      // Legacy VML pictures — skip
    } else if (local === "tab") {
      const node: PMNode = { type: "text", text: "\t" };
      if (marks.length) node.marks = marks;
      nodes.push(node);
    } else if (local === "sym") {
      // Symbol run — emit space
      nodes.push({ type: "text", text: " " });
    }
    // footnoteReference, endnoteReference, fldChar, instrText — skip
  }

  return nodes;
}

// ─── Drawing / Image ─────────────────────────────────────────────────────────

async function parseDrawing(
  drawing: Element,
  images: ImageResolver,
  zip: JSZip,
): Promise<PMNode | null> {
  // Find blip embed
  const blips = drawing.getElementsByTagNameNS(A_NS, "blip");
  if (!blips.length) return null;
  const blip = blips[0];
  const rId =
    blip.getAttributeNS(R_NS, "embed") ??
    blip.getAttribute("r:embed") ?? null;
  if (!rId) return null;

  const src = await images.resolveBlob(zip, rId);
  if (!src) return null;

  // Dimensions from extent
  let width: number | undefined;
  let height: number | undefined;
  const extents = drawing.getElementsByTagNameNS(WP_NS, "extent");
  if (extents.length) {
    const cx = extents[0].getAttribute("cx");
    const cy = extents[0].getAttribute("cy");
    if (cx) width  = emuToPx(parseInt(cx, 10));
    if (cy) height = emuToPx(parseInt(cy, 10));
  }

  const attrs: Record<string, unknown> = { src };
  if (width)  attrs.width  = width;
  if (height) attrs.height = height;

  // Alt text
  const docPrs = drawing.getElementsByTagNameNS(WP_NS, "docPr");
  if (docPrs.length) {
    const alt = docPrs[0].getAttribute("descr") ?? docPrs[0].getAttribute("name");
    if (alt) attrs.alt = alt;
  }

  return { type: "image", attrs };
}

// ─── Table ────────────────────────────────────────────────────────────────────

async function parseTable(
  tbl: Element,
  numbering: NumberingResolver,
  images: ImageResolver,
  zip: JSZip,
): Promise<PMNode | null> {
  const rows: PMNode[] = [];

  for (const tr of Array.from(tbl.getElementsByTagNameNS(W_NS, "tr"))) {
    // Check if this tr is a direct child (not nested)
    if ((tr.parentNode as Element) !== tbl) continue;
    const cells: PMNode[] = [];

    for (const tc of Array.from(tr.getElementsByTagNameNS(W_NS, "tc"))) {
      if ((tc.parentNode as Element) !== tr) continue;

      const tcPr    = wTag(tc, "tcPr");
      const gridSpan = parseInt(wAttr(wTag(tcPr ?? tc, "gridSpan"), "val") ?? "1", 10);
      const vMerge   = wTag(tcPr ?? tc, "vMerge");
      const vMergeVal = wAttr(vMerge, "val");

      // Cell background colour
      const cellShd = tcPr ? wTag(tcPr, "shd") : null;
      const cellBg  = normaliseColor(wAttr(cellShd, "fill"));

      // Determine if header row
      const trPr   = wTag(tr, "trPr");
      const isTblHeader = !!wTag(trPr ?? tr, "tblHeader");

      // Parse cell content (paragraphs / nested tables)
      const cellContent = await parseBody(tc, numbering, images, zip);

      const cellAttrs: Record<string, unknown> = {};
      if (gridSpan > 1) cellAttrs.colspan = gridSpan;
      // rowspan logic requires a two-pass; mark vMerge for now
      if (vMerge && vMergeVal !== "restart") cellAttrs.rowspan = 1; // placeholder
      if (cellBg) cellAttrs.backgroundColor = cellBg;

      cells.push({
        type: isTblHeader ? "tableHeader" : "tableCell",
        attrs: Object.keys(cellAttrs).length ? cellAttrs : undefined,
        content: cellContent.length
          ? cellContent
          : [{ type: "paragraph", content: [] }],
      });
    }

    rows.push({ type: "tableRow", content: cells });
  }

  if (!rows.length) return null;
  return { type: "table", content: rows };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Merge consecutive text nodes that share identical marks so ProseMirror
 * doesn't create unnecessarily fragmented runs.
 */
function mergeAdjacentTextNodes(nodes: PMNode[]): PMNode[] {
  const result: PMNode[] = [];

  for (const node of nodes) {
    if (node.type !== "text" || !result.length) {
      result.push(node);
      continue;
    }
    const prev = result[result.length - 1];
    if (
      prev.type === "text" &&
      marksEqual(prev.marks ?? [], node.marks ?? [])
    ) {
      prev.text = (prev.text ?? "") + (node.text ?? "");
    } else {
      result.push(node);
    }
  }

  return result;
}

function marksEqual(a: PMMark[], b: PMMark[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((ma, i) => {
    const mb = b[i];
    return (
      ma.type === mb.type &&
      JSON.stringify(ma.attrs ?? {}) === JSON.stringify(mb.attrs ?? {})
    );
  });
}