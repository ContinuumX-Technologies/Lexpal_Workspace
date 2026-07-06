import { useMemo, useEffect, useRef } from "react";
import { Tree, TreeApi, NodeApi } from "react-arborist";
import { useDocumentStore } from "../store/documentStore";
import TreeNode from "./TreeNode";
import styles from "./DocumentTree.module.css";
import { findPosByLexpalId, findPosByBlockId } from "../utils/nodeLookup";

import { useDraftStore } from "../store/draftStore";

type TreeNodeItem = {
  id: string;
  type: "section" | "clause" | "paragraph";
  title?: string;
  number?: string;
  children?: TreeNodeItem[];
};

const flattenText = (node: any): string => {
  if (!node) return "";
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.content)) return "";
  return node.content.map(flattenText).join(" ");
};

const buildTreeFromProseMirror = (doc: any): TreeNodeItem[] => {
  const content = Array.isArray(doc?.content) ? doc.content : [];

  return content.map((node: any, index: number): TreeNodeItem => {
    const headingLevel = typeof node?.attrs?.level === "number" ? node.attrs.level : 0;

    if (node?.type === "heading") {
      return {
        id: node?.attrs?.lexpalId || node?.attrs?.blockId || `heading-${index}`,
        type: "section",
        title: flattenText(node) || "Untitled Section",
      };
    }

    if (node?.type === "orderedList") {
      const clauses = (node.content || []).map((item: any, itemIndex: number): TreeNodeItem => {
        const paragraphNode = (item.content || []).find((child: any) => child.type === "paragraph");
        return {
          id: item?.attrs?.lexpalId || item?.attrs?.blockId || `clause-${index}-${itemIndex}`,
          type: "clause",
          number: `${itemIndex + 1}.`,
          title: flattenText(paragraphNode) || `Clause ${itemIndex + 1}`,
        };
      });

      return {
        id: node?.attrs?.lexpalId || node?.attrs?.blockId || `ordered-list-${index}`,
        type: headingLevel >= 2 ? "section" : "paragraph",
        title: headingLevel >= 2 ? "Clauses" : "Ordered List",
        children: clauses,
      };
    }

    return {
      id: node?.attrs?.lexpalId || node?.attrs?.blockId || `${node?.type || "node"}-${index}`,
      type: headingLevel >= 2 ? "section" : "paragraph",
      title: flattenText(node) || "Paragraph",
    };
  });
};

export default function DocumentTree() {
  const draftId = useDraftStore(state => state.activeDraftId);
  const prosemirrorJson = useDraftStore(state => state.drafts[draftId]?.prosemirrorJson);
  const activeBlockId = useDocumentStore(state => state.activeBlockId);
  const editor = useDocumentStore(state => state.editor);

  const treeRef = useRef<TreeApi<TreeNodeItem> | null>(null);

  const data = useMemo(() => {
    if (!prosemirrorJson) return [];
    return buildTreeFromProseMirror(prosemirrorJson);
  }, [prosemirrorJson]);

  useEffect(() => {
    if (!treeRef.current || !activeBlockId) return;

    const node = treeRef.current.get(activeBlockId);

    if (node && !node.isSelected) {
      node.select();
      node.openParents();
    }

  }, [activeBlockId]);

  const handleSelect = (nodes: NodeApi<TreeNodeItem>[]) => {
    if (!editor || nodes.length === 0) return;

    const selectedNode = nodes[0];
    const nodeId = selectedNode.data.id;

    const pos =
      findPosByLexpalId(editor.state.doc, nodeId) ??
      findPosByBlockId(editor.state.doc, nodeId);

    if (pos === null) return;

    editor.chain().focus().setTextSelection(pos).scrollIntoView().run();
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>Document Tree</h3>
      </div>

      <div className={styles.treeWrapper}>
        {!prosemirrorJson && (
          <div className={styles.empty}>Document tree not initialized</div>
        )}

        {prosemirrorJson && data.length === 0 && (
          <div className={styles.empty}>Document tree empty</div>
        )}

        {prosemirrorJson && data.length > 0 && (
          <Tree<TreeNodeItem>
            ref={treeRef}
            data={data}
            idAccessor="id"
            childrenAccessor="children"
            openByDefault={false}
            width={300}
            height={600}
            rowHeight={32}
            indent={16}
            onSelect={handleSelect}
          >
            {TreeNode as any}
          </Tree>
        )}
      </div>
    </div>
  );
}
