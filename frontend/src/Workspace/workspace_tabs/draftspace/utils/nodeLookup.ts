import { Node as PMNode } from "prosemirror-model";
import type { BlockNode } from "../store/documentTypes";

/**
 * Traverses a ProseMirror document to find a node by a specific attribute.
 * Returns the resolved position (pos) of the start of the node.
 */
export function findPosByBlockId(doc: PMNode, blockId: string): number | null {
    let targetPos: number | null = null;

    doc.descendants((node, pos) => {
        if (targetPos !== null) return false; // Early exit once found

        if (node.attrs && node.attrs.blockId === blockId) {
            targetPos = pos;
            return false;
        }
    });

    return targetPos;
}

/**
 * Returns the absolute path of nodes from the root down to the target blockId.
 */
export function getBlockPath(targetId: string, tree: BlockNode): BlockNode[] | null {
    if (tree.id === targetId) return [tree];
    if (!tree.children) return null;

    for (const child of tree.children) {
        const path = getBlockPath(targetId, child);
        if (path) {
            return [tree, ...path];
        }
    }
    return null;
}

/**
 * Flattens the hierarchical BlockTree into a flat array of nodes.
 */
export function flattenBlockTree(tree: BlockNode): BlockNode[] {
    const list: BlockNode[] = [tree];
    if (tree.children) {
        tree.children.forEach(c => list.push(...flattenBlockTree(c)));
    }
    return list;
}
