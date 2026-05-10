import React, { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import styles from "./JudgementAnalyser.module.css";
import JudgementAiChat from "./JudgementAiChat";

type CaseTask = "facts" | "issues" | "petitioner_args" | "respondent_args" | "law_analysis" | "precedent_analysis" | "court_reasoning" | "conclusion";
type TaskType = CaseTask | "full";

interface TextBlock {
  type: string;
  content: string;
}

interface CaseDoc {
  _id: string;
  title: string;
  judgement_type: string;
  year: number;
  bench: string[];
  texts: TextBlock[];
  createdAt: string;
  summary?: any;
}

const JudgementAnalyser: React.FC = () => {
  const { caseId } = useParams<{ caseId: string }>();
  const [activeTask, setActiveTask] = useState<TaskType>("full");
  const [loading, setLoading] = useState(false);
  const [caseData, setCaseData] = useState<CaseDoc | null>(null);
  const [judgementText, setJudgementText] = useState("");
  const [pins, setPins] = useState<{ id: string; text: string; fullText: string }[]>([]);
  const [selectionMenu, setSelectionMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);

  // Fetch document details when caseId changes
  useEffect(() => {
    if (caseId) {
      fetchCaseDetails(caseId);
    }
  }, [caseId]);

  const navigateToPin = (id: string, fullText: string) => {
    // Find paragraphs containing the text
    const paragraphs = document.querySelectorAll(`.${styles.judgmentText} p, .${styles.analysisResult} p`);
    let foundElement: HTMLElement | null = null;
    
    for (const el of Array.from(paragraphs) as HTMLElement[]) {
      if (el.textContent?.includes(fullText)) {
        foundElement = el;
        break;
      }
    }

    if (foundElement) {
      foundElement.scrollIntoView({ behavior: "smooth", block: "center" });
      setActiveHighlightId(id);
      
      // Imperative highlight for the paragraph
      const highlightClass = styles.temporaryHighlight;
      foundElement.classList.add(highlightClass);
      
      setTimeout(() => {
        setActiveHighlightId(null);
        foundElement?.classList.remove(highlightClass);
      }, 2500);
    }
  };

  useEffect(() => {
    const handleSelection = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) {
        setSelectionMenu(null);
        return;
      }

      const text = selection.toString().trim();
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      // Ensure the selection is within the judgment section
      const container = document.querySelector(`.${styles.judgmentSection}`);
      if (container && container.contains(range.commonAncestorContainer)) {
        setSelectionMenu({
          x: rect.left + rect.width / 2,
          y: rect.top,
          text
        });
      } else {
        setSelectionMenu(null);
      }
    };

    document.addEventListener("selectionchange", handleSelection);
    return () => document.removeEventListener("selectionchange", handleSelection);
  }, []);

  const addPin = (text: string) => {
    if (!text) return;
    const newPin = { 
      id: Date.now().toString(), 
      text: text.length > 50 ? text.substring(0, 50) + "..." : text,
      fullText: text 
    };
    setPins(prev => [...prev, newPin]);
    setSelectionMenu(null);
    window.getSelection()?.removeAllRanges();
  };

  const removePin = (id: string) => {
    setPins(prev => prev.filter(p => p.id !== id));
  };

  const fetchCaseDetails = async (id: string) => {
    try {
      setLoading(true);
      const res = await fetch(`http://localhost:3001/api/judgements/${id}`);
      if (!res.ok) throw new Error("Failed to fetch judgment");
      const data = await res.json();
      setCaseData(data);
    } catch (err) {
      console.error("Error fetching judgment details:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (caseData && caseData.texts) {
      if (activeTask === "full") {
        setJudgementText(caseData.texts.map(t => t.content).join("\n\n"));
      } else {
        const targetType = taskToMongoType[activeTask as CaseTask];
        const filtered = caseData.texts.filter(t => t.type === targetType);
        const content = filtered.length > 0 
          ? filtered.map(t => t.content).join("\n\n") 
          : "";
        
        setJudgementText(content);
      }
    }
  }, [activeTask, caseData]);

  const navItems: { id: TaskType; label: string }[] = [
    { id: "full", label: "Full Judgement" },
    { id: "facts", label: "Facts" },
    { id: "issues", label: "Issues" },
    { id: "petitioner_args", label: "Petitioner Args." },
    { id: "respondent_args", label: "Respondent Args." },
    { id: "law_analysis", label: "Law Analysis" },
    { id: "precedent_analysis", label: "Precedent Analysis" },
    { id: "court_reasoning", label: "Court's Reasoning" },
    { id: "conclusion", label: "Conclusion" },
  ];

  const taskToMongoType: Record<CaseTask, string> = {
    facts: "Fact",
    issues: "Issue",
    petitioner_args: "Petitioner's Argument",
    respondent_args: "Respondent's Argument",
    law_analysis: "Analysis of the law",
    precedent_analysis: "Precedent Analysis",
    court_reasoning: "Court's Reasoning",
    conclusion: "Conclusion"
  };

  return (
    <div className={styles.container} ref={mainRef}>
      {/* Header with pins bar */}
      <header className={styles.header}>
        <div className={styles.pinsBar}>
          <div className={styles.pinsLeft}>
            <span className={`${styles.materialIcon} ${styles.iconSmall} ${styles.iconGray}`}>push_pin</span>
            <span className={styles.pinsLabel}>Pins</span>
          </div>
          <div className={styles.pinsList}>
            {pins.map(pin => (
              <div 
                key={pin.id} 
                className={`${styles.chip} ${styles.chipPinned} ${activeHighlightId === pin.id ? styles.chipActive : ""}`}
                onClick={() => navigateToPin(pin.id, pin.fullText)}
                style={{ cursor: "pointer" }}
              >
                <span className={`${styles.materialIcon} ${styles.iconBlue} ${styles.iconFill}`}>push_pin</span>
                <span className={styles.chipText}>{pin.text}</span>
                <button 
                  className={styles.chipClose}
                  onClick={(e) => { e.stopPropagation(); removePin(pin.id); }}
                >
                  <span className={`${styles.materialIcon} ${styles.iconTiny}`}>close</span>
                </button>
              </div>
            ))}
            <button className={`${styles.chip} ${styles.newPinChip}`}>+ New Pin</button>
          </div>
        </div>

        {/* Navigation tabs */}
        <nav className={styles.nav}>
          <div className={styles.navList}>
            {navItems.map(item => (
              <button
                key={item.id}
                onClick={() => setActiveTask(item.id)}
                className={`${styles.navLink} ${activeTask === item.id ? styles.navLinkActive : ""}`}
                style={{ background: 'none', border: 'none', cursor: 'pointer' }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </nav>
      </header>

      {/* Main content */}
      <main className={styles.main}>
        {/* Judgment text section */}
        <section className={styles.judgmentSection}>
          <div className={styles.judgmentContent}>
            {loading && activeTask === "full" && (
              <div className={styles.loadingContainer}>
                <p>Loading judgement...</p>
              </div>
            )}

            <div style={{ height: '2rem' }} />

            {caseData ? (
              <div className={styles.originalJudgement}>
                <div className={styles.metadata}>
                  <div className={styles.metaChip}>
                    <span className={`${styles.materialIcon} ${styles.iconExtraSmall}`}>balance</span>
                    {caseData.judgement_type}
                  </div>
                  <div className={styles.metaChip}>
                    <span className={`${styles.materialIcon} ${styles.iconExtraSmall}`}>tag</span>
                    {caseData.year}
                  </div>
                  <div className={styles.dateChip}>
                    <span className={`${styles.materialIcon} ${styles.iconExtraSmall}`}>calendar_today</span>
                    {caseData.createdAt ? new Date(caseData.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "N/A"}
                  </div>
                </div>

                <h1 className={styles.title}>{caseData.title}</h1>

                <div className={styles.benchInfo}>
                  <span className={`${styles.materialIcon} ${styles.iconMedium} ${styles.iconGray}`}>gavel</span>
                  <div className={styles.benchText}>
                    <span className={styles.benchLabel}>Judges on the Bench</span>
                    <span className={styles.benchNames}>
                      {caseData.bench && caseData.bench.length > 0 ? caseData.bench.join(", ") : "Not specified"}
                    </span>
                  </div>
                </div>

                <div className={styles.judgmentText}>
                  {(activeTask === "full" ? caseData.texts : caseData.texts.filter(t => t.type === taskToMongoType[activeTask as CaseTask])).length > 0 ? (
                    (activeTask === "full" ? caseData.texts : caseData.texts.filter(t => t.type === taskToMongoType[activeTask as CaseTask]))
                      .map((t, idx) => (
                        <React.Fragment key={idx}>
                          {/* Split by newline OR inline markers like (i), (ii), (a) that follow text */}
                          {t.content
                            .split(/(\n|(?<=\S)\s+(?=\([a-z\d]+\)|[a-z]\.|\([ivx]+\)|[ivx]+\.))/)
                            .map((line, lineIdx) => {
                              const trimmed = line.trim();
                              if (!trimmed || line === '\n') return null;

                              // Main paragraph starting with "1.", "¶ 1", etc.
                              if (/^(\d+\.|\u00b6\s*\d+)/.test(trimmed)) {
                                return <p key={lineIdx} className={styles.para}>{line}</p>;
                              }

                              // List items starting with "(a)", "a.", "(i)", etc.
                              if (/^(\([a-z\d]+\)|[a-z]\.|\([ivx]+\)|[ivx]+\.)/i.test(trimmed)) {
                                return <p key={lineIdx} className={styles.listItem}>{line}</p>;
                              }

                              // Sub-list items or deeply indented lines
                              if (line.startsWith('    ') || line.startsWith('\t')) {
                                return <p key={lineIdx} className={styles.subListItem}>{line}</p>;
                              }

                              // Plain paragraphs
                              return <p key={lineIdx} style={{ textIndent: '2rem' }}>{line}</p>;
                            })}
                        </React.Fragment>
                      ))
                  ) : (
                    <div className={styles.emptyState}>
                      <span className={`${styles.materialIcon} ${styles.iconLarge}`}>info</span>
                      <p>No original content labeled "{navItems.find(i => i.id === activeTask)?.label}" found in this document.</p>
                    </div>
                  )}
                </div>
              </div>
            ) : !loading && (
              <div className={styles.emptyState}>
                <p>No judgment loaded. Please select a case from the Search tab.</p>
              </div>
            )}
          </div>
        </section>

        {/* Chat aside */}
        <aside className={styles.chatAside}>
          <div className={styles.chatHeader}>
            <span className={styles.chatTitle}>LEXPAL AI</span>
          </div>
          <JudgementAiChat judgementText={judgementText} />
        </aside>
      </main>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={styles.footerLeft}>
          <span className={`${styles.materialIcon} ${styles.iconTiny}`}>folder</span>
          <a href="#" className={styles.footerLink}>Legal Projects</a>
          <span className={styles.footerSeparator}>/</span>
          <span className={styles.footerCurrent}>{caseData ? caseData.title : "No Case Selected"}</span>
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

      {selectionMenu && (
        <div
          className={styles.selectionPopup}
          style={{
            position: 'fixed',
            left: `${selectionMenu?.x}px`,
            top: `${selectionMenu?.y}px`,
            transform: 'translate(-50%, -120%)'
          }}
        >
          <button
            className={styles.addPinButton}
            onClick={() => addPin(selectionMenu?.text)}
          >
            <span className={`${styles.materialIcon} ${styles.iconSmall}`}>push_pin</span>
            Add to Pins
          </button>
        </div>
      )}
    </div>
  );
};

export default JudgementAnalyser;
