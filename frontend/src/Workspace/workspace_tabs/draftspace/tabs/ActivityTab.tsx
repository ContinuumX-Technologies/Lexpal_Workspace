import { useDraftStore } from "../store/draftStore";
import styles from "./ActivityTab.module.css";
import {History } from "lucide-react";

const BADGE_MAP: Record<string, { label: string; color: string; bg: string; description: string }> = {
  edit: { label: 'M', color: '#007ACC', bg: 'rgba(0, 122, 204, 0.1)', description: 'modified' },
  create: { label: 'A', color: '#73C991', bg: 'rgba(115, 201, 145, 0.1)', description: 'created' },
  comment: { label: 'C', color: '#E2C08D', bg: 'rgba(226, 192, 141, 0.1)', description: 'commented' },
  assign: { label: 'U', color: '#C586C0', bg: 'rgba(197, 134, 192, 0.1)', description: 'assigned' },
};

export default function ActivityTab() {
  const { activeDraftId, drafts } = useDraftStore();
  const currentDraft = drafts[activeDraftId];
  const activityLog = currentDraft?.activityLog || [];

  const parseActivity = (activity: any) => {
    const details = activity.details || '';
    let description = activity.description;
    let diffLines: { type: 'add' | 'remove', text: string }[] = [];

    if (details.startsWith('Added')) {
      const match = details.match(/Added.*:\s*"(.*)"/);
      if (match) {
        diffLines.push({ type: 'add', text: match[1] });
        description = 'added content';
      }
    } else if (details.startsWith('Modified:')) {
      const match = details.match(/Modified:\s*"(.*)"/);
      if (match) {
        diffLines.push({ type: 'add', text: match[1] });
        description = 'modified content';
      }
    } else if (details.startsWith('Diff:')) {
      const match = details.match(/Diff:\s*\[-(.*)\]\[\+(.*)\]/);
      if (match) {
        diffLines.push({ type: 'remove', text: match[1] });
        diffLines.push({ type: 'add', text: match[2] });
        description = 'modified content';
      }
    } else if (details.startsWith('Deleted')) {
      diffLines.push({ type: 'remove', text: details });
      description = 'deleted content';
    } else if (details.startsWith('Started draft')) {
      const match = details.match(/Started draft:\s*"(.*)"/);
      if (match) {
        diffLines.push({ type: 'add', text: match[1] });
        description = 'started draft';
      }
    }

    return { description, diffLines };
  };

  return (
    <div className={styles.container}>
      <div className={styles.logHeader}>
        <History size={14} className={styles.headerIcon} />
        <span className={styles.headerTitle}>TIMELINE</span>
      </div>
      <div className={styles.logList}>
        {activityLog.length === 0 ? (
          <div className={styles.emptyState}>
            <p>No activity yet. Every edit and team action will be logged here.</p>
          </div>
        ) : (
          activityLog.map((activity) => {
            const badge = BADGE_MAP[activity.type] || BADGE_MAP.edit;
            const parsed = parseActivity(activity);
            
            return (
              <div key={activity.id} className={styles.activityItem}>
                <div 
                  className={styles.statusBadge}
                  style={{ color: badge.color, backgroundColor: badge.bg }}
                >
                  {badge.label}
                </div>
                <div className={styles.details}>
                  <div className={styles.headerInfo}>
                    <span className={styles.userName}>{activity.userName}</span>
                    <span className={styles.actionType}>{parsed.description}</span>
                    <span className={styles.timestamp}>
                      {new Date(activity.timestamp).toLocaleTimeString([], { 
                        hour: '2-digit', 
                        minute: '2-digit',
                        hour12: false
                      })}
                    </span>
                  </div>
                  
                  {parsed.diffLines.length > 0 && (
                    <div className={styles.diffContainer}>
                      {parsed.diffLines.map((line, idx) => (
                        <div key={idx} className={`${styles.diffLine} ${line.type === 'add' ? styles.diffAdd : styles.diffRemove}`}>
                          <div className={styles.diffGutter}>{line.type === 'add' ? '+' : '-'}</div>
                          <code className={styles.diffCode}>{line.text}</code>
                        </div>
                      ))}
                    </div>
                  )}

                  {activity.details && parsed.diffLines.length === 0 && (
                    <div className={styles.detailsBox}>
                      <p className={styles.detailText}>{activity.details}</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
