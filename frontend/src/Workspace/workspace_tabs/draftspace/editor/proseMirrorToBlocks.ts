import type { BlockNode, Span, BlockNodeType } from "../store/documentTypes";
import type { PMNode } from "./blockToProseMirror";

function pmTextToSpan(node: PMNode): Span {
    const span: Span = { text: node.text || "" };
    if (node.marks) {
        node.marks.forEach(mark => {
            if (mark.type === "bold") span.bold = true;
            if (mark.type === "italic") span.italic = true;
            if (mark.type === "underline") span.underline = true;
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

                targetList.push({
                    id,
                    type: "paragraph",
                    content,
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
