import DocumentTree from "../tree/DocumentTree"
import styles from "./FormatBuilderTab.module.css"

export default function FormatBuilderTab() {
  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <p className={styles.description}>
          Visual layout of the document structure.
        </p>
      </div>

      <div className={styles.treeContainer}>
        <DocumentTree />
      </div>
    </div>
  )
}