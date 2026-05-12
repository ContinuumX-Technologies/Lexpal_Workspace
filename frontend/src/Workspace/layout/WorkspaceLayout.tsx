// workspace/layout/WorkspaceLayout.tsx
import Navbar from './Navbar'
import LeftPanel from './LeftPanel'
import MainContent from './MainContent'
import styles from './WorkspaceLayout.module.css'

export default function WorkspaceLayout() {
  return (
    <div className={styles.workspaceWrapper}>
      <Navbar />
      <div className={styles.workspaceRoot}>
        <LeftPanel />

        <div className={styles.workspaceBody}>
          <MainContent />
        </div>
      </div>
    </div>
  )
}
