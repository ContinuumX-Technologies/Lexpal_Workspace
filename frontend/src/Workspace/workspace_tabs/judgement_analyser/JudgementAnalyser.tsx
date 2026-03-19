import React from "react";
import styles from "./JudgementAnalyser.module.css";

const JudgementAnalyser: React.FC = () => {
  return (
    <div className={styles.container}>
      {/* Header with pins bar */}
      <header className={styles.header}>
        <div className={styles.pinsBar}>
          <div className={styles.pinsLeft}>
            <span className={`${styles.materialIcon} ${styles.iconSmall} ${styles.iconGray}`}>push_pin</span>
            <span className={styles.pinsLabel}>Pins</span>
          </div>
          <div className={styles.pinsList}>
            <div className={`${styles.chip} ${styles.chipPinned}`}>
              <span className={`${styles.materialIcon} ${styles.iconBlue} ${styles.iconFill}`}>push_pin</span>
              <span className={styles.chipText}>Ratio Decidendi</span>
              <button className={styles.chipClose}>
                <span className={`${styles.materialIcon} ${styles.iconTiny}`}>close</span>
              </button>
            </div>
            <div className={`${styles.chip} ${styles.chipPinned}`}>
              <span className={`${styles.materialIcon} ${styles.iconAmber} ${styles.iconFill}`}>push_pin</span>
              <span className={styles.chipText}>4th Amendment</span>
              <button className={styles.chipClose}>
                <span className={`${styles.materialIcon} ${styles.iconTiny}`}>close</span>
              </button>
            </div>
            <div className={`${styles.chip} ${styles.chipPinned}`}>
              <span className={`${styles.materialIcon} ${styles.iconGreen} ${styles.iconFill}`}>push_pin</span>
              <span className={styles.chipText}>Obiter Dicta</span>
              <button className={styles.chipClose}>
                <span className={`${styles.materialIcon} ${styles.iconTiny}`}>close</span>
              </button>
            </div>
            <button className={`${styles.chip} ${styles.newPinChip}`}>+ New Pin</button>
          </div>
        </div>

        {/* Navigation tabs */}
        <nav className={styles.nav}>
          <div className={styles.navList}>
            <a href="#" className={`${styles.navLink} ${styles.navLinkActive}`}>Facts</a>
            <a href="#" className={styles.navLink}>Issues</a>
            <a href="#" className={styles.navLink}>Petitioner Args.</a>
            <a href="#" className={styles.navLink}>Respondent Args.</a>
            <a href="#" className={styles.navLink}>Law Analysis</a>
            <a href="#" className={styles.navLink}>Precedent Analysis</a>
            <a href="#" className={styles.navLink}>Court's Reasoning</a>
            <a href="#" className={styles.navLink}>Conclusion</a>
          </div>
        </nav>
      </header>

      {/* Main content */}
      <main className={styles.main}>
        {/* Judgment text section */}
        <section className={styles.judgmentSection}>
          <div className={styles.judgmentContent}>
            <div className={styles.metadata}>
              <span className={`${styles.chip} ${styles.metaChip}`}>supreme court of india</span>
              <span className={`${styles.chip} ${styles.metaChip}`}>2026 INSC 4321</span>
              <span className={styles.dateChip}>26 january 2025</span>
            </div>

            <h1 className={styles.title}>State of New York v. Marcus Thompson</h1>

            <div className={styles.benchInfo}>
              <span className={`${styles.materialIcon} ${styles.iconMedium} ${styles.iconGray}`}>gavel</span>
              <div className={styles.benchText}>
                <span className={styles.benchLabel}>Judges on the Bench</span>
                <span className={styles.benchNames}>Hon'ble Justice S. Roberts, Hon'ble Justice A. Kagan</span>
              </div>
            </div>

            <div className={styles.judgmentText}>
              <p>
                <span className={styles.paraNumber}>¶ 12</span>
                The Appellant contends that the search warrant issued on the 14th of June was defective due to a lack of specificity regarding the digital assets to be seized. It is established law that a warrant must describe the things to be seized with reasonable particularity.
              </p>
              <p>
                <span className={styles.paraNumber}>¶ 13</span>
                In the present case, the warrant authorized the seizure of "all electronic devices capable of storing digital data." We find that this broad phrasing, in the context of a residential search for evidence of financial fraud, is not per se unconstitutional.
              </p>
              <div className={styles.highlightedPara}>
                <div className={styles.highlightBackground}></div>
                <p className={styles.highlightText}>
                  <span className={styles.paraNumber}>¶ 14</span>
                  <span className={styles.highlightContent}>
                    The court must balance the Fourth Amendment protections against the practical realities of modern digital forensics. The mere presence of non-responsive data on a device does not render the entire seizure unreasonable, provided that the initial intrusion was justified by probable cause.
                  </span>
                </p>
              </div>
              <p>
                <span className={styles.paraNumber}>¶ 15</span>
                Referring to <i>United States v. Ross</i> [1982], the scope of a warrantless search is defined by the object of the search and the places in which there is probable cause to believe that it may be found.
              </p>
            </div>
          </div>
        </section>

        {/* Chat aside */}
        <aside className={styles.chatAside}>
          <div className={styles.chatHeader}>
            <span className={styles.chatTitle}>LEXPAL AI</span>
          </div>

          <div className={styles.chatMessages}>
            <div className={styles.messageGroup}>
              <p className={styles.messageSender}>You</p>
              <div className={styles.messageBubble}>
                <p className={styles.messageText}>Does the court address the Fourth Amendment in the context of digital data?</p>
              </div>
            </div>
            <div className={styles.messageGroup}>
              <p className={`${styles.messageSender} ${styles.senderAI}`}>LexAI</p>
              <div className={styles.messageBubble}>
                <div className={styles.messageText}>
                  Yes, the court specifically addresses this in the section regarding the Appellant's suppression motion.
                  <br /><br />
                  According to <button className={`${styles.chip} ${styles.paraChip}`}>¶ 14</button>, the court explicitly balances Fourth Amendment protections.
                </div>
              </div>
            </div>
          </div>

          <div className={styles.chatInputArea}>
            <div className={styles.inputContainer}>
              <div className={styles.pinnedChips}>
                <div className={`${styles.chip} ${styles.inputChip}`}>
                  <span className={`${styles.materialIcon} ${styles.iconBlue} ${styles.iconFill}`}>push_pin</span>
                  Ratio Decidendi
                  <button className={styles.chipClose}>
                    <span className={`${styles.materialIcon} ${styles.iconTiny}`}>close</span>
                  </button>
                </div>
              </div>
              <div className={styles.inputRow}>
                <button className={styles.addButton}>
                  <span className={`${styles.materialIcon} ${styles.iconMedium}`}>add_circle</span>
                </button>
                <textarea className={styles.textInput} placeholder="Ask about this judgment..." rows={1}></textarea>
                <button className={styles.sendButton}>
                  <span className={`${styles.materialIcon} ${styles.iconSmall}`}>arrow_upward</span>
                </button>
              </div>
            </div>
          </div>
        </aside>
      </main>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={styles.footerLeft}>
          <span className={`${styles.materialIcon} ${styles.iconTiny}`}>folder</span>
          <a href="#" className={styles.footerLink}>Legal Projects</a>
          <span className={styles.footerSeparator}>/</span>
          <span className={styles.footerCurrent}>NY v. Thompson</span>
        </div>
        <div className={styles.footerRight}>
          <div className={styles.footerItem}>
            <div className={styles.statusDot}></div>
            <span className={styles.footerText}>Sync Complete</span>
          </div>
          <div className={styles.footerItem}>
            <span className={`${styles.materialIcon} ${styles.iconTiny}`}>group</span>
            <span className={styles.footerText}>2 Users active</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default JudgementAnalyser;