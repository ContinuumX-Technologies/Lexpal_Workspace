import type { BlockNode, Span } from "../store/documentTypes";
import type { PMNode } from "./blockToProseMirror";

function pmTextToSpan(node: PMNode): Span {
    const span: Span = { text: node.text || "" };
    if (node.marks) {
        node.marks.forEach(mark => {
            if (mark.type === "bold") span.bold = true;
            if (mark.type === "italic") span.italic = true;
            if (mark.type === "underline") span.underline = true;
            if (mark.type === "highlight" && mark.attrs?.color) span.highlight = mark.attrs.color;
            if (mark.type === "textStyle" && mark.attrs) {
                if (mark.attrs.color) span.color = mark.attrs.color;
                if (mark.attrs.fontFamily) span.fontFamily = mark.attrs.fontFamily;
                if (mark.attrs.fontSize) span.fontSize = mark.attrs.fontSize;
            }
        });
    }
    return span;
}

function extractText(nodes?: PMNode[]): string {
    if (!nodes) return "";
    return nodes.map(n => n.text || "").join("");
}

export function proseMirrorToBlocks(pmDoc: PMNode): BlockNode {
    const root: BlockNode = {
        id: "doc-root",
        type: "document",
        children: [],
    };

    let currentSection: BlockNode | null = null;

    const processNode = (node: PMNode, parentList: BlockNode[]) => {
        switch (node.type) {
            case "heading": {
                const id = node.attrs?.blockId || `sec-${crypto.randomUUID()}`;
                const sectionBlock: BlockNode = {
                    id,
                    type: "section",
                    title: extractText(node.content),
                    children: [],
                };
                currentSection = sectionBlock;
                parentList.push(sectionBlock);
                break;
            }

            case "paragraph": {
                const id = node.attrs?.blockId || `para-${crypto.randomUUID()}`;
                const targetList = currentSection ? currentSection.children! : parentList;

                const content = node.content?.map(pmTextToSpan) || [];
                const align = node.attrs?.textAlign || "left";

                targetList.push({
                    id,
                    type: "paragraph",
                    content,
                    meta: { align },
                });
                break;
            }

            case "orderedList": {
                if (node.content) {
                    node.content.forEach(listItem => {
                        const id = listItem.attrs?.blockId || `clause-${crypto.randomUUID()}`;
                        const targetList = currentSection ? currentSection.children! : parentList;

                        const clauseBlock: BlockNode = {
                            id,
                            type: "clause",
                            content: [],
                            children: [],
                        };

                        // Parse children of the list item
                        if (listItem.content) {
                            listItem.content.forEach(liChild => {
                                if (liChild.type === "paragraph") {
                                    // This is the clause text content
                                    clauseBlock.content = liChild.content?.map(pmTextToSpan) || [];
                                } else if (liChild.type === "orderedList") {
                                    // This nested ordered list goes inside the clause as children
                                    processNode(liChild, clauseBlock.children!);
                                } else {
                                    // Any other node inside a list item goes into the clause children as a block
                                    processNode(liChild, clauseBlock.children!);
                                }
                            });
                        }

                        targetList.push(clauseBlock);
                    });
                }
                break;
            }

            case "table": {
                const id = node.attrs?.blockId || `table-${crypto.randomUUID()}`;
                const targetList = currentSection ? currentSection.children! : parentList;
                const tableBlock: BlockNode = { id, type: "table", children: [] };
                if (node.content) {
                    node.content.forEach(row => processNode(row, tableBlock.children!));
                }
                targetList.push(tableBlock);
                break;
            }

            case "tableRow": {
                const id = node.attrs?.blockId || `row-${crypto.randomUUID()}`;
                const rowBlock: BlockNode = { id, type: "tableRow", children: [] };
                if (node.content) {
                    node.content.forEach(cell => processNode(cell, rowBlock.children!));
                }
                parentList.push(rowBlock);
                break;
            }

            case "tableCell":
            case "tableHeader": {
                const id = node.attrs?.blockId || `cell-${crypto.randomUUID()}`;
                const cellBlock: BlockNode = { 
                    id, 
                    type: "tableCell", 
                    children: [],
                    meta: { 
                        colspan: node.attrs?.colspan || 1, 
                        rowspan: node.attrs?.rowspan || 1,
                        isHeader: node.type === "tableHeader"
                    }
                };
                if (node.content) {
                    node.content.forEach(child => processNode(child, cellBlock.children!));
                }
                parentList.push(cellBlock);
                break;
            }

            case "image": {
                const id = node.attrs?.blockId || `img-${crypto.randomUUID()}`;
                const targetList = currentSection ? currentSection.children! : parentList;
                targetList.push({
                    id,
                    type: "image",
                    meta: { src: node.attrs?.src, alt: node.attrs?.alt, title: node.attrs?.title },
                });
                break;
            }

            default:
                // Text nodes or ignored nodes, ignore at root
                break;
        }
    };

    if (pmDoc.content) {
        pmDoc.content.forEach(node => processNode(node, root.children!));
    }

    return root;
}
