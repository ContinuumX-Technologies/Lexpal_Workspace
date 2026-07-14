import pdfMake from "pdfmake/build/pdfmake";
import pdfFonts from "pdfmake/build/vfs_fonts";

(pdfMake as any).vfs =
  (pdfFonts as any)?.pdfMake?.vfs ??
  (pdfFonts as any)?.vfs ??
  pdfFonts;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Margins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  marks?: PMMark[];
  text?: string;
}

export interface PMMark {
  type: string;
  attrs?: Record<string, unknown>;
}

// ─── pdfmake internal types ───────────────────────────────────────────────────

type PDFContent = object;

// ─── Mark helpers ─────────────────────────────────────────────────────────────

function applyMarks(inline: Record<string, unknown>, marks: PMMark[]): void {
  for (const mark of marks) {
    switch (mark.type) {
      case "bold":      inline.bold = true; break;
      case "italic":    inline.italics = true; break;
      case "underline": inline.decoration = "underline"; break;
      case "strike":    inline.decoration = "lineThrough"; break;
      case "code":
        inline.font = "Courier";
        inline.fontSize = 10;
        break;
    }
  }
}

// ─── Inline runs ──────────────────────────────────────────────────────────────

function parseInlineNodes(nodes: PMNode[]): object[] {
  const result: object[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      const inline: Record<string, unknown> = { text: node.text ?? "" };
      if (node.marks?.length) applyMarks(inline, node.marks);
      result.push(inline);
    } else if (node.type === "hardBreak") {
      result.push({ text: "\n" });
    }
  }
  return result;
}


//declared but unused function
// Flatten inline nodes into a single text string + style for simple cells
// function inlineToText(nodes: PMNode[]): string {
//   return nodes
//     .filter((n) => n.type === "text")
//     .map((n) => n.text ?? "")
//     .join("");
// }

// ─── Table ────────────────────────────────────────────────────────────────────

function parseTableCell(
  cell: PMNode,
  lineHeight: number,
  isHeader: boolean
): object {
  const colspan = (cell.attrs?.colspan as number) ?? 1;
  const rowspan = (cell.attrs?.rowspan as number) ?? 1;

  // Gather all block children and flatten into stack
  const stack: object[] = [];
  for (const block of cell.content ?? []) {
    const parsed = parseBlockNode(block, lineHeight);
    if (parsed) stack.push(parsed);
  }

  const base: Record<string, unknown> = {
    margin: [4, 4, 4, 4],
    lineHeight,
    ...(colspan > 1 ? { colSpan: colspan } : {}),
    ...(rowspan > 1 ? { rowSpan: rowspan } : {}),
    ...(isHeader ? { bold: true, fillColor: "#f0f0f0" } : {}),
  };

  if (stack.length === 0) {
    return { ...base, text: "" };
  }
  if (stack.length === 1) {
    // Unwrap single block — but always ensure `text` exists at top level
    const single = stack[0] as Record<string, unknown>;
    if ("text" in single) {
      return { ...base, ...single };
    }
    // Has stack/ul/ol but no text — wrap with empty text to satisfy pdfmake
    return { ...base, text: "", stack };
  }
  return { ...base, text: "", stack };
}

function parseTable(node: PMNode, lineHeight: number): object {
  const rows = (node.content ?? []).filter((n) => n.type === "table_row");

  if (rows.length === 0) {
    return { table: { widths: ["*"], body: [[{ text: "" }]] } };
  }

  const firstRow = rows[0];
  const hasHeader = firstRow.content?.some((c) => c.type === "table_header") ?? false;

  const colCount = Math.max(
    1,
    firstRow.content?.reduce(
      (sum, c) => sum + ((c.attrs?.colspan as number) ?? 1),
      0
    ) ?? 1
  );

  const body: object[][] = rows.map((row, rowIdx) => {
    const isHeaderRow = rowIdx === 0 && hasHeader;
    const cells = row.content ?? [];

    const expanded: object[] = [];
    for (const cell of cells) {
      const parsed = parseTableCell(cell, lineHeight, isHeaderRow) as Record<string, unknown>;
      expanded.push(parsed);
      // Insert blank placeholders for colSpan
      const span = ((parsed.colSpan as number) ?? 1) - 1;
      for (let i = 0; i < span; i++) {
        expanded.push({ text: "" });
      }
    }

    // Pad row to colCount
    while (expanded.length < colCount) {
      expanded.push({ text: "" });
    }

    return expanded;
  });

  return {
    margin: [0, 8, 0, 8],
    table: {
      headerRows: hasHeader ? 1 : 0,
      widths: Array(colCount).fill("*"),
      body,
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => "#cccccc",
      vLineColor: () => "#cccccc",
      paddingLeft:   () => 4,
      paddingRight:  () => 4,
      paddingTop:    () => 4,
      paddingBottom: () => 4,
    },
  };
}

// ─── Block nodes ──────────────────────────────────────────────────────────────

function parseBlockNode(node: PMNode, lineHeight: number): PDFContent | null {
  switch (node.type) {
    case "paragraph": {
      const inlines = parseInlineNodes(node.content ?? []);
      if (inlines.length === 0) {
        return { text: " ", lineHeight, margin: [0, 0, 0, 0] };
      }
      return { text: inlines, lineHeight };
    }

    case "heading": {
      const level = (node.attrs?.level as number) ?? 1;
      const sizes: Record<number, number> = { 1: 24, 2: 20, 3: 17, 4: 14, 5: 12, 6: 11 };
      const inlines = parseInlineNodes(node.content ?? []);
      return {
        text: inlines,
        fontSize: sizes[level] ?? 14,
        bold: true,
        lineHeight,
        margin: [0, level <= 2 ? 12 : 8, 0, 4],
      };
    }

    case "blockquote": {
      const children = (node.content ?? [])
        .map((n) => parseBlockNode(n, lineHeight))
        .filter(Boolean);
      return { stack: children, margin: [16, 4, 0, 4] };
    }

    case "code_block": {
      const raw = (node.content ?? [])
        .filter((n) => n.type === "text")
        .map((n) => n.text ?? "")
        .join("");
      return {
        text: raw || " ",
        font: "Courier",
        fontSize: 10,
        lineHeight,
        background: "#f5f5f5",
        margin: [0, 4, 0, 4],
        preserveLeadingSpaces: true,
      };
    }

    case "bullet_list": {
      const items = (node.content ?? []).map((item) => {
        const kids = (item.content ?? [])
          .map((n) => parseBlockNode(n, lineHeight))
          .filter(Boolean);
        return kids.length === 1 ? kids[0] : { stack: kids };
      });
      return { ul: items, lineHeight };
    }

    case "ordered_list": {
      const items = (node.content ?? []).map((item) => {
        const kids = (item.content ?? [])
          .map((n) => parseBlockNode(n, lineHeight))
          .filter(Boolean);
        return kids.length === 1 ? kids[0] : { stack: kids };
      });
      return { ol: items, lineHeight };
    }

    case "table":
      return parseTable(node, lineHeight);

    case "horizontal_rule":
      return {
        canvas: [
          { type: "line", x1: 0, y1: 5, x2: 515, y2: 5, lineWidth: 0.5, lineColor: "#cccccc" },
        ],
        margin: [0, 4, 0, 4],
      };

    case "image": {
      const src = node.attrs?.src as string | undefined;
      if (!src) return null;
      return { image: src, width: (node.attrs?.width as number) ?? 400, margin: [0, 4, 0, 4] };
    }

    // table internals consumed inside parseTable; fallback if orphaned
    case "table_row":
    case "table_cell":
    case "table_header": {
      const kids = (node.content ?? [])
        .map((n) => parseBlockNode(n, lineHeight))
        .filter(Boolean);
      return kids.length === 1 ? kids[0]! : { stack: kids };
    }

    default: {
      if (node.content?.length) {
        const kids = node.content
          .map((n) => parseBlockNode(n, lineHeight))
          .filter(Boolean);
        return kids.length === 1 ? kids[0]! : { stack: kids };
      }
      return null;
    }
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Converts a ProseMirror JSON document into a PDF Blob.
 *
 * @param doc        - ProseMirror JSON document (top-level `doc` node)
 * @param margins    - Page margins in points (72 pt = 1 inch)
 * @param lineHeight - Line-height multiplier (e.g. 1.5 = 1.5×)
 * @returns          A Blob of type "application/pdf"
 *
 * @example
 * const blob = await pmJsonToPdf(editor.getJSON(), margins, typography.lineHeight);
 * saveAs(blob, "lexpal_draft.pdf");
 */
export async function pmJsonToPdf(
  doc: PMNode,
  margins: Margins,
  lineHeight: number
): Promise<Blob> {
  if (doc.type !== "doc") {
    throw new Error(`Expected a ProseMirror "doc" node, got "${doc.type}"`);
  }

  const content = (doc.content ?? [])
    .map((node) => parseBlockNode(node, lineHeight))
    .filter(Boolean) as import("pdfmake/interfaces").Content[];

  const docDefinition: import("pdfmake/interfaces").TDocumentDefinitions = {
    content,
    pageMargins: [margins.left, margins.top, margins.right, margins.bottom] as [
      number, number, number, number
    ],
    defaultStyle: {
      font: "Roboto",
      fontSize: 12,
      lineHeight,
    },
  };

  const pdfDoc = pdfMake.createPdf(docDefinition);
  return pdfDoc.getBlob();  // ← returns Promise<Blob>, no callback
}