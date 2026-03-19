import { useTabCtx } from '../contexts/tab.context'
import styles from './MainContent.module.css'
import JudgementSearch from '../workspace_tabs/judgement_search/JudgementSearch'
import LawSearch from '../workspace_tabs/law_search/LawSearch'
import JudgementAnalyser from '../workspace_tabs/judgement_analyser/JudgementAnalyser'
import Draftspace from '../workspace_tabs/draftspace/Draftspace'

const TAB_MAP = {

  "law_search": <LawSearch />,
  "judgement_search": <JudgementSearch />,
  "judgement_analyzer": <JudgementAnalyser />,
  "draft_space": <Draftspace />,
} as const

export default function MainContent() {
  const { activeTab } = useTabCtx();
  return <div className={styles.mainContent}>{TAB_MAP[activeTab]}</div>
}