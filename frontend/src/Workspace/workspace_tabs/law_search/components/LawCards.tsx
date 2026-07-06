import { useState } from "react";
import styles from "./LawCards.module.css";
import { BookOpen, Lightbulb, ChevronDown, ChevronUp } from "lucide-react";

export interface DiscoveredLaw {
  act_name: string;
  section_no: string;
  chapter_name?: string | null;
  chapter_code?: string | null;
  act_year?: string | null;
  chunk_id?: string;
  law_text: string;
  reasoning: string;
  relevance_score: number;
}

function RelevanceDots({ score }: { score: number }) {
  const clamped = Math.round(Math.min(10, Math.max(0, score)));
  return (
    <div className={styles.dotsRow} title={`Relevance: ${clamped}/10`}>
      {Array.from({ length: 10 }).map((_, i) => (
        <span
          key={i}
          className={`${styles.dot} ${i < clamped ? styles.dotFilled : ""}`}
        />
      ))}
    </div>
  );
}

function LawCard({ law }: { law: DiscoveredLaw }) {
  const [expanded, setExpanded] = useState(false);

  const hasChapter =
    law.chapter_code && law.chapter_code.trim() !== "" &&
    law.chapter_name && law.chapter_name.trim() !== "";

  return (
    <article className={styles.card}>
      {/* ── Top strip: relevance score ── */}
      <div className={styles.relevanceStrip}>
        <span className={styles.relevanceLabel}>Relevance</span>
        <RelevanceDots score={law.relevance_score} />
        <span className={styles.relevanceNumber}>{law.relevance_score}<span className={styles.relevanceOf}>/10</span></span>
      </div>

      {/* ── Primary index: Act name + Section ── */}
      <div className={styles.primaryIndex}>
        <div className={styles.sectionBadge}>§ {law.section_no}</div>
        <h3 className={styles.actName}>{law.act_name}</h3>
      </div>

      {/* ── Tags row ── */}
      <div className={styles.tagRow}>
        {law.act_year && (
          <span className={styles.tag}>
            <span className={styles.tagKey}>Year</span>
            {law.act_year}
          </span>
        )}
        {hasChapter && (
          <>
            <span className={styles.tag}>
              <span className={styles.tagKey}>Ch.</span>
              {law.chapter_code}
            </span>
            <span className={`${styles.tag} ${styles.tagFull}`}>
              {law.chapter_name}
            </span>
          </>
        )}
      </div>

      {/* ── Law text ── */}
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <BookOpen size={12} strokeWidth={2} />
          <span>Law Text</span>
        </div>
        <p className={`${styles.lawText} ${!expanded ? styles.lawTextClamped : ""}`}>
          {law.law_text}
        </p>
      </div>

      {/* ── Reasoning ── */}
      <div className={styles.section}>
        <div className={`${styles.sectionHead} ${styles.sectionHeadReason}`}>
          <Lightbulb size={12} strokeWidth={2} />
          <span>Why Relevant</span>
        </div>
        <p className={styles.reasoningText}>{law.reasoning}</p>
      </div>

      {/* ── Expand / Collapse ── */}
      <button
        className={styles.expandBtn}
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? (
          <><ChevronUp size={13} /> Show less</>
        ) : (
          <><ChevronDown size={13} /> Read full text</>
        )}
      </button>
    </article>
  );
}

interface LawCardsProps {
  laws?: DiscoveredLaw[];
}

export default function LawCards({ laws = [] }: LawCardsProps) {
  if (!laws.length) return null;

  return (
    <div className={styles.wrapper}>
      <div className={styles.rail}>
        <span className={styles.railLabel}>
          {laws.length} law{laws.length !== 1 ? "s" : ""} found
        </span>
      </div>
      <div className={styles.scrollContainer}>
        {laws.map((law, i) => (
          <LawCard key={law.chunk_id ?? i} law={law} />
        ))}
      </div>
    </div>
  );
}
