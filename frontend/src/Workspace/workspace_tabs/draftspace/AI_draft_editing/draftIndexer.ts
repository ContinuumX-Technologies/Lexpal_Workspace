import axios from "axios";

export interface PMNode {
    type: string;
    attrs?: Record<string, any>;
    content?: PMNode[];
    text?: string;
}

export type NodeId = string;
export type SeqNodeMap = Record<string, NodeId>;
export type LexpalToSequentialMap = Record<NodeId, string>;
export type DependencyGraph = Record<NodeId, NodeId[]>;

export interface SequentialIdMaps {
    sequentialToLexpalMap: SeqNodeMap;
    lexpalToSequentialMap: LexpalToSequentialMap;
}

export interface NodeMetadata {
    id: NodeId;
    type: string;
    parentId: NodeId | null;
    precedingHeadingId: NodeId | null;
    memo?: string;
    isBasicUnit: boolean;
}

export interface MinimalNode {
    id: NodeId;
    parentId: NodeId | null;
    index: number;
    type: string;
    memo?: string;
    heading_text?: string;
    children?: MinimalNode[];
}

export interface DraftArtifacts {
    minimalTree: MinimalNode;
    dependencyGraph: DependencyGraph;
    sequentialToLexpalMap: SeqNodeMap;
    lexpalToSequentialMap: LexpalToSequentialMap;
    nodeMetadata: Record<NodeId, NodeMetadata>;
    derivedFromDocHash: string;
}

export interface DraftArtifactSnapshot {
    minimalTree?: MinimalNode;
    dependencyGraph?: DependencyGraph;
    sequentialToLexpalMap?: SeqNodeMap;
    lexpalToSequentialMap?: LexpalToSequentialMap;
    nodeMetadata?: Record<NodeId, NodeMetadata>;
    // Backward compatibility alias
    seqNodeMap?: SeqNodeMap;
}

const BLOCK_TYPES = new Set([
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

const INLINE_TYPES = new Set([
    "text",
    "hardBreak",
    "emoji",
]);

export const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isPipelineBlockNode(node: PMNode): boolean {
    return BLOCK_TYPES.has(node.type);
}

function isInlineNode(node: PMNode): boolean {
    if (INLINE_TYPES.has(node.type)) return true;
    if (isPipelineBlockNode(node)) return false;
    const hasChildren = (node.content?.length ?? 0) > 0;
    return !hasChildren;
}

function isBasicUnitBlockNode(node: PMNode): boolean {
    if (!isPipelineBlockNode(node)) return false;
    const children = node.content ?? [];
    if (children.length === 0) return true;
    return children.every(child => isInlineNode(child));
}

export function createNodeId(): string {
    return crypto.randomUUID();
}




//generates uuid and also ensures the generated uuid has not been assigned to any node in the pm JSON of the draft
export function createUniqueNodeId(
    usedIds: Set<string>
): string {
    let id: string;

    do {
        id = crypto.randomUUID();
    } while (usedIds.has(id));

    return id;
}







export function computeDocHash(doc: PMNode): string {
    return JSON.stringify(doc);
}






/**
 * Hashes only block-level structure (node types + nesting), intentionally
 * ignoring inline content and textual edits.
 */
export function computeDocStructureHash(doc: PMNode): string {
    const tokens: string[] = [];

    const walk = (node: PMNode, depth: number) => {
        if (isPipelineBlockNode(node)) {
            const blockChildren = (node.content ?? []).filter(child => isPipelineBlockNode(child));
            tokens.push(`${depth}:${node.type}:${blockChildren.length}`);
            blockChildren.forEach(child => walk(child, depth + 1));
            return;
        }

        node.content?.forEach(child => walk(child, depth));
    };

    walk(doc, 0);
    return tokens.join("|");
}

export function createSequentialIdMaps(doc: PMNode): SequentialIdMaps {
    const sequentialToLexpalMap: SeqNodeMap = {};
    const lexpalToSequentialMap: LexpalToSequentialMap = {};
    const seenNodeIds = new Set<string>();

    let cursor = 1;

    const walk = (node: PMNode) => {
        if (isPipelineBlockNode(node)) {
            node.attrs ??= {};

            let stableNodeId = node.attrs.lexpalId;

            // Missing or invalid UUID -> repair
            if (
                typeof stableNodeId !== "string" ||
                stableNodeId.trim() === "" ||
                !UUID_REGEX.test(stableNodeId)
            ) {
                stableNodeId = createUniqueNodeId(seenNodeIds);

                console.warn(
                    `[createSequentialIdMaps] Repaired missing/invalid lexpalId on "${node.type}" -> ${stableNodeId}`
                );

                node.attrs.lexpalId = stableNodeId;
            }

            // Duplicate UUID -> repair
            if (seenNodeIds.has(stableNodeId)) {
                const oldId = stableNodeId;

                stableNodeId = createUniqueNodeId(seenNodeIds);

                console.warn(
                    `[createSequentialIdMaps] Repaired duplicate lexpalId ${oldId} -> ${stableNodeId}`
                );

                node.attrs.lexpalId = stableNodeId;
            }

            seenNodeIds.add(stableNodeId);

            const sequentialId = `n${cursor}`;

            sequentialToLexpalMap[sequentialId] = stableNodeId;
            lexpalToSequentialMap[stableNodeId] = sequentialId;

            cursor += 1;
        }

        node.content?.forEach(walk);
    };

    walk(doc);

    return {
        sequentialToLexpalMap,
        lexpalToSequentialMap,
    };
}

/**
 * Backward compatible alias.
 */
export function createSequentialNodeMap(doc: PMNode): SeqNodeMap {
    return createSequentialIdMaps(doc).sequentialToLexpalMap;
}

// Assign ids and precedingHeadingIds to block nodes only.
// Inline nodes are stripped of pipeline attrs.
//
// Guarantees:
// 1. Every pipeline block node has a lexpalId.
// 2. Every lexpalId is a valid UUID.
// 3. Every lexpalId is unique within the document.
// 4. precedingHeadingId is recomputed from document order.
export function assignIds(node: PMNode): PMNode {
    const cloned = structuredClone(node);

    let currentHeadingId: string | null = null;

    // Tracks every lexpalId encountered during traversal so that
    // duplicates can be detected and repaired deterministically.
    const usedIds = new Set<string>();

    function walk(n: PMNode): void {
        // Inline nodes should never participate in the enrichment pipeline.
        if (isInlineNode(n)) {
            if (n.attrs) {
                delete n.attrs.lexpalId;
                delete n.attrs.precedingHeadingId;
                delete n.attrs.nearestPrecedingHeadingId;
            }

            n.content?.forEach(walk);
            return;
        }

        if (isPipelineBlockNode(n)) {
            n.attrs ??= {};

            // Backward compatibility for older documents.
            if (
                n.attrs.precedingHeadingId == null &&
                typeof n.attrs.nearestPrecedingHeadingId === "string"
            ) {
                n.attrs.precedingHeadingId =
                    n.attrs.nearestPrecedingHeadingId;
            }

            let nodeId = n.attrs.lexpalId;

            const isValidExistingId =
                typeof nodeId === "string" &&
                UUID_REGEX.test(nodeId);

            const isDuplicateId =
                isValidExistingId &&
                usedIds.has(nodeId);

            // Generate a new ID if:
            // - missing
            // - invalid
            // - duplicate
            if (!isValidExistingId || isDuplicateId) {
                if (isDuplicateId) {
                    console.warn(
                        `[assignIds] Duplicate lexpalId detected and repaired: ${nodeId}`
                    );
                }

                nodeId = createUniqueNodeId(usedIds);
                n.attrs.lexpalId = nodeId;
            }

            usedIds.add(nodeId);

            // preceding heading means nearest heading encountered
            // before this node in document order.
            n.attrs.precedingHeadingId = currentHeadingId;

            if (n.type === "heading") {
                currentHeadingId = nodeId;
            }
        }

        n.content?.forEach(walk);
    }

    walk(cloned);

    return cloned;
}

function extractLocalText(node: PMNode): string {
    let result = "";

    function walk(n: PMNode) {
        if (n.type === "text") {
            result += n.text ?? "";
            return;
        }

        if (n !== node && n.attrs?.lexpalId) {
            return;
        }

        n.content?.forEach(walk);
    }

    walk(node);
    return result.trim();
}

export interface LLMNode {
    id: string;
    type: string;
    text?: string;
    precedingHeadingId?: string | null;
    isHeading: boolean;
    isBasicUnit: boolean;
    children?: LLMNode[];
}

// Formats the tree sent to the LLM for memo and dependency analysis.
export function buildLLMTree(root: PMNode): LLMNode {
    function build(node: PMNode): LLMNode | null {
        if (!isPipelineBlockNode(node)) return null;

        const id = node.attrs?.lexpalId;
        if (!id || typeof id !== "string") {
            return null;
        }

        const result: LLMNode = {
            id,
            type: node.type,
            precedingHeadingId: node.attrs?.precedingHeadingId ?? null,
            isHeading: node.type === "heading",
            isBasicUnit: isBasicUnitBlockNode(node),
        };

        const childBlocks: LLMNode[] = [];
        node.content?.forEach(child => {
            const nested = build(child);
            if (nested) childBlocks.push(nested);
        });

        if (childBlocks.length > 0) {
            result.children = childBlocks;
        } else {
            result.text = extractLocalText(node);
        }

        return result;
    }

    const tree = build(root);
    if (!tree) {
        throw new Error("Root document missing lexpalId");
    }

    return tree;
}

export interface LLMAnalysisResult {
    memos: Record<string, string>;
    dependencies: Record<string, string[]>;
}

// Generate memos for nodes and dependency arrays for nodes.
export async function analyzeDraft(tree: LLMNode): Promise<LLMAnalysisResult> {
    const apiBase = import.meta.env.VITE_API_URL || "http://localhost:3001";

    const response = await axios.post(`${apiBase}/api/documents/analyze`, {
        tree,
    });

    return response.data;
}

// Apply memos generated by llm to pm json.
export function applyMemos(doc: PMNode, memos: Record<string, string>): PMNode {
    const cloned = structuredClone(doc);

    function walk(node: PMNode) {
        const id = node.attrs?.lexpalId;

        if (
            id &&
            isPipelineBlockNode(node) &&
            node.type !== "heading" &&
            typeof memos[id] === "string" &&
            memos[id].trim() !== ""
        ) {
            node.attrs ??= {};
            node.attrs.memo = memos[id];
        }

        node.content?.forEach(walk);
    }

    walk(cloned);
    return cloned;
}

// Minimal index tree used by the planner.
export function buildMinimalTree(
    node: PMNode,
    parentId: string | null = null,
    index: number = 0
): MinimalNode {
    if (!isPipelineBlockNode(node)) {
        throw new Error(`[buildMinimalTree] Non-block node encountered at index ${index}: ${node.type}`);
    }

    const nodeId = node.attrs?.lexpalId;
    if (typeof nodeId !== "string" || !UUID_REGEX.test(nodeId)) {
        throw new Error(`[buildMinimalTree] Node "${node.type}" missing valid attrs.lexpalId`);
    }

    const result: MinimalNode = {
        id: nodeId,
        parentId,
        index,
        type: node.type,
    };

    if (node.type === "heading") {
        result.heading_text = extractLocalText(node);
    } else if (typeof node.attrs?.memo === "string" && node.attrs.memo.trim() !== "") {
        result.memo = node.attrs.memo;
    }

    const blockChildren = (node.content ?? []).filter(child => isPipelineBlockNode(child));
    if (blockChildren.length > 0) {
        result.children = blockChildren.map((child, childIndex) =>
            buildMinimalTree(child, nodeId, childIndex)
        );
    }

    return result;
}

export function buildNodeMetadata(doc: PMNode): Record<NodeId, NodeMetadata> {
    const metadata: Record<NodeId, NodeMetadata> = {};

    function walk(node: PMNode, parentId: NodeId | null) {
        if (!isPipelineBlockNode(node)) {
            node.content?.forEach(child => walk(child, parentId));
            return;
        }

        const id = node.attrs?.lexpalId;
        if (typeof id !== "string" || !UUID_REGEX.test(id)) {
            throw new Error(`[buildNodeMetadata] Node "${node.type}" missing valid attrs.lexpalId`);
        }

        metadata[id] = {
            id,
            type: node.type,
            parentId,
            precedingHeadingId: node.attrs?.precedingHeadingId ?? null,
            memo: typeof node.attrs?.memo === "string" ? node.attrs.memo : undefined,
            isBasicUnit: isBasicUnitBlockNode(node),
        };

        node.content?.forEach(child => walk(child, id));
    }

    walk(doc, null);
    return metadata;
}

export function validateEnrichedDocument(doc: PMNode): { ok: boolean; errors: string[] } {
    const errors: string[] = [];
    const seenIds = new Set<string>();

    function walk(node: PMNode) {
        const attrs = node.attrs ?? {};

        if (isPipelineBlockNode(node)) {
            const id = attrs.lexpalId;
            if (typeof id !== "string" || !UUID_REGEX.test(id)) {
                errors.push(`Block node "${node.type}" missing valid attrs.lexpalId`);
            } else if (seenIds.has(id)) {
                errors.push(`Duplicate attrs.lexpalId detected: ${id}`);
            } else {
                seenIds.add(id);
            }

            if (!Object.prototype.hasOwnProperty.call(attrs, "precedingHeadingId")) {
                errors.push(`Block node "${node.type}" missing attrs.precedingHeadingId`);
            }
        }

        if (isInlineNode(node)) {
            if (attrs.lexpalId != null) {
                errors.push(`Inline node "${node.type}" should not carry attrs.lexpalId`);
            }
            if (attrs.precedingHeadingId != null) {
                errors.push(`Inline node "${node.type}" should not carry attrs.precedingHeadingId`);
            }
        }

        node.content?.forEach(walk);
    }

    walk(doc);
    return { ok: errors.length === 0, errors };
}

function areMapKeysUniqueValues(map?: Record<string, string>): boolean {
    if (!map) return false;
    const values = Object.values(map);
    return new Set(values).size === values.length;
}

export function validateDraftArtifacts(
    doc: PMNode,
    artifacts: DraftArtifactSnapshot
): { ok: boolean; errors: string[] } {
    const errors: string[] = [];

    const docValidation = validateEnrichedDocument(doc);
    if (!docValidation.ok) {
        errors.push(...docValidation.errors);
    }

    const sequentialToLexpal = artifacts.sequentialToLexpalMap ?? artifacts.seqNodeMap;
    if (!sequentialToLexpal || Object.keys(sequentialToLexpal).length === 0) {
        errors.push("Missing sequentialToLexpalMap");
    } else if (!areMapKeysUniqueValues(sequentialToLexpal)) {
        errors.push("sequentialToLexpalMap contains duplicate values");
    }

    if (!artifacts.lexpalToSequentialMap || Object.keys(artifacts.lexpalToSequentialMap).length === 0) {
        errors.push("Missing lexpalToSequentialMap");
    }

    if (!artifacts.minimalTree) {
        errors.push("Missing minimalTree");
    }

    if (!artifacts.dependencyGraph) {
        errors.push("Missing dependencyGraph");
    }

    if (!artifacts.nodeMetadata || Object.keys(artifacts.nodeMetadata).length === 0) {
        errors.push("Missing nodeMetadata");
    }

    return {
        ok: errors.length === 0,
        errors,
    };
}
