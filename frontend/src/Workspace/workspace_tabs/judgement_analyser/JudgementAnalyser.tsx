import React, { useState, useEffect, useRef } from "react";
import styles from "./JudgementAnalyser.module.css";

type CaseTask = "facts" | "issues" | "petitioner_args" | "respondent_args" | "law_analysis" | "precedent_analysis" | "court_reasoning" | "conclusion";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const JudgementAnalyser: React.FC = () => {
  const [activeTask, setActiveTask] = useState<CaseTask>("facts");
  const [analysisResults, setAnalysisResults] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [userInput, setUserInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [pins, setPins] = useState<{ id: string; text: string; fullText: string }[]>([
    { id: "1", text: "Ratio Decidendi", fullText: "Ratio Decidendi" }
  ]);
  const [selectionMenu, setSelectionMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);

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

  // Hardcoded for now as per the "placeholder" requirement, but will be used for analysis
  const [judgementText] = useState(`
State of New York v. Marcus Thompson
2026 INSC 4321, 26 January 2025
Bench: Hon'ble Justice S. Roberts, Hon'ble Justice A. Kagan

¶ 12 The Appellant contends that the search warrant issued on the 14th of June was defective due to a lack of specificity regarding the digital assets to be seized. It is established law that a warrant must describe the things to be seized with reasonable particularity.

¶ 13 In the present case, the warrant authorized the seizure of "all electronic devices capable of storing digital data." We find that this broad phrasing, in the context of a residential search for evidence of financial fraud, is not per se unconstitutional.

¶ 14 The court must balance the Fourth Amendment protections against the practical realities of modern digital forensics. The mere presence of non-responsive data on a device does not render the entire seizure unreasonable, provided that the initial intrusion was justified by probable cause.

¶ 15 Referring to United States v. Ross [1982], the scope of a warrantless search is defined by the object of the search and the places in which there is probable cause to believe that it may be found.
  `);

  useEffect(() => {
    if (!analysisResults[activeTask]) {
      fetchAnalysis(activeTask);
    }
  }, [activeTask]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  const fetchAnalysis = async (task: CaseTask) => {
    try {
      setLoading(true);
      const response = await fetch("http://localhost:3001/api/documents/judgement-analyse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ judgementText, task }),
      });
      const data = await response.json();
      if (data.result) {
        setAnalysisResults(prev => ({ ...prev, [task]: data.result }));
      }
    } catch (err) {
      console.error("Analysis fetch failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!userInput.trim()) return;

    const newMessage: ChatMessage = { role: "user", content: userInput };
    setChatHistory(prev => [...prev, newMessage]);
    setUserInput("");
    setChatLoading(true);

    try {
      const response = await fetch("http://localhost:3001/api/documents/judgement-analyse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          judgementText,
          query: userInput,
          history: chatHistory
        }),
      });
      const data = await response.json();
      if (data.result) {
        setChatHistory(prev => [...prev, { role: "assistant", content: data.result }]);
      }
    } catch (err) {
      console.error("Chat failed:", err);
    } finally {
      setChatLoading(false);
    }
  };

  const navItems: { id: CaseTask; label: string }[] = [
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
            {loading ? (
              <div className={styles.loadingContainer}>
                <p>Analyzing {navItems.find(i => i.id === activeTask)?.label}...</p>
              </div>
            ) : (
              <div className={styles.analysisResult}>
                <h2 className={styles.analysisSubTitle}>{navItems.find(i => i.id === activeTask)?.label}</h2>
                <div className={styles.judgmentText}>
                  {analysisResults[activeTask]
                    ? analysisResults[activeTask].split('\n').map((line, i) => (
                      <p key={i}>{line}</p>
                    ))
                    : <p>Select a tab to begin analysis.</p>
                  }
                </div>
              </div>
            )}

            <hr className={styles.divider} style={{ margin: '40px 0', opacity: 0.1 }} />

            <div className={styles.originalJudgement}>
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
                <div className={styles.highlightedPara}>
                  <div className={styles.highlightBackground}></div>
                  <p className={styles.highlightText}>
                    <span className={styles.paraNumber}>¶ 14</span>
                    <span className={styles.highlightContent}>
                      The court must balance the Fourth Amendment protections against the practical realities of modern digital forensics. The mere presence of non-responsive data on a device does not render the entire seizure unreasonable, provided that the initial intrusion was justified by probable cause.
                    </span>
                  </p>
                </div>
              </div>
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
              <p className={`${styles.messageSender} ${styles.senderAI}`}>LexAI</p>
              <div className={styles.messageBubble}>
                <p className={styles.messageText}>Hello! I've analyzed this judgement. How can I help you today?</p>
              </div>
            </div>

            {chatHistory.map((msg, i) => (
              <div key={i} className={styles.messageGroup}>
                <p className={`${styles.messageSender} ${msg.role === 'assistant' ? styles.senderAI : ''}`}>
                  {msg.role === 'user' ? 'You' : 'LexAI'}
                </p>
                <div className={styles.messageBubble}>
                  <div className={styles.messageText}>
                    {msg.content.split('\n').map((line, j) => (
                      <p key={j} style={{ margin: '4px 0' }}>{line}</p>
                    ))}
                  </div>
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className={styles.messageGroup}>
                <p className={`${styles.messageSender} ${styles.senderAI}`}>LexAI</p>
                <div className={styles.messageBubble}>
                  <p className={styles.messageText}>Thinking...</p>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className={styles.chatInputArea}>
            <div className={styles.inputContainer}>
              <div className={styles.inputRow}>
                <button className={styles.addButton}>
                  <span className={`${styles.materialIcon} ${styles.iconMedium}`}>add_circle</span>
                </button>
                <textarea
                  className={styles.textInput}
                  placeholder="Ask about this judgment..."
                  rows={1}
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSendMessage())}
                ></textarea>
                <button
                  className={styles.sendButton}
                  onClick={handleSendMessage}
                  disabled={chatLoading}
                >
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
