import { useMemo, useEffect, useRef } from "react";
import { Tree, TreeApi, NodeApi } from "react-arborist";
import { useDocumentStore } from "../store/documentStore";
import type { BlockNode } from "../store/documentTypes";
import TreeNode from "./TreeNode";
import styles from "./DocumentTree.module.css";
import { findPosByBlockId } from "../utils/nodeLookup";

export default function DocumentTree() {

  const blockTree = useDocumentStore(state => state.blockTree);
  const activeBlockId = useDocumentStore(state => state.activeBlockId);
  const editor = useDocumentStore(state => state.editor);

  const treeRef = useRef<TreeApi<BlockNode> | null>(null);

  const data = useMemo(() => {
    if (!blockTree?.children) return [];
    return blockTree.children;
  }, [blockTree]);

  useEffect(() => {
    if (!treeRef.current || !activeBlockId) return;

    const node = treeRef.current.get(activeBlockId);

    if (node && !node.isSelected) {
      node.select();
      node.openParents();
    }

  }, [activeBlockId]);

  const handleSelect = (nodes: NodeApi<BlockNode>[]) => {
    if (!editor || nodes.length === 0) return;

    const selectedNode = nodes[0];
    const blockId = selectedNode.data.id;

    const pos = findPosByBlockId(editor.state.doc, blockId);

    if (pos === null) return;

    editor.chain().focus().setTextSelection(pos).scrollIntoView().run();
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>Document Tree</h3>
      </div>

      <div className={styles.treeWrapper}>
        {!blockTree && (
          <div className={styles.empty}>Document tree not initialized</div>
        )}

        {blockTree && data.length === 0 && (
          <div className={styles.empty}>Document tree empty</div>
        )}

        {blockTree && data.length > 0 && (
          <Tree<BlockNode>
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
            {TreeNode}
          </Tree>
        )}
      </div>
    </div>
  );
}