/**
 * pmJsonToDocx.ts
 *
 * Production-grade ProseMirror JSON → DOCX serialiser.
 *
 * Handles every node/mark emitted by parseDocxToPMJson, plus the full
 * TipTap extension set:
 *   StarterKit  (paragraph, heading 1-6, bold, italic, strike, code,
 *                codeBlock, blockquote, bulletList, orderedList, listItem,
 *                hardBreak, horizontalRule)
 *   OrderedListStyled
 *   Table / TableRow / TableCell / TableHeader
 *   TextStyle  (color, fontSize, fontFamily via textStyle mark)
 *   FontFamily, FontSize, Color  – same textStyle mark
 *   Highlight  (multicolor)
 *   Underline
 *   Image      (inline, src may be a data-URI)
 *   TextAlign  (paragraph / heading)
 *   PageBreak  (custom node type "pageBreak")
 *
 * Usage:
 *   const blob = await pmJsonToDocx(editorJson, margins, lineHeight);
 *   saveAs(blob, "document.docx");
 *
 * Dependencies:
 *   npm install docx   (^8.x)
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  ImageRun,
  PageBreak,
  HeadingLevel,
  AlignmentType,
  LevelFormat,
  BorderStyle,
  WidthType,
  ShadingType,
  LineRuleType,
  UnderlineType,
} from "docx";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface Margins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

// ─── Internal PM-JSON shape ───────────────────────────────────────────────────

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

// ─── Local type aliases for enum values ──────────────────────────────────────
// AlignmentType and HeadingLevel are runtime enum objects, not TS types.
// Use the inferred value types so we can annotate return values cleanly.

type DocxAlignment = (typeof AlignmentType)[keyof typeof AlignmentType];
type DocxHeading   = (typeof HeadingLevel)[keyof typeof HeadingLevel];

// ─── Inherited formatting passed from block → inline ─────────────────────────
// Plain interface — no Pick<> from docx types to avoid readonly/key mismatches.

interface InheritedFmt {
  italics?: boolean;
  bold?: boolean;
}

// ─── Run accumulator — mutable bag we build up before constructing TextRun ───

type DocxShadingType = (typeof ShadingType)[keyof typeof ShadingType];

interface RunBag {
  text: string;
  bold?: boolean;
  italics?: boolean;
  underline?: { type: (typeof UnderlineType)[keyof typeof UnderlineType] };
  strike?: boolean;
  // code is handled as font + shading
  font?: string;
  size?: number;
  color?: string;
  shading?: { type: DocxShadingType; fill: string };
}

// ─── Unit helpers ─────────────────────────────────────────────────────────────

/** Points → half-points (Word "sz" unit) */
const ptToHp = (pt: number) => Math.round(pt * 2);

/**
 * Parse a CSS size string to half-points.
 * Accepts: "14pt" | "14px" | "14" | 14
 */
function cssSizeToHp(raw: unknown): number | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim();
  const n = parseFloat(s);
  if (isNaN(n)) return undefined;
  if (s.endsWith("px")) return ptToHp(n * 0.75); // 1 px ≈ 0.75 pt
  return ptToHp(n);                               // assume pt
}

/**
 * Strip leading # and validate hex colour.
 * Returns the bare 6-char hex string (no #) or undefined.
 */
function normaliseHex(raw: unknown): string | undefined {
  if (!raw) return undefined;
  const s = String(raw).replace(/^#/, "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(s) ? s : undefined;
}

/** px → DXA  (96 dpi screen → Word twips: 1 inch = 1440 DXA) */
const pxToDxa = (px: number) => Math.round((px / 96) * 1440);

// ─── Alignment lookup ─────────────────────────────────────────────────────────

const PM_ALIGN_TO_DOCX: Record<string, DocxAlignment> = {
  left:    AlignmentType.LEFT,
  center:  AlignmentType.CENTER,
  right:   AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

// ─── Heading level lookup ─────────────────────────────────────────────────────

const PM_LEVEL_TO_HEADING: Record<number, DocxHeading> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

// ─── Numbering config ─────────────────────────────────────────────────────────

const INDENT_PER_LEVEL = 720; // DXA — 0.5 inch per indent level

function buildBulletLevels() {
  return Array.from({ length: 6 }, (_, i) => ({
    level: i,
    format: LevelFormat.BULLET,
    text:   i % 3 === 0 ? "\u2022" : i % 3 === 1 ? "\u25E6" : "\u25AA",
    alignment: AlignmentType.LEFT,
    style: {
      paragraph: {
        indent: {
          left:    INDENT_PER_LEVEL * (i + 1),
          hanging: INDENT_PER_LEVEL / 2,
        },
      },
    },
  }));
}

function buildNumberLevels() {
  const fmts = [
    { format: LevelFormat.DECIMAL,      text: "%1." },
    { format: LevelFormat.LOWER_LETTER, text: "%2." },
    { format: LevelFormat.LOWER_ROMAN,  text: "%3." },
    { format: LevelFormat.DECIMAL,      text: "%4." },
    { format: LevelFormat.LOWER_LETTER, text: "%5." },
    { format: LevelFormat.LOWER_ROMAN,  text: "%6." },
  ];
  return fmts.map(({ format, text }, i) => ({
    level: i,
    format,
    text,
    alignment: AlignmentType.LEFT,
    style: {
      paragraph: {
        indent: {
          left:    INDENT_PER_LEVEL * (i + 1),
          hanging: INDENT_PER_LEVEL / 2,
        },
      },
    },
  }));
}

// ─── Recursion context ────────────────────────────────────────────────────────

interface Context {
  contentWidthDxa: number;
  lineHeight: number;
  listDepth: number;
  listOrdered: boolean;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/**
 * Convert a ProseMirror / TipTap JSON document to a DOCX Blob.
 *
 * @param pmJson      editor.getJSON() — root node with type "doc"
 * @param margins     Page margins in pixels
 * @param lineHeight  CSS line-height multiplier (1 | 1.5 | 2 …)
 */
export async function pmJsonToDocx(
  pmJson: PMNode,
  margins: Margins,
  lineHeight: number,
): Promise<Blob> {
  const PAGE_W_DXA = 12_240; // 8.5"
  const PAGE_H_DXA = 15_840; // 11"

  const marginTopDxa    = pxToDxa(margins.top);
  const marginBottomDxa = pxToDxa(margins.bottom);
  const marginLeftDxa   = pxToDxa(margins.left);
  const marginRightDxa  = pxToDxa(margins.right);
  const contentWidthDxa = PAGE_W_DXA - marginLeftDxa - marginRightDxa;

  const ctx: Context = {
    contentWidthDxa,
    lineHeight,
    listDepth:   0,
    listOrdered: false,
  };

  const docChildren = convertNodes(pmJson.content ?? [], ctx);

  const doc = new Document({
    numbering: {
      config: [
        { reference: "pm-bullets", levels: buildBulletLevels() },
        { reference: "pm-numbers", levels: buildNumberLevels() },
      ],
    },
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 24 } }, // 12 pt
      },
      paragraphStyles: [
        makeParagraphStyle("Heading1", "Heading 1", 32, 0),
        makeParagraphStyle("Heading2", "Heading 2", 28, 1),
        makeParagraphStyle("Heading3", "Heading 3", 24, 2),
        makeParagraphStyle("Heading4", "Heading 4", 22, 3),
        makeParagraphStyle("Heading5", "Heading 5", 20, 4),
        makeParagraphStyle("Heading6", "Heading 6", 20, 5),
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size:   { width: PAGE_W_DXA, height: PAGE_H_DXA },
            margin: {
              top:    marginTopDxa,
              bottom: marginBottomDxa,
              left:   marginLeftDxa,
              right:  marginRightDxa,
            },
          },
        },
        children: docChildren,
      },
    ],
  });

  return Packer.toBlob(doc);
}

// ─── Style helpers ────────────────────────────────────────────────────────────

function makeParagraphStyle(
  id: string,
  name: string,
  halfPoints: number,
  outlineLevel: number,
) {
  return {
    id,
    name,
    basedOn:     "Normal",
    next:        "Normal",
    quickFormat: true,
    run:         { size: halfPoints, bold: true, font: "Calibri" },
    paragraph:   { spacing: { before: 240, after: 120 }, outlineLevel },
  };
}

// ─── Block node dispatcher ────────────────────────────────────────────────────

type DocxBlock = Paragraph | Table;

function convertNodes(nodes: PMNode[], ctx: Context): DocxBlock[] {
  return nodes.flatMap((n) => convertNode(n, ctx));
}

function convertNode(node: PMNode, ctx: Context): DocxBlock[] {
  switch (node.type) {
    case "paragraph":      return [convertParagraph(node, ctx)];
    case "heading":        return [convertHeading(node, ctx)];
    case "bulletList":     return convertList(node, ctx, false);
    case "orderedList":    return convertList(node, ctx, true);
    case "listItem":       return convertListItem(node, ctx);
    case "blockquote":     return convertBlockquote(node, ctx);
    case "codeBlock":      return [convertCodeBlock(node, ctx)];
    case "horizontalRule": return [convertHorizontalRule()];
    case "pageBreak":      return [new Paragraph({ children: [new PageBreak()] })];
    case "image":          return [convertBlockImage(node, ctx)];
    case "table":          return [convertTable(node, ctx)];
    default:
      if (node.content?.length) return convertNodes(node.content, ctx);
      return [new Paragraph({ children: [] })];
  }
}

// ─── Spacing ──────────────────────────────────────────────────────────────────

function lineSpacing(lineHeight: number) {
  return {
    line:     Math.round(lineHeight * 240),
    lineRule: LineRuleType.AUTO,
    before:   0,
    after:    120,
  };
}

// ─── Paragraph ────────────────────────────────────────────────────────────────

function convertParagraph(node: PMNode, ctx: Context): Paragraph {
  const alignment = getAlign(node);
  const children  = convertInline(node.content ?? [], ctx);

  return new Paragraph({
    spacing:  lineSpacing(ctx.lineHeight),
    alignment,
    children,
  });
}

// ─── Heading ──────────────────────────────────────────────────────────────────

function convertHeading(node: PMNode, ctx: Context): Paragraph {
  const level     = (node.attrs?.level as number) ?? 1;
  const heading   = PM_LEVEL_TO_HEADING[level] ?? HeadingLevel.HEADING_1;
  const alignment = getAlign(node);
  const children  = convertInline(node.content ?? [], ctx);

  return new Paragraph({
    heading,
    spacing:  { before: 240, after: 120 },
    alignment,
    children,
  });
}

// ─── Lists ────────────────────────────────────────────────────────────────────

function convertList(
  node: PMNode,
  ctx: Context,
  ordered: boolean,
): DocxBlock[] {
  return convertNodes(node.content ?? [], { ...ctx, listOrdered: ordered });
}

function convertListItem(node: PMNode, ctx: Context): DocxBlock[] {
  const out: DocxBlock[] = [];
  const reference = ctx.listOrdered ? "pm-numbers" : "pm-bullets";
  const level     = ctx.listDepth;

  for (const child of node.content ?? []) {
    if (child.type === "paragraph") {
      out.push(
        new Paragraph({
          numbering: { reference, level },
          spacing:   lineSpacing(ctx.lineHeight),
          alignment: getAlign(child),
          children:  convertInline(child.content ?? [], ctx),
        }),
      );
    } else if (child.type === "bulletList" || child.type === "orderedList") {
      const ordered   = child.type === "orderedList";
      const nestedCtx = { ...ctx, listDepth: level + 1, listOrdered: ordered };
      out.push(...convertNodes(child.content ?? [], nestedCtx));
    } else {
      out.push(...convertNode(child, ctx));
    }
  }

  return out;
}

// ─── Blockquote ───────────────────────────────────────────────────────────────

function convertBlockquote(node: PMNode, ctx: Context): DocxBlock[] {
  return (node.content ?? []).flatMap((child) => {
    if (child.type === "paragraph") {
      return [
        new Paragraph({
          spacing:   lineSpacing(ctx.lineHeight),
          alignment: getAlign(child),
          indent:    { left: 720, right: 720 },
          border:    {
            left: { style: BorderStyle.SINGLE, size: 12, color: "AAAAAA", space: 8 },
          },
          children: convertInline(child.content ?? [], ctx, { italics: true }),
        }),
      ];
    }
    return convertNode(child, ctx);
  });
}

// ─── Code block ───────────────────────────────────────────────────────────────

function convertCodeBlock(node: PMNode, ctx: Context): Paragraph {
  const text = (node.content ?? []).map((n) => n.text ?? "").join("");

  return new Paragraph({
    spacing: lineSpacing(ctx.lineHeight),
    shading: { type: ShadingType.CLEAR, fill: "F4F4F4" },
    border: {
      top:    { style: BorderStyle.SINGLE, size: 4, color: "DDDDDD" },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: "DDDDDD" },
      left:   { style: BorderStyle.SINGLE, size: 4, color: "DDDDDD" },
      right:  { style: BorderStyle.SINGLE, size: 4, color: "DDDDDD" },
    },
    indent:   { left: 360, right: 360 },
    children: [new TextRun({ text, font: "Courier New", size: 20 })],
  });
}

// ─── Horizontal rule ─────────────────────────────────────────────────────────

function convertHorizontalRule(): Paragraph {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC", space: 1 } },
    children: [],
  });
}

// ─── Block image ─────────────────────────────────────────────────────────────

function convertBlockImage(node: PMNode, ctx: Context): Paragraph {
  const run = buildImageRun(node, ctx);
  return new Paragraph({ children: run ? [run] : [] });
}

// ─── Table ────────────────────────────────────────────────────────────────────

const CELL_BORDER = { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" } as const;
const CELL_BORDERS = { top: CELL_BORDER, bottom: CELL_BORDER, left: CELL_BORDER, right: CELL_BORDER };

function convertTable(node: PMNode, ctx: Context): Table {
  const pmRows = node.content ?? [];

  // Determine column count from widest row
  const colCount = pmRows.reduce((max, row) => {
    const cols = (row.content ?? []).reduce(
      (sum, cell) => sum + ((cell.attrs?.colspan as number) ?? 1),
      0,
    );
    return Math.max(max, cols);
  }, 1);

  const baseColW  = Math.floor(ctx.contentWidthDxa / colCount);
  const remainder = ctx.contentWidthDxa - baseColW * colCount;
  // Distribute rounding remainder into the last column
  const colWidths = Array.from({ length: colCount }, (_, i) =>
    i === colCount - 1 ? baseColW + remainder : baseColW,
  );

  return new Table({
    width:        { size: ctx.contentWidthDxa, type: WidthType.DXA },
    columnWidths: colWidths,
    rows:         pmRows.map((row) => convertTableRow(row, colWidths, ctx)),
  });
}

function convertTableRow(
  pmRow: PMNode,
  colWidths: number[],
  ctx: Context,
): TableRow {
  let colCursor = 0;

  const cells = (pmRow.content ?? []).map((pmCell) => {
    const isHeader  = pmCell.type === "tableHeader";
    const colspan   = (pmCell.attrs?.colspan as number) ?? 1;
    const rowspan   = (pmCell.attrs?.rowspan as number) ?? 1;
    const bgHex     = normaliseHex(pmCell.attrs?.backgroundColor);

    // Sum the widths of all spanned columns
    const cellWidth = colWidths
      .slice(colCursor, colCursor + colspan)
      .reduce((a, b) => a + b, 0);
    colCursor += colspan;

    const shadingFill = bgHex ?? (isHeader ? "F2F2F2" : undefined);

    return new TableCell({
      borders:    CELL_BORDERS,
      margins:    { top: 80, bottom: 80, left: 120, right: 120 },
      width:      { size: cellWidth, type: WidthType.DXA },
      columnSpan: colspan > 1 ? colspan : undefined,
      rowSpan:    rowspan > 1 ? rowspan : undefined,
      shading:    shadingFill ? { type: ShadingType.CLEAR, fill: shadingFill } : undefined,
      children:   convertNodes(
        pmCell.content ?? [],
        ctx,
      ),
    });
  });

  return new TableRow({ children: cells });
}

// ─── Inline content ───────────────────────────────────────────────────────────

function convertInline(
  nodes: PMNode[],
  ctx: Context,
  inherited: InheritedFmt = {},
): (TextRun | ImageRun)[] {
  return nodes.flatMap((n) => convertInlineNode(n, ctx, inherited));
}

function convertInlineNode(
  node: PMNode,
  ctx: Context,
  inherited: InheritedFmt,
): (TextRun | ImageRun)[] {
  if (node.type === "hardBreak") {
    return [new TextRun({ break: 1 })];
  }

  if (node.type === "image") {
    const run = buildImageRun(node, ctx);
    return run ? [run] : [];
  }

  if (node.type === "text") {
    return [new TextRun(buildRunBag(node, inherited))];
  }

  return [];
}

// ─── Run bag (marks → plain mutable object → TextRun) ────────────────────────

function buildRunBag(node: PMNode, inherited: InheritedFmt): RunBag {
  // Start from a clean mutable bag with inherited values
  const bag: RunBag = {
    text:    node.text ?? "",
    italics: inherited.italics,
    bold:    inherited.bold,
  };

  for (const mark of node.marks ?? []) {
    applyMark(mark, bag);
  }

  return bag;
}

function applyMark(mark: PMMark, bag: RunBag): void {
  switch (mark.type) {
    case "bold":
      bag.bold = true;
      break;

    case "italic":
    case "italics":
      bag.italics = true;
      break;

    case "underline":
      bag.underline = { type: UnderlineType.SINGLE };
      break;

    case "strike":
      bag.strike = true;
      break;

    case "code":
      bag.font   = "Courier New";
      bag.size   = 20; // 10 pt
      bag.shading = { type: ShadingType.CLEAR, fill: "F4F4F4" };
      break;

    case "textStyle": {
      const a = mark.attrs ?? {};
      const colorHex = normaliseHex(a.color);
      if (colorHex) bag.color = colorHex;
      const hp = cssSizeToHp(a.fontSize);
      if (hp) bag.size = hp;
      if (a.fontFamily && typeof a.fontFamily === "string") bag.font = a.fontFamily;
      break;
    }

    case "fontSize": {
      const hp = cssSizeToHp(mark.attrs?.fontSize);
      if (hp) bag.size = hp;
      break;
    }

    case "fontFamily": {
      const f = mark.attrs?.fontFamily;
      if (f && typeof f === "string") bag.font = f;
      break;
    }

    case "color": {
      const h = normaliseHex(mark.attrs?.color);
      if (h) bag.color = h;
      break;
    }

    case "highlight": {
      const h = normaliseHex(mark.attrs?.color);
      // docx-js `highlight` only accepts named Word colours; use character
      // shading for arbitrary hex so multicolor highlight round-trips faithfully.
      if (h) bag.shading = { type: ShadingType.CLEAR, fill: h };
      break;
    }

    case "link":
      // Not in the extension list but guard gracefully
      bag.color   = "0563C1";
      bag.underline = { type: UnderlineType.SINGLE };
      break;
  }
}

// ─── Image run ────────────────────────────────────────────────────────────────

function buildImageRun(node: PMNode, ctx: Context): ImageRun | null {
  const src = node.attrs?.src as string | undefined;
  if (!src?.startsWith("data:")) return null; // only data-URIs can be embedded

  const match = src.match(/^data:image\/([a-zA-Z+]+);base64,(.+)$/);
  if (!match) return null;

  // Normalise "jpeg" → "jpg" — docx's union is "png"|"jpg"|"gif"|"bmp"|"svg"
  const rawExt   = match[1].toLowerCase().replace("jpeg", "jpg");
  const validExts = ["png", "jpg", "gif", "bmp", "svg"] as const;
  type ImgExt = typeof validExts[number];
  const imageType: ImgExt = (validExts as readonly string[]).includes(rawExt)
    ? (rawExt as ImgExt)
    : "png";

  // base64 → Uint8Array
  const binary = atob(match[2]);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  // Dimensions — clamp to content width preserving aspect ratio
  let widthPx  = (node.attrs?.width  as number | undefined) ?? 400;
  let heightPx = (node.attrs?.height as number | undefined) ?? 300;
  const maxWidthPx = Math.round((ctx.contentWidthDxa / 1440) * 96);
  if (widthPx > maxWidthPx) {
    heightPx = Math.round(heightPx * (maxWidthPx / widthPx));
    widthPx  = maxWidthPx;
  }

  const alt = (node.attrs?.alt as string | undefined) ?? "Image";
  const dims = { width: widthPx, height: heightPx };
  const altText = { title: alt, description: alt, name: alt };

  // docx uses a discriminated union on `type`: SVG requires a `fallback`
  // bitmap; raster types must NOT include `fallback`. Split explicitly so
  // TypeScript can narrow to the correct branch of IImageOptions.
  if (imageType === "svg") {
    return new ImageRun({
      type:           "svg",
      data:           bytes,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fallback:       { data: bytes, transformation: dims } as any,
      transformation: dims,
      altText,
    });
  }

  return new ImageRun({
    type:           imageType, // "png" | "jpg" | "gif" | "bmp" — no fallback allowed
    data:           bytes,
    transformation: dims,
    altText,
  });
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function getAlign(node: PMNode): DocxAlignment | undefined {
  const raw = node.attrs?.textAlign as string | undefined;
  return raw ? PM_ALIGN_TO_DOCX[raw] : undefined;
}