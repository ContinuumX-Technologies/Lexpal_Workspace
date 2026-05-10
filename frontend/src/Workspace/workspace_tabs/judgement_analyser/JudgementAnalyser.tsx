import React, { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import styles from "./JudgementAnalyser.module.css";
import JudgementAiChat from "./JudgementAiChat";

type CaseTask = "facts" | "issues" | "petitioner_args" | "respondent_args" | "law_analysis" | "precedent_analysis" | "court_reasoning" | "conclusion";
type TaskType = CaseTask | "full";

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

interface TextBlock {
  type: string;
  content: string;
}

interface Highlight {
  id: string;
  text: string;
  color: string;
  paraKey: string;
  offset: number;
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
  const [pins, setPins] = useState<{ id: string; text: string; fullText: string; paraKey?: string }[]>([]);
  // paraKey = "blockIdx-lineIdx" — uniquely identifies each <p> element
  const [selectionMenu, setSelectionMenu] = useState<{ x: number; y: number; text: string; paraKey?: string; offset?: number } | null>(null);
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);
  // id lets us remove individual highlights
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [currentHighlightIndices, setCurrentHighlightIndices] = useState<Record<string, number>>({});
  const mainRef = useRef<HTMLDivElement>(null);

  const navigateByColor = (color: string, direction: 'next' | 'prev') => {
    const colorHighlights = highlights
      .filter(h => h.color === color)
      .sort((a, b) => {
        const [aBlock, aLine] = a.paraKey.split('-').map(Number);
        const [bBlock, bLine] = b.paraKey.split('-').map(Number);
        if (aBlock !== bBlock) return aBlock - bBlock;
        if (aLine !== bLine) return aLine - bLine;
        return a.offset - b.offset;
      });

    if (colorHighlights.length === 0) return;

    let nextIndex = (currentHighlightIndices[color] || 0);
    if (direction === 'next') {
      nextIndex = (nextIndex + 1) % colorHighlights.length;
    } else {
      nextIndex = (nextIndex - 1 + colorHighlights.length) % colorHighlights.length;
    }

    setCurrentHighlightIndices(prev => ({ ...prev, [color]: nextIndex }));
    const target = colorHighlights[nextIndex];
    
    const element = document.querySelector(`[data-para-key="${target.paraKey}"]`) as HTMLElement;
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Temporary flash to show which one is selected
      element.style.outline = `2px solid ${color}`;
      element.style.outlineOffset = '2px';
      setTimeout(() => {
        element.style.outline = 'none';
      }, 1500);
    }
  };

  const addHighlight = (color: string) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    
    const range = selection.getRangeAt(0);
    const container = document.querySelector(`.${styles.judgmentSection}`);
    if (!container) return;

    const allParas = Array.from(container.querySelectorAll('p[data-para-key]')) as HTMLElement[];
    const newHighlights: Highlight[] = [];

    allParas.forEach(para => {
      if (selection.containsNode(para, true)) {
        const paraKey = para.getAttribute('data-para-key')!;
        let startOffset = 0;
        let endOffset = para.textContent?.length || 0;

        // If selection starts in this para
        if (para.contains(range.startContainer)) {
          const preRange = document.createRange();
          preRange.selectNodeContents(para);
          preRange.setEnd(range.startContainer, range.startOffset);
          startOffset = preRange.toString().length;
        }

        // If selection ends in this para
        if (para.contains(range.endContainer)) {
          const preRange = document.createRange();
          preRange.selectNodeContents(para);
          preRange.setEnd(range.endContainer, range.endOffset);
          endOffset = preRange.toString().length;
        }

        const text = para.textContent?.substring(startOffset, endOffset) || "";
        if (text.trim()) {
          newHighlights.push({
            id: `${Date.now()}-${Math.random()}`,
            text,
            color,
            paraKey,
            offset: startOffset
          });
        }
      }
    });

    if (newHighlights.length > 0) {
      setHighlights(prev => [...prev, ...newHighlights]);
    }
    
    setSelectionMenu(null);
    selection.removeAllRanges();
  };

  const removeHighlightByParaKey = (paraKey: string, offset: number) => {
    setHighlights(prev => prev.filter(h => !(h.paraKey === paraKey && h.offset === offset)));
    setSelectionMenu(null);
  };

  const renderTextWithHighlights = (text: string, paraKey: string) => {
    if (!highlights.length) return text;

    // Only apply highlights targeting this exact paragraph
    const paraHighlights = highlights
      .filter(h => h.paraKey === paraKey)
      .sort((a, b) => a.offset - b.offset);

    if (!paraHighlights.length) return text;

    let result: (string | React.ReactNode)[] = [];
    let lastIndex = 0;

    paraHighlights.forEach((h) => {
      if (h.offset > lastIndex) {
        result.push(text.substring(lastIndex, h.offset));
      }
      result.push(
        <mark key={h.id} style={{ backgroundColor: h.color, borderRadius: '2px', padding: '0 2px' }}>
          {h.text}
        </mark>
      );
      lastIndex = h.offset + h.text.length;
    });

    if (lastIndex < text.length) {
      result.push(text.substring(lastIndex));
    }

    return result;
  };

  // Fetch document details when caseId changes
  useEffect(() => {
    if (caseId) {
      fetchCaseDetails(caseId);
    }
  }, [caseId]);

  const navigateToPin = (id: string, fullText: string, paraKey?: string) => {
    // If we have the exact paragraph key, navigate directly to it
    const foundElement = paraKey
      ? (document.querySelector(`[data-para-key="${paraKey}"]`) as HTMLElement | null)
      : (() => {
          // Fallback: scan all paragraphs by text content
          for (const el of Array.from(document.querySelectorAll('[data-para-key]')) as HTMLElement[]) {
            if (el.textContent?.includes(fullText)) return el;
          }
          return null;
        })();

    if (foundElement) {
      foundElement.scrollIntoView({ behavior: "smooth", block: "center" });
      setActiveHighlightId(id);

      // Temporarily flash-highlight the paragraph
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
      const commonAncestor = range.commonAncestorContainer;
      
      if (container && container.contains(commonAncestor)) {
        // Check if start and end are in the same paragraph
        const startPara = range.startContainer.nodeType === 1 ? (range.startContainer as HTMLElement).closest('p') : range.startContainer.parentElement?.closest('p');
        const endPara = range.endContainer.nodeType === 1 ? (range.endContainer as HTMLElement).closest('p') : range.endContainer.parentElement?.closest('p');
        
        let paraKey: string | undefined;
        let offset: number | undefined;

        if (startPara && startPara === endPara && startPara.hasAttribute('data-para-key')) {
          paraKey = startPara.getAttribute('data-para-key')!;
          const preRange = range.cloneRange();
          preRange.selectNodeContents(startPara);
          preRange.setEnd(range.startContainer, range.startOffset);
          offset = preRange.toString().length;
        }

        setSelectionMenu({
          x: rect.left + rect.width / 2,
          y: rect.top,
          text,
          paraKey,
          offset
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
      fullText: text,
      paraKey: selectionMenu?.paraKey,  // store exact paragraph location
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
                onClick={() => navigateToPin(pin.id, pin.fullText, pin.paraKey)}
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

        {/* Floating Horizontal Navigation Gutter at the top */}
        <nav className={styles.nav}>
          <div className={styles.navList}>
            {navItems.map(item => (
              <button
                key={item.id}
                onClick={() => setActiveTask(item.id)}
                className={`${styles.navLink} ${activeTask === item.id ? styles.navLinkActive : ""}`}
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

                              const paraKey = `${idx}-${lineIdx}`;

                              // Main paragraph starting with "1.", "¶ 1", etc.
                              if (/^(\d+\.|\u00b6\s*\d+)/.test(trimmed)) {
                                return <p key={lineIdx} data-para-key={paraKey} className={styles.para}>{renderTextWithHighlights(line, paraKey)}</p>;
                              }

                              // List items starting with "(a)", "a.", "(i)", etc.
                              if (/^(\([a-z\d]+\)|[a-z]\.|\([ivx]+\)|[ivx]+\.)/i.test(trimmed)) {
                                return <p key={lineIdx} data-para-key={paraKey} className={styles.listItem}>{renderTextWithHighlights(line, paraKey)}</p>;
                              }

                              // Sub-list items or deeply indented lines
                              if (line.startsWith('    ') || line.startsWith('\t')) {
                                return <p key={lineIdx} data-para-key={paraKey} className={styles.subListItem}>{renderTextWithHighlights(line, paraKey)}</p>;
                              }

                              // Plain paragraphs
                              return <p key={lineIdx} data-para-key={paraKey} style={{ textIndent: '2rem' }}>{renderTextWithHighlights(line, paraKey)}</p>;
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
        
        {/* Vertical Highlight Navigator in the gutter */}
        {highlights.length > 0 && (
          <div className={styles.gutterToolbar}>
            <div className={styles.gutterHeader} title="Highlight Navigator">
              <span className={`${styles.materialIcon} ${styles.iconSmall}`}>auto_awesome</span>
            </div>
            <div className={styles.gutterContent}>
              {Object.entries(
                highlights.reduce((acc, h) => {
                  if (!acc[h.color]) acc[h.color] = 0;
                  acc[h.color]++;
                  return acc;
                }, {} as Record<string, number>)
              ).map(([color, count]) => (
                <div key={color} className={styles.gutterGroup}>
                  <div className={styles.gutterColorDot} style={{ backgroundColor: color }} />
                  <span className={styles.gutterCount}>{count}</span>
                  <div className={styles.gutterArrows}>
                    <button onClick={() => navigateByColor(color, 'prev')} className={styles.gutterArrow} title="Previous">
                      <span className={styles.materialIcon}>expand_less</span>
                    </button>
                    <button onClick={() => navigateByColor(color, 'next')} className={styles.gutterArrow} title="Next">
                      <span className={styles.materialIcon}>expand_more</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

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
          
          <div className={styles.selectionDivider} />
          
          <div className={styles.colorOptions}>
            <button 
              className={styles.colorCircle} 
              style={{ backgroundColor: '#fef08a' }} 
              onClick={() => addHighlight('#fef08a')}
              title="Yellow"
            />
            <button 
              className={styles.colorCircle} 
              style={{ backgroundColor: '#bbf7d0' }} 
              onClick={() => addHighlight('#bbf7d0')}
              title="Green"
            />
            <button 
              className={styles.colorCircle} 
              style={{ backgroundColor: '#bfdbfe' }} 
              onClick={() => addHighlight('#bfdbfe')}
              title="Blue"
            />
            <button 
              className={styles.colorCircle} 
              style={{ backgroundColor: '#fbcfe8' }} 
              onClick={() => addHighlight('#fbcfe8')}
              title="Pink"
            />
            {selectionMenu?.paraKey && selectionMenu?.offset !== undefined && highlights.some(h => h.paraKey === selectionMenu.paraKey && h.offset === selectionMenu.offset) && (
              <button
                className={styles.colorCircle}
                style={{ backgroundColor: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onClick={() => removeHighlightByParaKey(selectionMenu!.paraKey!, selectionMenu!.offset!)}
                title="Remove Highlight"
              >
                <span className={`${styles.materialIcon}`} style={{ fontSize: '13px', color: '#64748b' }}>format_color_reset</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default JudgementAnalyser;
