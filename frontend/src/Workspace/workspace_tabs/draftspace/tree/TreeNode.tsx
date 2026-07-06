import { NodeApi } from "react-arborist";
import styles from "./DocumentTree.module.css";
import { ChevronRight, ChevronDown, FileText, Type, ListTree } from "lucide-react";

type TreeNodeProps = {
    node: NodeApi<any>;
    style: React.CSSProperties;
    dragHandle?: (el: HTMLDivElement | null) => void;
};

export default function TreeNode({ node, style, dragHandle }: TreeNodeProps) {
    const isSelected = node.isSelected;
    const isHovered = false; // We could get this from store if we wanted deep hover sync

    const getIcon = () => {
        if (node.data.type === "section") return <FileText size={14} />;
        if (node.data.type === "clause") return <ListTree size={14} />;
        return <Type size={14} />;
    };

    const getTitle = () => {
        if (node.data.type === "section") return node.data.title || "Untitled Section";
        if (node.data.type === "clause") {
            const num = node.data.number ? `${node.data.number} ` : "";
            const title = node.data.title ? node.data.title : "Clause";
            return `${num}${title}`;
        }
        return "Paragraph";
    };

    return (
        <div
            style={style}
            ref={dragHandle}
            className={`${styles.nodeRow} ${isSelected ? styles.nodeSelected : ""} ${isHovered ? styles.nodeHovered : ""}`}
            onClick={() => node.select()}
            onDoubleClick={() => node.toggle()}
        >
            <div
                className={styles.indent}
                style={{ width: node.level * 16 }}
            />

            <div
                className={`${styles.expander} ${node.isLeaf ? styles.expanderHidden : ""}`}
                onClick={(e) => {
                    e.stopPropagation();
                    node.toggle();
                }}
            >
                {node.isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </div>

            <div className={styles.icon}>{getIcon()}</div>

            <div className={styles.label}>
                {getTitle()}
            </div>
        </div>
    );
}
