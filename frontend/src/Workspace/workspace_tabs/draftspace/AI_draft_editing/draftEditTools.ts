

import { createNodeId, UUID_REGEX } from "./draftIndexer";

export type EditOperation =
    | ReplaceNodeOperation
    | CreateNodeOperation
    | DeleteNodeOperation
    | MoveNodeOperation;

export interface EditPlanStep {
    stepId: string;
    operation: EditOperation;
    generationGroup: string;
    requiresGeneration: boolean;
    draftingInstruction: string;
    contextForDrafting: Record<string, unknown>;
    /** PML markup string returned by the drafting LLM, present when requiresGeneration is true */
    generatedContent?: string;
}

export interface EditPlan {
    steps: EditPlanStep[];
}




export interface PMNode {
    type: string;
    attrs?: Record<string, any>;
    content?: PMNode[];
    text?: string;
}

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

function isPipelineBlockNode(node: PMNode): boolean {
    return PIPELINE_BLOCK_TYPES.has(node.type);
}

/**
 * Ensures each newly inserted/replaced pipeline block node has a stable UUID in attrs.lexpalId.
 * Existing IDs are preserved and validated.
 */
function ensureStableIdsBeforeInsertion(
    node: PMNode,
    forcedRootId?: string
): void {
    if (isPipelineBlockNode(node)) {
        node.attrs ??= {};

        if (forcedRootId) {
            node.attrs.lexpalId = forcedRootId;
        }

        const existingId = node.attrs.lexpalId;

        if (existingId === null || existingId === undefined || existingId === "") {
            node.attrs.lexpalId = createNodeId();
        } else if (typeof existingId !== "string" || !UUID_REGEX.test(existingId)) {
            throw new Error(
                `[applyEditPlan] Inserted/replacement block node \"${node.type}\" has invalid attrs.lexpalId: ${String(existingId)}`
            );
        }
    }

    node.content?.forEach(child => ensureStableIdsBeforeInsertion(child));
}

/**
 * Guard to ensure every inserted block node carries UUID after assignment.
 */
function validateInsertedBlockNodeIds(nodes: PMNode[]): void {
    const walk = (node: PMNode) => {
        if (isPipelineBlockNode(node)) {
            const id = node.attrs?.lexpalId;
            if (typeof id !== "string" || !UUID_REGEX.test(id)) {
                throw new Error(
                    `[applyEditPlan] Validation failed: inserted block node \"${node.type}\" is missing valid attrs.lexpalId.`
                );
            }
        }

        node.content?.forEach(walk);
    };

    nodes.forEach(walk);
}







export interface NodeLocation {
    node: PMNode;
    parent: PMNode | null;
    index: number;
}

export function findNodeById(
    root: PMNode,
    nodeId: string
): NodeLocation | null {

    if (root.attrs?.lexpalId === nodeId) {
        return { node: root, parent: null, index: -1 };
    }

    let result: NodeLocation | null = null;

    function walk(node: PMNode, parent: PMNode | null): void {
        if (result || !node.content?.length) return;

        for (let i = 0; i < node.content.length; i++) {
            const child = node.content[i];

            if (child.attrs?.lexpalId === nodeId) {
                result = { node: child, parent: node, index: i };
                return;
            }

            walk(child, node);
            if (result) return;
        }
    }

    walk(root, null);
    return result;
}








// export interface ReplaceNodeOperation {
//     op: "replaceNode";

//     nodeId: string;

//     content?: PMNode;

//     attrs?: Record<string, any>;

// }

export interface ReplaceNodeOperation {
    op: "replaceNode";
    nodeId: string;
    replacement: PMNode;
}


export function replaceNode(
    doc: PMNode,
    operation: ReplaceNodeOperation
): PMNode {
    const cloned = structuredClone(doc);

    if (!operation.replacement || typeof operation.replacement !== "object") {
        throw new Error(
            `[applyEditPlan] replaceNode operation is missing a valid replacement node for target ${operation.nodeId}`
        );
    }

    const found = findNodeById(
        cloned,
        operation.nodeId
    );

    if (!found) {
        throw new Error(
            `Node ${operation.nodeId} not found`
        );
    }

    const { parent, index, node: targetNode } = found;

    // Cannot replace root doc node this way
    if (!parent || index === undefined) {
        throw new Error(
            "Cannot replace root node"
        );
    }

    const targetNodeId = targetNode.attrs?.lexpalId;

    if (
        typeof targetNodeId !== "string" ||
        !UUID_REGEX.test(targetNodeId)
    ) {
        throw new Error(
            `[applyEditPlan] replaceNode target "${operation.nodeId}" is missing valid attrs.lexpalId.`
        );
    }

    const replacement = structuredClone(operation.replacement);

    // Preserve identity of the node being replaced.
    replacement.attrs ??= {};
    replacement.attrs.lexpalId = targetNodeId;

    // Preserve heading linkage if your architecture expects it.
    if (
        targetNode.attrs?.precedingHeadingId !== undefined &&
        replacement.attrs.precedingHeadingId === undefined
    ) {
        replacement.attrs.precedingHeadingId =
            targetNode.attrs.precedingHeadingId;
    }

    parent.content![index] = replacement;

    return cloned;
}





export interface CreateNodeOperation {
    op: "createNode";

    parentId: string;

    index: number;

    nodes: PMNode[];
}

export function createNode(
    doc: PMNode,
    operation: CreateNodeOperation
): PMNode {

    const cloned = structuredClone(doc);

    const found = findNodeById(
        cloned,
        operation.parentId
    );

    if (!found) {
        throw new Error(
            `Parent ${operation.parentId} not found`
        );
    }

    const parent = found.node;

    parent.content ??= [];

    if (!Array.isArray(operation.nodes)) {
        throw new Error(
            `[applyEditPlan] createNode operation is missing nodes[] for parent ${operation.parentId}`
        );
    }

    const nodesToInsert = structuredClone(operation.nodes);
    nodesToInsert.forEach(node => ensureStableIdsBeforeInsertion(node));
    validateInsertedBlockNodeIds(nodesToInsert);

    parent.content.splice(
        operation.index,
        0,
        ...nodesToInsert
    );

    return cloned;
}









export interface DeleteNodeOperation {
    op: "deleteNode";

    nodeId: string;
}



export function deleteNode(
    doc: PMNode,
    operation: DeleteNodeOperation
): PMNode {

    const cloned = structuredClone(doc);

    const found = findNodeById(
        cloned,
        operation.nodeId
    );

    if (!found) {
        throw new Error(
            `Node ${operation.nodeId} not found`
        );
    }

    if (!found.parent) {
        throw new Error(
            "Cannot delete root node"
        );
    }

    found.parent.content!.splice(
        found.index,
        1
    );

    return cloned;
}









export interface MoveNodeOperation {
    op: "moveNode";

    nodeId: string;

    targetParentId: string;

    targetIndex: number;
}




export function moveNode(
    doc: PMNode,
    operation: MoveNodeOperation
): PMNode {

    const cloned = structuredClone(doc);

    const source = findNodeById(
        cloned,
        operation.nodeId
    );

    const target = findNodeById(
        cloned,
        operation.targetParentId
    );

    if (!source) {
        throw new Error(
            `Node ${operation.nodeId} not found`
        );
    }

    if (!target) {
        throw new Error(
            `Parent ${operation.targetParentId} not found`
        );
    }

    if (!source.parent) {
        throw new Error(
            "Cannot move root node"
        );
    }

    source.parent.content!.splice(
        source.index,
        1
    );

    target.node.content ??= [];

    target.node.content.splice(
        operation.targetIndex,
        0,
        source.node
    );

    return cloned;
}












export function applyEditPlan(
    doc: PMNode,
    operations: EditOperation[]
): PMNode {
    // Verify the doc root has its lexpalId — if attrs were stripped the
    // entire lookup system breaks silently.
    if (!doc.attrs?.lexpalId) {
        throw new Error(
            `[applyEditPlan] Root doc node is missing attrs.lexpalId. ` +
            `Received attrs: ${JSON.stringify(doc.attrs)}`
        );
    }

    let currentDoc = structuredClone(doc);

    for (const operation of operations) {

        switch (operation.op) {

            case "replaceNode":
                currentDoc =
                    replaceNode(
                        currentDoc,
                        operation
                    );
                break;

            case "createNode":
                currentDoc =
                    createNode(
                        currentDoc,
                        operation
                    );
                break;

            case "deleteNode":
                currentDoc =
                    deleteNode(
                        currentDoc,
                        operation
                    );
                break;

            case "moveNode":
                currentDoc =
                    moveNode(
                        currentDoc,
                        operation
                    );
                break;
        }
    }

    return currentDoc;
}
