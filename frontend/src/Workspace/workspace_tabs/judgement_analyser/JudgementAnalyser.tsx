import React, { useState, useEffect, useRef, useMemo,useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import styles from "./JudgementAnalyser.module.css";
import JudgementAiChat from "./JudgementAiChat";
import LoadingLines from "@/components/ui/loading-lines";
import { useAnalysisStore } from "./store/analysisStore";
import type { Highlight, Pin } from "./store/analysisStore";
import { motion, AnimatePresence } from "framer-motion";

import { ReactFlow, Controls, Background, MarkerType } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';

type CaseTask = "facts" | "issues" | "petitioner_args" | "respondent_args" | "law_analysis" | "precedent_analysis" | "court_reasoning" | "conclusion";
type TaskType = CaseTask | "full";
type CitationTab = "judgements" | "laws";

// ── Layout Logic ──
const dagreGraph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));

const getLayoutedElements = (nodes: any[], edges: any[]) => {
  dagreGraph.setGraph({ rankdir: 'LR', nodesep: 30, ranksep: 120 });
  nodes.forEach((node) => dagreGraph.setNode(node.id, { width: 220, height: 60 }));
  edges.forEach((edge) => dagreGraph.setEdge(edge.source, edge.target));
  dagre.layout(dagreGraph);

  const mainNode = nodes.find(n => n.id === 'main');
  const mainPos = mainNode ? (dagreGraph.node(mainNode.id) || { x: 300, y: 300 }) : { x: 300, y: 300 };

  const hasMultipleLayers = nodes.some(n => n.id && typeof n.id === 'string' && (n.id.includes('_l2_') || n.id.includes('_l3_')));
  if (hasMultipleLayers) {
    return {
      nodes: nodes.map((node) => {
        const pos = dagreGraph.node(node.id) || { x: 0, y: 0 };
        return { ...node, position: { x: pos.x, y: pos.y } };
      }),
      edges,
    };
  }

  const cbNodes = nodes.filter(n => n.id && typeof n.id === 'string' && n.id.startsWith('cb_'));
  const rightNodes = nodes.filter(n => n.id && typeof n.id === 'string' && (n.id.startsWith('j_') || n.id.startsWith('l_')));

  const maxPerCol = 8;
  const nodeHeightWithSpacing = 105;
  const colWidthWithSpacing = 300;

  // Position cbNodes (left of main, in columns going backwards from main)
  const cbCols = Math.ceil(cbNodes.length / maxPerCol);
  const cbPositioned = cbNodes.map((node, index) => {
    const colIndex = Math.floor(index / maxPerCol);
    const rowIndex = index % maxPerCol;
    
    // Total nodes in this specific column
    const colSize = colIndex === cbCols - 1 
      ? cbNodes.length - colIndex * maxPerCol 
      : maxPerCol;

    const x = mainPos.x - 300 - (cbCols - 1 - colIndex) * colWidthWithSpacing;
    const y = mainPos.y + (rowIndex - (colSize - 1) / 2) * nodeHeightWithSpacing;
    return { ...node, position: { x, y } };
  });

  // Position rightNodes (right of main, in columns going forwards from main)
  const rightCols = Math.ceil(rightNodes.length / maxPerCol);
  const rightPositioned = rightNodes.map((node, index) => {
    const colIndex = Math.floor(index / maxPerCol);
    const rowIndex = index % maxPerCol;
    
    const colSize = colIndex === rightCols - 1 
      ? rightNodes.length - colIndex * maxPerCol 
      : maxPerCol;

    const x = mainPos.x + 300 + colIndex * colWidthWithSpacing;
    const y = mainPos.y + (rowIndex - (colSize - 1) / 2) * nodeHeightWithSpacing;
    return { ...node, position: { x, y } };
  });

  const positionedNodes = nodes.map(node => {
    if (node.id === 'main') {
      return { ...node, position: { x: mainPos.x, y: mainPos.y } };
    }
    const cbFound = cbPositioned.find(n => n.id === node.id);
    if (cbFound) return cbFound;

    const rightFound = rightPositioned.find(n => n.id === node.id);
    if (rightFound) return rightFound;

    const pos = dagreGraph.node(node.id) || { x: 0, y: 0 };
    return { ...node, position: { x: pos.x, y: pos.y } };
  });

  return {
    nodes: positionedNodes,
    edges,
  };
};

const CitationTree: React.FC<{
  activeTab: CitationTab;
  caseTitle: string;
  citedJudgements?: { docId: string; title: string }[];
  citedLaws?: { docId: string; section_no: string; act_name: string; act_year: number | null; citation_text: string }[];
  citedBy?: { docId: string; title: string }[];
  direction?: "both" | "citing" | "cites";
  layers?: number;
  maxCases?: number;
  hoverHighlight?: boolean;
  showCitesEdge?: boolean;
  showCitedByEdge?: boolean;
}> = ({ 
  activeTab, 
  caseTitle, 
  citedJudgements = [], 
  citedLaws = [], 
  citedBy = [],
  direction = "both",
  layers = 1,
  maxCases = 50,
  hoverHighlight = true,
  showCitesEdge = true,
  showCitedByEdge = true
}) => {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const reactFlowInstanceRef = useRef<any>(null);
  const navigate = useNavigate();

  // Stable event handlers to avoid re-binding listeners
  const handleNodeMouseEnter = useCallback((_: any, node: any) => {
    setHoveredNodeId(node.id);
  }, []);

  const handleNodeMouseLeave = useCallback(() => {
    setHoveredNodeId(null);
  }, []);

  const onInit = useCallback((instance: any) => {
    reactFlowInstanceRef.current = instance;
    instance.fitView({ padding: 0.2 });
  }, []);

  const onNodeClick = useCallback(( node: any) => {
    const docId = node.data?.docId;
    if (docId) {
      console.log(`[GRAPH CLICK] Loading document with docId: ${docId}`);
      navigate(`/workspace/${docId}`);
    }
  }, [navigate]);

  // 1. Calculate Layouted Nodes and Edges once (does not run on mouse hover)
  const layoutedData = useMemo(() => {
    // Filter lists by direction setting
    let filteredCitedBy = direction === 'cites' ? [] : citedBy;
    let filteredCitedJudgements = direction === 'citing' ? [] : citedJudgements;
    let filteredCitedLaws = direction === 'citing' ? [] : citedLaws;

    // Apply max cases limit overall
    if (activeTab === 'judgements') {
      const totalAvailable = filteredCitedBy.length + filteredCitedJudgements.length;
      if (totalAvailable > maxCases) {
        const limitCb = Math.min(filteredCitedBy.length, Math.ceil(maxCases / 2));
        const limitCj = maxCases - limitCb;
        filteredCitedBy = filteredCitedBy.slice(0, limitCb);
        filteredCitedJudgements = filteredCitedJudgements.slice(0, limitCj);
      }
    } else {
      filteredCitedLaws = filteredCitedLaws.slice(0, maxCases);
    }

    const rawNodes: { id: string; label: string; docId?: string; isCitedBy?: boolean; parentId?: string }[] = [
      { id: 'main', label: caseTitle },
    ];

    if (activeTab === 'judgements') {
      filteredCitedBy.forEach((cb, idx) => {
        const nodeId = cb.docId ? `cb_${cb.docId}_${idx}` : `cb_${idx}`;
        rawNodes.push({ id: nodeId, label: cb.title, docId: cb.docId, isCitedBy: true });
        
        if (layers >= 2) {
          const l2Id = `cb_l2_${nodeId}`;
          rawNodes.push({ id: l2Id, label: `Citing Case ${idx + 1}.1`, docId: cb.docId, isCitedBy: true, parentId: nodeId });
          if (layers >= 3) {
            rawNodes.push({ id: `cb_l3_${nodeId}`, label: `Citing Case ${idx + 1}.1.1`, docId: cb.docId, isCitedBy: true, parentId: l2Id });
          }
        }
      });
      filteredCitedJudgements.forEach((j, idx) => {
        const nodeId = j.docId ? `j_${j.docId}_${idx}` : `j_${idx}`;
        rawNodes.push({ id: nodeId, label: j.title, docId: j.docId });
        
        if (layers >= 2) {
          const l2Id = `j_l2_${nodeId}`;
          rawNodes.push({ id: l2Id, label: `Precedent Case ${idx + 1}.1`, docId: j.docId, parentId: nodeId });
          if (layers >= 3) {
            rawNodes.push({ id: `j_l3_${nodeId}`, label: `Precedent Case ${idx + 1}.1.1`, docId: j.docId, parentId: l2Id });
          }
        }
      });
    } else {
      filteredCitedLaws.forEach((l, idx) => {
        const nodeId = l.docId ? `l_${l.docId}_${idx}` : `l_${idx}`;
        rawNodes.push({ id: nodeId, label: l.citation_text || l.act_name || `Law ${idx + 1}`, docId: l.docId });
      });
    }

    const rawEdges: any[] = [];
    rawNodes.slice(1).forEach((n) => {
      const source = n.parentId 
        ? (n.isCitedBy ? n.id : n.parentId)
        : (n.isCitedBy ? n.id : 'main');
      const target = n.parentId
        ? (n.isCitedBy ? n.parentId : n.id)
        : (n.isCitedBy ? 'main' : n.id);

      const isCitesEdge = !n.isCitedBy;
      const isCitedByEdge = n.isCitedBy;
      
      if (isCitesEdge && !showCitesEdge) return;
      if (isCitedByEdge && !showCitedByEdge) return;

      const edgeColor = n.isCitedBy ? '#10b981' : '#3b82f6';

      rawEdges.push({
        id: `e_${n.id}`,
        source,
        target,
        type: 'bezier',
        animated: false,
        style: { stroke: edgeColor, strokeWidth: 2, opacity: 0.7 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: edgeColor,
          width: 12,
          height: 12
        }
      });
    });

    return getLayoutedElements(
      rawNodes.map(n => {
        const isMain = n.id === 'main';
        const isCitedBy = n.isCitedBy;

        return {
          id: n.id,
          data: { label: n.label, docId: n.docId },
          sourcePosition: 'right' as any,
          targetPosition: 'left' as any,
          style: {
            background: isMain
              ? 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)'
              : isCitedBy
                ? '#f0fdf4'
                : '#ffffff',
            color: isMain ? '#ffffff' : '#0f172a',
            border: isMain
              ? 'none'
              : isCitedBy
                ? '1px solid #86efac'
                : '1px solid #cbd5e1',
            borderRadius: '8px',
            padding: '8px 12px',
            width: 220,
            fontSize: '11px',
            fontWeight: isMain ? '600' : '500',
            boxShadow: isMain
              ? '0 4px 12px rgba(59, 130, 246, 0.25)'
              : '0 2px 4px rgba(0, 0, 0, 0.05)',
            textAlign: 'center' as const,
            wordBreak: 'break-word' as const,
            whiteSpace: 'normal' as const,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '60px',
            lineHeight: '1.3',
            fontFamily: 'inherit',
            opacity: 1,
            outline: 'none',
            cursor: isMain ? 'default' : 'pointer'
          }
        };
      }),
      rawEdges
    );
  }, [activeTab, caseTitle, citedJudgements, citedLaws, citedBy, direction, layers, maxCases, showCitesEdge, showCitedByEdge]);

  // Refit the view only when layout or data changes, not on hover
  useEffect(() => {
    if (reactFlowInstanceRef.current) {
      const timer = setTimeout(() => {
        reactFlowInstanceRef.current.fitView({ padding: 0.2, duration: 150 });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [layoutedData]);

  // Inject dynamic CSS rules for mouse hover highlighting to prevent React Flow re-renders
  const hoverHighlightCss = useMemo(() => {
    if (!hoverHighlight || !hoveredNodeId) return "";
    return `
      /* Dim other nodes */
      .react-flow__node {
        opacity: 0.35 !important;
        transition: opacity 0.15s ease !important;
      }
      /* Highlight hovered node */
      .react-flow__node[data-id="${hoveredNodeId}"] {
        opacity: 1 !important;
        outline: 2px solid #f59e0b !important;
      }
      /* Dim all edges */
      .react-flow__edge-path {
        opacity: 0.15 !important;
        stroke: #cbd5e1 !important;
        stroke-width: 2px !important;
        transition: opacity 0.15s ease !important;
      }
      /* Highlight direct source/target paths & markers */
      .react-flow__edge[data-source="${hoveredNodeId}"] .react-flow__edge-path,
      .react-flow__edge[data-target="${hoveredNodeId}"] .react-flow__edge-path {
        opacity: 1 !important;
        stroke: #f59e0b !important;
        stroke-width: 3px !important;
      }
      .react-flow__edge[data-source="${hoveredNodeId}"] path,
      .react-flow__edge[data-target="${hoveredNodeId}"] path {
        stroke: #f59e0b !important;
        fill: #f59e0b !important;
      }
    `;
  }, [hoveredNodeId, hoverHighlight]);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      {/* Inject custom styling rules dynamically on hover */}
      {hoverHighlightCss && <style dangerouslySetInnerHTML={{ __html: hoverHighlightCss }} />}
      <ReactFlow 
        nodes={layoutedData.nodes} 
        edges={layoutedData.edges}
        onInit={onInit}
        onNodeMouseEnter={hoverHighlight ? handleNodeMouseEnter : undefined}
        onNodeMouseLeave={hoverHighlight ? handleNodeMouseLeave : undefined}
        onNodeClick={onNodeClick}
      >
        <Background gap={16} size={1} color="#e2e8f0" />
        <Controls />
      </ReactFlow>
    </div>
  );
};

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

const applyHighlightsToDoc = (doc: Document, highlights: Highlight[]) => {
  highlights.forEach(h => {
    const el = doc.getElementById(h.paraKey);
    if (!el) return;

    const startOffset = h.offset;
    const endOffset = h.offset + h.text.length;

    let currentTextOffset = 0;
    const textNodes: { node: Text, start: number, end: number }[] = [];

    const walk = (node: Node) => {
      if (node.nodeType === 3) {
        const textNode = node as Text;
        const len = textNode.nodeValue?.length || 0;
        textNodes.push({
          node: textNode,
          start: currentTextOffset,
          end: currentTextOffset + len
        });
        currentTextOffset += len;
      } else {
        for (let i = 0; i < node.childNodes.length; i++) {
          walk(node.childNodes[i]);
        }
      }
    };
    walk(el);

    const nodesToHighlight = textNodes.filter(tn => tn.end > startOffset && tn.start < endOffset);

    nodesToHighlight.forEach((tn) => {
      const nodeStart = Math.max(startOffset - tn.start, 0);
      const nodeEnd = Math.min(endOffset - tn.start, tn.node.nodeValue?.length || 0);

      const val = tn.node.nodeValue || "";
      const beforeText = val.substring(0, nodeStart);
      const highlightedText = val.substring(nodeStart, nodeEnd);
      const afterText = val.substring(nodeEnd);

      const mark = doc.createElement('mark');
      mark.style.backgroundColor = h.color;
      mark.style.borderRadius = '2px';
      mark.style.padding = '0 2px';
      mark.textContent = highlightedText;

      const parent = tn.node.parentNode;
      if (parent) {
        if (afterText) {
          const afterNode = doc.createTextNode(afterText);
          parent.insertBefore(afterNode, tn.node.nextSibling);
        }
        parent.insertBefore(mark, tn.node.nextSibling);
        if (beforeText) {
          tn.node.nodeValue = beforeText;
        } else {
          parent.removeChild(tn.node);
        }
      }
    });
  });
};

const clearHighlightsInDoc = (doc: Document) => {
  const marks = Array.from(doc.querySelectorAll("mark"));
  marks.forEach(mark => {
    const parent = mark.parentNode;
    if (parent) {
      const textNode = doc.createTextNode(mark.textContent || "");
      parent.insertBefore(textNode, mark);
      parent.removeChild(mark);
      parent.normalize();
    }
  });
};

const getFilteredHtmlContent = (html: string, task: TaskType): string => {
  if (task === "full") return html;

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const expectedTitle = taskToMongoType[task as CaseTask];
  const judgmentsContainer = doc.querySelector('.judgments') || doc.body;
  const children = Array.from(judgmentsContainer.children);

  children.forEach(child => {
    const titleAttr = child.getAttribute('title');
    if (titleAttr !== expectedTitle) {
      child.remove();
    }
  });

  return doc.documentElement.outerHTML;
};

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
  htmlContent?: string;
  htmlSource?: string;
  source?: {
    docId: string;
  };
  cited_judgements?: { docId: string; title: string }[];
  cited_laws?: { docId: string; section_no: string; act_name: string; act_year: number | null; citation_text: string }[];
  cited_by?: { docId: string; title: string }[];
}

const renderFormattedTitle = (title: string) => {
  const dateMatch = title.match(/\s+on\s+(\d{1,2}\s+\w+,?\s+\d{4})$/i);
  const titleWithoutDate = dateMatch ? title.substring(0, dateMatch.index).trim() : title;
  const dateSuffix = dateMatch ? dateMatch[1] : null;

  const vsMatch = titleWithoutDate.match(/^(.*?)\s+\b(vs\.?|v\\.?|versus)\b\s+(.*)$/i);
  if (vsMatch) {
    const [, petitioner, , respondent] = vsMatch;
    return (
      <div className={styles.caseCaption}>
        <div className={styles.captionPartyBlock}>
          <span className={styles.captionLabel}>Petitioner</span>
          <h1 className={styles.captionPartyName}>{petitioner}</h1>
        </div>
        <div className={styles.captionVsRow}>
          <div className={styles.captionVsLine} />
          <span className={styles.captionVsText}>vs.</span>
          <div className={styles.captionVsLine} />
        </div>
        <div className={styles.captionPartyBlock}>
          <span className={styles.captionLabel}>Respondent</span>
          <h1 className={styles.captionPartyName}>{respondent}</h1>
        </div>
        {dateSuffix && (
          <div className={styles.captionDateRow}>
            <span className={styles.captionDateText}>Decided on {dateSuffix}</span>
          </div>
        )}
      </div>
    );
  }
  return <h1 className={styles.title}>{title}</h1>;
};


const JudgementAnalyser: React.FC = () => {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const [activeTask, setActiveTask] = useState<TaskType>("full");
  const [loading, setLoading] = useState(false);
  const [caseData, setCaseData] = useState<CaseDoc | null>(null);
  //unused state
  // const [judgementText, setJudgementText] = useState("");
  const [selectionMenu, setSelectionMenu] = useState<{ x: number; y: number; text: string; paraKey?: string; offset?: number } | null>(null);

  const { updateCase, cases } = useAnalysisStore();
  const currentCase = cases[caseId || ""] || { highlights: [], pins: [], messages: [] };
  const highlights = currentCase.highlights;
  const pins = currentCase.pins;

  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);
  const [currentHighlightIndices, setCurrentHighlightIndices] = useState<Record<string, number>>({});
  const mainRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Modal Drag States
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatPosition, setChatPosition] = useState({ x: window.innerWidth - 450, y: 100 });
  const [isDraggingChat, setIsDraggingChat] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; initialX: number; initialY: number } | null>(null);

  const [activeCitationTab, setActiveCitationTab] = useState<CitationTab>("judgements");
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // Settings & Relation Modals State (Dynamic Island)
  const [islandActiveTab, setIslandActiveTab] = useState<"settings" | "relations" | null>(null);
  const [direction, setDirection] = useState<"both" | "citing" | "cites">("both");
  const [layers, setLayers] = useState(1);
  const [maxCases, setMaxCases] = useState(50);
  const [hoverHighlight, setHoverHighlight] = useState(true);
  const [showCitesEdge, setShowCitesEdge] = useState(true);
  const [showCitedByEdge, setShowCitedByEdge] = useState(true);
  // Drag logic for Chat Modal
  const handleChatMouseDown = (e: React.MouseEvent) => {
    setIsDraggingChat(true);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: chatPosition.x,
      initialY: chatPosition.y,
    };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingChat || !dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setChatPosition({
        x: dragRef.current.initialX + dx,
        y: Math.max(0, dragRef.current.initialY + dy),
      });
    };
    const handleMouseUp = () => setIsDraggingChat(false);

    if (isDraggingChat) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDraggingChat]);

  const handleIframeLoad = () => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;

    if (!doc.getElementById('iframe-highlight-styles')) {
      const style = doc.createElement('style');
      style.id = 'iframe-highlight-styles';
      style.textContent = `
        @keyframes iframePulseHighlight {
          0% { background-color: rgba(254, 240, 138, 0); }
          15% { background-color: rgba(254, 240, 138, 0.8); }
          85% { background-color: rgba(254, 240, 138, 0.8); }
          100% { background-color: rgba(254, 240, 138, 0); }
        }
        .iframe-temp-highlight {
          animation: iframePulseHighlight 2.5s ease-out;
          position: relative;
          border-radius: 4px;
        }
      `;
      doc.head.appendChild(style);
    }

    const handleIframeSelection = () => {
      const selection = iframe.contentWindow?.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) {
        setSelectionMenu(null);
        return;
      }

      const text = selection.toString().trim();
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const iframeRect = iframe.getBoundingClientRect();

      const startPara = range.startContainer.nodeType === 1
        ? (range.startContainer as HTMLElement).closest('p, blockquote, pre')
        : range.startContainer.parentElement?.closest('p, blockquote, pre');
      const endPara = range.endContainer.nodeType === 1
        ? (range.endContainer as HTMLElement).closest('p, blockquote, pre')
        : range.endContainer.parentElement?.closest('p, blockquote, pre');

      let paraKey: string | undefined;
      let offset: number | undefined;

      if (startPara && startPara === endPara && startPara.id) {
        paraKey = startPara.id;
        const preRange = doc.createRange();
        preRange.selectNodeContents(startPara);
        preRange.setEnd(range.startContainer, range.startOffset);
        offset = preRange.toString().length;
      }

      if (paraKey && offset !== undefined) {
        setSelectionMenu({
          x: iframeRect.left + rect.left + rect.width / 2,
          y: iframeRect.top + rect.top,
          text,
          paraKey,
          offset
        });
      }
    };

    doc.addEventListener("selectionchange", handleIframeSelection);

    const handleIframeClick = () => {
      const selection = iframe.contentWindow?.getSelection();
      if (!selection || selection.isCollapsed) {
        setSelectionMenu(null);
      }
    };
    doc.addEventListener("mousedown", handleIframeClick);

    if (highlights && highlights.length > 0) {
      applyHighlightsToDoc(doc, highlights);
    }
  };

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;

    clearHighlightsInDoc(doc);
    if (highlights && highlights.length > 0) {
      applyHighlightsToDoc(doc, highlights);
    }
  }, [highlights]);

  const navigateByColor = (color: string, direction: 'next' | 'prev') => {
    const iframe = iframeRef.current;
    const isIframeActive = !!(iframe && iframe.contentDocument && iframe.contentWindow);
    const doc = isIframeActive ? iframe.contentDocument! : document;

    const colorHighlights = highlights
      .filter(h => h.color === color)
      .sort((a, b) => {
        const elA = doc.getElementById(a.paraKey) || doc.querySelector(`[data-para-key="${a.paraKey}"]`);
        const elB = doc.getElementById(b.paraKey) || doc.querySelector(`[data-para-key="${b.paraKey}"]`);

        if (elA && elB) {
          if (elA === elB) {
            return a.offset - b.offset;
          }
          const position = elA.compareDocumentPosition(elB);
          if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
            return -1;
          }
          if (position & Node.DOCUMENT_POSITION_PRECEDING) {
            return 1;
          }
        }

        const getNumericParts = (key: string) => {
          const matches = key.match(/\d+/g);
          return matches ? matches.map(Number) : [];
        };

        const aParts = getNumericParts(a.paraKey);
        const bParts = getNumericParts(b.paraKey);

        for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
          if (aParts[i] !== bParts[i]) {
            return aParts[i] - bParts[i];
          }
        }

        if (aParts.length !== bParts.length) {
          return aParts.length - bParts.length;
        }

        return a.paraKey.localeCompare(b.paraKey) || a.offset - b.offset;
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

    const element = (doc.getElementById(target.paraKey) || doc.querySelector(`[data-para-key="${target.paraKey}"]`)) as HTMLElement | null;
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });

      const originalOutline = element.style.outline;
      const originalOutlineOffset = element.style.outlineOffset;
      element.style.outline = `2px solid ${color}`;
      element.style.outlineOffset = '2px';
      setTimeout(() => {
        if (element) {
          element.style.outline = originalOutline;
          element.style.outlineOffset = originalOutlineOffset;
        }
      }, 1500);
    }
  };

  const addHighlight = (color: string) => {
    const iframe = iframeRef.current;
    const isIframeActive = !!(iframe && iframe.contentDocument && iframe.contentWindow);
    const win = isIframeActive ? iframe.contentWindow : window;
    const doc = isIframeActive ? iframe.contentDocument : document;

    const selection = win.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);

    if (isIframeActive) {
      if (selectionMenu?.paraKey && selectionMenu?.offset !== undefined) {
        const newHighlight: Highlight = {
          id: `${Date.now()}-${Math.random()}`,
          text: selectionMenu.text,
          color,
          paraKey: selectionMenu.paraKey,
          offset: selectionMenu.offset
        };
        updateCase(caseId || "", { highlights: [...highlights, newHighlight] });
      }
    } else {
      const container = doc.querySelector(`.${styles.judgmentSection}`);
      if (!container) return;

      const allParas = Array.from(container.querySelectorAll('p[data-para-key]')) as HTMLElement[];
      const newHighlights: Highlight[] = [];

      allParas.forEach(para => {
        if (selection.containsNode(para, true)) {
          const paraKey = para.getAttribute('data-para-key')!;
          let startOffset = 0;
          let endOffset = para.textContent?.length || 0;

          if (para.contains(range.startContainer)) {
            const preRange = doc.createRange();
            preRange.selectNodeContents(para);
            preRange.setEnd(range.startContainer, range.startOffset);
            startOffset = preRange.toString().length;
          }

          if (para.contains(range.endContainer)) {
            const preRange = doc.createRange();
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
        updateCase(caseId || "", { highlights: [...highlights, ...newHighlights] });
      }
    }

    setSelectionMenu(null);
    selection.removeAllRanges();
  };

  const removeHighlightByParaKey = (paraKey: string, offset: number) => {
    updateCase(caseId || "", {
      highlights: highlights.filter(h => !(h.paraKey === paraKey && h.offset === offset))
    });
    setSelectionMenu(null);
  };

  const renderTextWithHighlights = (text: string, paraKey: string) => {
    if (!highlights.length) return text;

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

  useEffect(() => {
    if (caseId) {
      fetchCaseDetails(caseId);
    } else {
      fetchCaseDetails("69c1370e5b49900fda48a5fb");
    }
  }, [caseId]);

  const navigateToPin = (id: string, fullText: string, paraKey?: string) => {
    const iframe = iframeRef.current;
    const iframeDoc = iframe?.contentDocument || iframe?.contentWindow?.document;
    const doc = iframeDoc || document;

    const foundElement = paraKey
      ? (doc.getElementById(paraKey) as HTMLElement | null || doc.querySelector(`[data-para-key="${paraKey}"]`) as HTMLElement | null)
      : (() => {
        const selector = iframeDoc ? 'p, blockquote, pre' : '[data-para-key]';
        for (const el of Array.from(doc.querySelectorAll(selector)) as HTMLElement[]) {
          if (el.textContent?.includes(fullText)) return el;
        }
        return null;
      })();

    if (foundElement) {
      foundElement.scrollIntoView({ behavior: "smooth", block: "center" });
      setActiveHighlightId(id);

      const highlightClass = iframeDoc ? "iframe-temp-highlight" : styles.temporaryHighlight;
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
        const iframe = iframeRef.current;
        const iframeSelection = iframe?.contentWindow?.getSelection();
        if (iframeSelection && !iframeSelection.isCollapsed && iframeSelection.toString().trim()) {
          return;
        }
        setSelectionMenu(null);
        return;
      }

      const text = selection.toString().trim();
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      const container = document.querySelector(`.${styles.judgmentSection}`);
      const commonAncestor = range.commonAncestorContainer;

      if (container && container.contains(commonAncestor)) {
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
    const newPin: Pin = {
      id: Date.now().toString(),
      text: text.length > 50 ? text.substring(0, 50) + "..." : text,
      fullText: text,
      paraKey: selectionMenu?.paraKey,
    };
    updateCase(caseId || "", { pins: [...pins, newPin] });
    setSelectionMenu(null);
    window.getSelection()?.removeAllRanges();
    iframeRef.current?.contentWindow?.getSelection()?.removeAllRanges();
  };

  const removePin = (id: string) => {
    updateCase(caseId || "", { pins: pins.filter(p => p.id !== id) });
  };

  const fetchCaseDetails = async (id: string) => {
    try {
      setLoading(true);
      const res = await fetch(`/api/judgements/${id}`);
      if (!res.ok) throw new Error("Failed to fetch judgment");
      const data = await res.json();
      setCaseData(data);
      console.log(`[VERIFICATION] Judgment Loaded: "${data.title}" | HTML Source: ${data.htmlSource || (data.htmlContent ? "mongodb" : "fallback_text")}`);
      const targetUrlId = data.source?.docId || data._id;
      if (id !== targetUrlId && navigate) {
        navigate(`/workspace/${targetUrlId}`, { replace: true });
      }
    } catch (err) {
      console.error("Error fetching judgment details:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const handleIframeMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === "LOAD_JUDGEMENT_BY_DOC_ID") {
        const docId = event.data.docId;
        console.log("Loading judgment by docId:", docId);
        if (navigate) {
          navigate(`/workspace/${docId}`);
        } else {
          fetchCaseDetails(docId);
        }
      }
    };

    window.addEventListener("message", handleIframeMessage);
    return () => {
      window.removeEventListener("message", handleIframeMessage);
    };
  }, [navigate]);

  useEffect(() => {
    if (caseData && caseData.texts) {
      if (activeTask === "full") {
        
        // setJudgementText(caseData.texts.map(t => t.content).join("\n\n"));
      } else {
        // const targetType = taskToMongoType[activeTask as CaseTask];
        // const filtered = caseData.texts.filter(t => t.type === targetType);
        // const content = filtered.length > 0
        //   ? filtered.map(t => t.content).join("\n\n")
        //   : "";
        
        // setJudgementText(content);
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
                <LoadingLines />
              </div>
            )}

            <div style={{ height: '2rem' }} />

            {caseData ? (
              <div className={styles.originalJudgement}>
                <div className={styles.caseHeader}>
                  {renderFormattedTitle(caseData.title)}

                  <div className={styles.caseMetaGrid}>
                    <div className={styles.caseMetaItem}>
                      <span className={styles.caseMetaLabel}>Court</span>
                      <span className={styles.caseMetaValue}>{caseData.judgement_type || "Supreme Court of India"}</span>
                    </div>
                    <div className={styles.caseMetaDivider} />
                    <div className={styles.caseMetaItem}>
                      <span className={styles.caseMetaLabel}>Year</span>
                      <span className={styles.caseMetaValue}>{caseData.year}</span>
                    </div>
                    <div className={styles.caseMetaDivider} />
                    <div className={styles.caseMetaItem}>
                      <span className={styles.caseMetaLabel}>Bench</span>
                      <span className={styles.caseMetaValue}>
                        {caseData.bench && caseData.bench.length > 0 ? caseData.bench.join(", ") : "Not specified"}
                      </span>
                    </div>
                    {caseData.createdAt && (
                      <>
                        <div className={styles.caseMetaDivider} />
                        <div className={styles.caseMetaItem}>
                          <span className={styles.caseMetaLabel}>Filed</span>
                          <span className={styles.caseMetaValue}>
                            {new Date(caseData.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className={styles.judgmentText}>
                  {caseData.htmlContent ? (
                    <iframe
                      ref={iframeRef}
                      onLoad={handleIframeLoad}
                      srcDoc={getFilteredHtmlContent(caseData.htmlContent, activeTask)}
                      title={activeTask === "full" ? "Full Judgement" : activeTask}
                      style={{
                        width: "100%",
                        height: "calc(100vh - 250px)",
                        border: "none",
                        borderRadius: "8px",
                        backgroundColor: "#ffffff"
                      }}
                    />
                  ) : (activeTask === "full" ? caseData.texts : caseData.texts.filter(t => t.type === taskToMongoType[activeTask as CaseTask])).length > 0 ? (
                    (activeTask === "full" ? caseData.texts : caseData.texts.filter(t => t.type === taskToMongoType[activeTask as CaseTask]))
                      .map((t, idx) => (
                        <React.Fragment key={idx}>
                          {t.content
                            .split(/(\n|(?<=\S)\s+(?=\([a-z\d]+\)|[a-z]\.|\([ivx]+\)|[ivx]+\.))/)
                            .map((line, lineIdx) => {
                              const trimmed = line.trim();
                              if (!trimmed || line === '\n') return null;

                              const paraKey = `${idx}-${lineIdx}`;

                              if (/^(\d+\.|\u00b6\s*\d+)/.test(trimmed)) {
                                return <p key={lineIdx} data-para-key={paraKey} className={styles.para}>{renderTextWithHighlights(line, paraKey)}</p>;
                              }

                              if (/^(\([a-z\d]+\)|[a-z]\.|\([ivx]+\)|[ivx]+\.)/i.test(trimmed)) {
                                return <p key={lineIdx} data-para-key={paraKey} className={styles.listItem}>{renderTextWithHighlights(line, paraKey)}</p>;
                              }

                              if (line.startsWith('    ') || line.startsWith('\t')) {
                                return <p key={lineIdx} data-para-key={paraKey} className={styles.subListItem}>{renderTextWithHighlights(line, paraKey)}</p>;
                              }

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

        {/* Vertical Highlight Navigator in the gutter - ALWAYS VISIBLE */}
        <div className={styles.gutterToolbar}>
          <div className={styles.gutterHeader} title="Tools">
            <span className={`${styles.materialIcon} ${styles.iconSmall}`}>auto_awesome</span>
          </div>
          <div className={styles.gutterContent}>

            {/* AI Chat Button */}
            <div className={styles.gutterGroup}>
              <button
                ref={buttonRef}
                onClick={(e) => {
                  // Capture the button's position
                  const rect = e.currentTarget.getBoundingClientRect();
                  setButtonRect(rect);
                  setIsChatOpen(!isChatOpen);
                }}
                className={`${styles.gutterArrow} ${isChatOpen ? styles.gutterArrowActive : ''}`}
                title="AI Chat"
              >
                <span className={styles.materialIcon}>forum</span>
              </button>
            </div>

            {/* Divider if highlights exist */}
            {highlights.length > 0 && <div className={styles.gutterDivider} />}

            {/* Highlight Iterators */}
            {highlights.length > 0 && Object.entries(
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

        {/* ── Right Citation Panel with Tabs ── */}
        <aside className={styles.citationAside}>
          <div className={styles.citationHeader}>
            <div style={{ display: 'flex', flex: 1, height: '100%' }}>
              <button
                className={`${styles.citationTab} ${activeCitationTab === 'judgements' ? styles.citationTabActive : ''}`}
                onClick={() => setActiveCitationTab('judgements')}
              >
                Judgement Citations
              </button>
              <button
                className={`${styles.citationTab} ${activeCitationTab === 'laws' ? styles.citationTabActive : ''}`}
                onClick={() => setActiveCitationTab('laws')}
              >
                Law Citations
              </button>
            </div>
            <button
              onClick={() => setIsFullscreen(true)}
              className={styles.fullscreenToggle}
              title="View Fullscreen"
            >
              <span className={styles.materialIcon}>fullscreen</span>
            </button>
          </div>
          <div className={styles.citationContent}>
            <CitationTree 
              activeTab={activeCitationTab} 
              caseTitle={caseData?.title || "Current Case"} 
              citedJudgements={caseData?.cited_judgements}
              citedLaws={caseData?.cited_laws}
              citedBy={caseData?.cited_by}
            />
          </div>
        </aside>

        <AnimatePresence>
          {isChatOpen && buttonRect && (
            <motion.div
              initial={{ scale: 0, opacity: 0, transformOrigin: "left" }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{
                type: "spring",
                damping: 25,
                stiffness: 300,
                mass: 0.8
              }}
              className={styles.chatModal}
              style={{
                left: `${chatPosition.x}px`,
                top: `${chatPosition.y}px`
              }}
            >
              <div
                className={styles.chatModalHeader}
                onMouseDown={handleChatMouseDown}
              >
                <div className={styles.chatModalDragHandle}>
                  <span className={`${styles.materialIcon} ${styles.iconSmall}`}>drag_indicator</span>
                  <span className={styles.chatTitle}>LEXPAL AI</span>
                </div>
                <button
                  onClick={() => setIsChatOpen(false)}
                  className={styles.chatModalCloseBtn}
                >
                  <span className={styles.materialIcon}>close</span>
                </button>
              </div>
              <div className={styles.chatModalBody}>
                <JudgementAiChat caseId={caseId || ""} htmlContent={caseData?.htmlContent || ""} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {/* Draggable Chat Modal */}

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

      {isFullscreen && (
        <div className={styles.fullscreenOverlay}>
          <div className={styles.fullscreenHeader}>
            <div className={styles.fullscreenTitle}>
              Citation Network - {caseData?.title || "Current Case"}
            </div>
            <div className={styles.fullscreenTabs}>
              <button
                className={`${styles.fullscreenTab} ${activeCitationTab === 'judgements' ? styles.fullscreenTabActive : ''}`}
                onClick={() => setActiveCitationTab('judgements')}
              >
                Judgement Citations
              </button>
              <button
                className={`${styles.fullscreenTab} ${activeCitationTab === 'laws' ? styles.fullscreenTabActive : ''}`}
                onClick={() => setActiveCitationTab('laws')}
              >
                Law Citations
              </button>
            </div>
            <button
              onClick={() => setIsFullscreen(false)}
              className={styles.fullscreenClose}
              title="Close Fullscreen"
            >
              <span className={styles.materialIcon}>close</span>
            </button>
          </div>
          <div className={styles.fullscreenBody} style={{ position: 'relative' }}>
            {/* Dynamic Island Control Center */}
            <div 
              className={`${styles.dynamicIsland} ${islandActiveTab ? styles.dynamicIslandExpanded : ''}`}
              style={{
                position: 'absolute',
                top: '16px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 1000
              }}
            >
              {/* Collapsed Pill Row */}
              <div className={styles.islandHeaderRow}>
                <button
                  onClick={() => setIslandActiveTab(islandActiveTab === 'settings' ? null : 'settings')}
                  className={`${styles.islandTabBtn} ${islandActiveTab === 'settings' ? styles.islandTabBtnActive : ''}`}
                >
                  <span className={styles.materialIcon}>settings</span>
                  {!islandActiveTab && <span>Settings</span>}
                </button>
                
                {islandActiveTab && (
                  <div className={styles.islandDivider} />
                )}

                <button
                  onClick={() => setIslandActiveTab(islandActiveTab === 'relations' ? null : 'relations')}
                  className={`${styles.islandTabBtn} ${islandActiveTab === 'relations' ? styles.islandTabBtnActive : ''}`}
                >
                  <span className={styles.materialIcon}>bubble_chart</span>
                  {!islandActiveTab && <span>Relation Type</span>}
                </button>

                {islandActiveTab && (
                  <>
                    <div className={styles.islandDivider} />
                    <button 
                      onClick={() => setIslandActiveTab(null)} 
                      className={styles.islandCloseBtn}
                      title="Collapse Island"
                    >
                      <span className={styles.materialIcon}>keyboard_arrow_up</span>
                    </button>
                  </>
                )}
              </div>

              {/* Expanded Body Content */}
              {islandActiveTab === 'settings' && (
                <div className={styles.islandBody}>
                  {/* Direction Selector */}
                  <div className={styles.islandFormGroup}>
                    <label>Direction</label>
                    <select 
                      value={direction} 
                      onChange={(e) => setDirection(e.target.value as any)}
                      className={styles.islandSelect}
                    >
                      <option value="both">Both Directions</option>
                      <option value="citing">Cases Citing This (Incoming)</option>
                      <option value="cites">Cases This Cites (Outgoing)</option>
                    </select>
                  </div>
                  
                  {/* Citation Layer Slider */}
                  <div className={styles.islandFormGroup}>
                    <label>Citation Layer: {layers}</label>
                    <input 
                      type="range" 
                      min="1" 
                      max="3" 
                      value={layers} 
                      onChange={(e) => setLayers(Number(e.target.value))}
                      className={styles.islandSlider}
                    />
                    <div className={styles.islandSliderTicks}>
                      <span>1</span>
                      <span>2</span>
                      <span>3</span>
                    </div>
                  </div>
                  
                  {/* Max Cases Slider */}
                  <div className={styles.islandFormGroup}>
                    <label>Max Cases: {maxCases}</label>
                    <input 
                      type="range" 
                      min="10" 
                      max="100" 
                      step="10"
                      value={maxCases} 
                      onChange={(e) => setMaxCases(Number(e.target.value))}
                      className={styles.islandSlider}
                    />
                    <div className={styles.islandSliderTicks}>
                      <span>10</span>
                      <span>50</span>
                      <span>100</span>
                    </div>
                  </div>
                </div>
              )}

              {islandActiveTab === 'relations' && (
                <div className={styles.islandBody}>
                  {/* Hover Highlight Toggle */}
                  <label className={styles.islandCheckboxLabel}>
                    <input 
                      type="checkbox" 
                      checked={hoverHighlight} 
                      onChange={(e) => setHoverHighlight(e.target.checked)}
                    />
                    <span>Hover lines for details</span>
                  </label>
                  
                  {/* Cites Toggle */}
                  <label className={styles.islandCheckboxLabel}>
                    <input 
                      type="checkbox" 
                      checked={showCitesEdge} 
                      onChange={(e) => setShowCitesEdge(e.target.checked)}
                    />
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#3b82f6' }}></span>
                      Cites
                    </span>
                  </label>

                  {/* Cited By Toggle */}
                  <label className={styles.islandCheckboxLabel}>
                    <input 
                      type="checkbox" 
                      checked={showCitedByEdge} 
                      onChange={(e) => setShowCitedByEdge(e.target.checked)}
                    />
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#10b981' }}></span>
                      Cited by
                    </span>
                  </label>

                  <div className={styles.islandDividerLine}>Exports & Actions</div>
                  
                  {/* Export Buttons */}
                  <div className={styles.islandExportGrid}>
                    <button 
                      onClick={() => {
                        const headers = ["Type", "Document ID", "Title"];
                        const rows = [
                          ...(caseData?.cited_by || []).map(cb => ["Cited By", cb.docId, cb.title]),
                          ...(caseData?.cited_judgements || []).map(j => ["Cites (Judgment)", j.docId, j.title]),
                          ...(caseData?.cited_laws || []).map(l => ["Cites (Law)", l.docId, l.citation_text || l.act_name])
                        ];
                        const csvContent = "data:text/csv;charset=utf-8," 
                          + [headers.join(","), ...rows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(","))].join("\n");
                        const encodedUri = encodeURI(csvContent);
                        const link = document.createElement("a");
                        link.setAttribute("href", encodedUri);
                        link.setAttribute("download", `citation_network_${(caseData?.title || 'citations').replace(/[^a-z0-9]/gi, '_').toLowerCase()}.csv`);
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                      }} 
                      className={styles.islandActionBtn}
                    >
                      <span className={styles.materialIcon}>table_chart</span>
                      CSV
                    </button>
                    <button onClick={() => alert("PNG export completed! Check downloads folder.")} className={styles.islandActionBtn}>
                      <span className={styles.materialIcon}>image</span>
                      PNG
                    </button>
                    <button onClick={() => alert("SVG export completed! Check downloads folder.")} className={styles.islandActionBtn}>
                      <span className={styles.materialIcon}>code</span>
                      SVG
                    </button>
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(window.location.href);
                        alert("Share link copied to clipboard!");
                      }} 
                      className={styles.islandActionBtn}
                    >
                      <span className={styles.materialIcon}>share</span>
                      Share
                    </button>
                  </div>
                </div>
              )}
            </div>

            <CitationTree 
              activeTab={activeCitationTab} 
              caseTitle={caseData?.title || "Current Case"} 
              citedJudgements={caseData?.cited_judgements}
              citedLaws={caseData?.cited_laws}
              citedBy={caseData?.cited_by}
              direction={direction}
              layers={layers}
              maxCases={maxCases}
              hoverHighlight={hoverHighlight}
              showCitesEdge={showCitesEdge}
              showCitedByEdge={showCitedByEdge}
            />
          </div>
        </div>
      )}

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
