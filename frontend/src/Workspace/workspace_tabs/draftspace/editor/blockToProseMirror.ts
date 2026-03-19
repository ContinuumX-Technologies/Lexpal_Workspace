import type { BlockNode, Span } from "../store/documentTypes";

// TipTap JSON Node format
export type PMNode = {
  type: string;
  attrs?: Record<string, any>;
  content?: PMNode[];
  text?: string;
  marks?: { type: string }[];
};

/**
 * ✅ SAFE TEXT NODE CREATOR (NO EMPTY TEXT)
 */
function spanToPM(span: any): PMNode | null {
  const text = span?.text?.trim();

  // 🚨 CRITICAL: prevent empty text node crash
  if (!text) return null;

  const marks = [];
  if (span.bold) marks.push({ type: "bold" });
  if (span.italic) marks.push({ type: "italic" });
  if (span.underline) marks.push({ type: "underline" });

  const node: PMNode = {
    type: "text",
    text,
  };

  if (marks.length > 0) node.marks = marks;

  return node;
}

/**
 * ✅ SAFE CONTENT PROCESSOR (HANDLES ALL CASES)
 */
function processContent(content?: any): PMNode[] {
  if (!content) return [];

  // ✅ CASE 1: string
  if (typeof content === "string") {
    const text = content.trim();
    return text ? [{ type: "text", text }] : [];
  }

  // ✅ CASE 2: array (with possible nesting)
  if (Array.isArray(content)) {
    const flat = content.flat(Infinity);

    return flat
      .map((item: any) => {
        if (!item) return null;

        // string inside array
        if (typeof item === "string") {
          const text = item.trim();
          return text ? { type: "text", text } : null;
        }

        return spanToPM(item);
      })
      .filter(Boolean) as PMNode[];
  }

  return [];
}

/**
 * ✅ BLOCK CONVERTER
 */
function convertBlock(block: BlockNode): PMNode[] {
  const result: PMNode[] = [];

  switch (block.type) {
    case "document":
      block.children?.forEach(child =>
        result.push(...convertBlock(child))
      );
      break;

    case "section":
      if (block.title?.trim()) {
        result.push({
          type: "heading",
          attrs: { level: 1, blockId: block.id },
          content: [{ type: "text", text: block.title.trim() }],
        });
      }

      block.children?.forEach(child =>
        result.push(...convertBlock(child))
      );
      break;

    case "paragraph": {
      const content = processContent(block.content);

      // 🚨 prevent empty paragraph crash
      if (content.length === 0) break;

      result.push({
        type: "paragraph",
        attrs: {
          blockId: block.id,
          textAlign: (block as any)?.meta?.align || "left",
        },
        content,
      });
      break;
    }

    case "clause":
    case "list": {
      const listItemContent: PMNode[] = [];

      let textContent = processContent(block.content);

      if (block.title?.trim()) {
        textContent = [
          { type: "text", text: block.title.trim() + " " },
          ...textContent,
        ];
      }

      if (block.number?.trim()) {
        textContent = [
          { type: "text", text: block.number.trim() + " " },
          ...textContent,
        ];
      }

      if (textContent.length > 0) {
        listItemContent.push({
          type: "paragraph",
          attrs: { blockId: block.id },
          content: textContent,
        });
      }

      /**
       * ✅ HANDLE CHILDREN (NESTED LISTS)
       */
      if (block.children?.length) {
        const nestedNodes: PMNode[] = [];
        let currentList: PMNode[] | null = null;

        for (const child of block.children) {
          if (child.type === "clause" || child.type === "list") {
            if (!currentList) {
              currentList = [];
              nestedNodes.push({
                type: "orderedList",
                attrs: { blockId: `list_group_${child.id}` },
                content: currentList,
              });
            }

            currentList.push(...convertBlock(child));
          } else {
            currentList = null;
            nestedNodes.push(...convertBlock(child));
          }
        }

        listItemContent.push(...nestedNodes);
      }

      // 🚨 avoid empty listItem
      if (listItemContent.length > 0) {
        result.push({
          type: "listItem",
          attrs: { blockId: block.id },
          content: listItemContent,
        });
      }

      break;
    }
  }

  return result;
}

/**
 * ✅ MAIN CONVERTER
 */
export function blockTreeToProseMirror(
  blockTree: BlockNode
): PMNode {
  const documentNodes: PMNode[] = [];

  if (blockTree?.children) {
    let currentList: PMNode[] | null = null;

    for (const child of blockTree.children) {
      if (child.type === "clause" || child.type === "list") {
        if (!currentList) {
          currentList = [];
          documentNodes.push({
            type: "orderedList",
            content: currentList,
          });
        }

        currentList.push(...convertBlock(child));
      } else {
        currentList = null;
        documentNodes.push(...convertBlock(child));
      }
    }
  }

  return {
    type: "doc",
    content: documentNodes,
  };
}