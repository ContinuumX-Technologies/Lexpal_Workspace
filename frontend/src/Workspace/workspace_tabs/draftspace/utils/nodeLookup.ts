import { Node as PMNode } from "prosemirror-model";

/**
 * Traverses a ProseMirror document to find a node by a specific attribute.
 * Returns the resolved position (pos) of the start of the node.
 */
export function findPosByLexpalId(doc: PMNode, lexpalId: string): number | null {
    let targetPos: number | null = null;

    doc.descendants((node, pos) => {
        if (targetPos !== null) return false; // Early exit once found

        if (node.attrs && node.attrs.lexpalId === lexpalId) {
            targetPos = pos;
            return false;
        }
    });

    return targetPos;
}

// Backward compatibility for any remaining callers.
export function findPosByBlockId(doc: PMNode, blockId: string): number | null {
    let targetPos: number | null = null;

    doc.descendants((node, pos) => {
        if (targetPos !== null) return false; // Early exit once found

        if (
            node.attrs &&
            (node.attrs.lexpalId === blockId || node.attrs.blockId === blockId)
        ) {
            targetPos = pos;
            return false;
        }
    });

    return targetPos;
}
