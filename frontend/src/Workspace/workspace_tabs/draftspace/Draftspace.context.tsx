import { createContext, useContext, useEffect, useRef } from "react";
import { useUsageStore, estimateTokens } from "@/store/usageStore";
import { DEFAULT_DRAFT_STATE, DEFAULT_ENRICHMENT, useDraftStore } from "./store/draftStore";
import type { ClarificationPair, ProseMirrorJsonNode, MinimalNode, DependencyGraph } from "./store/draftStore";

import { api_url_base } from "@/config";




import {
  assignIds,
  createSequentialIdMaps,
  buildLLMTree,
  buildMinimalTree,
  analyzeDraft,
  applyMemos,
  buildNodeMetadata,
  computeDocHash,
  computeDocStructureHash,
  validateDraftArtifacts,
} from "./AI_draft_editing/draftIndexer";
import type {
  SeqNodeMap,
  LexpalToSequentialMap,
  NodeMetadata,
} from "./AI_draft_editing/draftIndexer";
import type { EditPlan } from "./AI_draft_editing/draftEditTools";




export type RightPanelTab = "ai-task-manager" | "placeholders" | "format-builder" | "comments" | "activity";


export interface Margins {
    top: number;
    bottom: number;
    left: number;
    right: number;
}

// ---- Drafting task types (existing) ----
interface DraftTaskRequestPayload {
  taskId?: string;
  originalPrompt: string;
  clarificationHistory: ClarificationPair[];
  attached_files?:any[];
  options?:Record<string, boolean>

}

interface DraftTaskApiResponse {
  success: boolean;
  type: "clarification" | "draft_completed" | "error";
  taskId?: string;
  question?: string;
  draftAnalysis?: string;
  prosemirrorJson?: ProseMirrorJsonNode;
  message?: string;
}

// ---- Edit task types (new) ----
export interface EditTaskRequestPayload {
  draftId: string;
  userMessage: string;
  clarificationHistory: ClarificationPair[];
  pmDocument: ProseMirrorJsonNode;
  minimalIndexTree: MinimalNode;
  dependencyGraph: DependencyGraph;
  sequentialToLexpalMap: SeqNodeMap;
  lexpalToSequentialMap: LexpalToSequentialMap;
  nodeMetadata: Record<string, NodeMetadata>;
  draftMetadata?: {
    title: string;
    margins: { top: number; bottom: number; left: number; right: number };
    typography: { fontFamily: string; fontSize: number; lineHeight: number };
  };
}

export interface EditTaskApiResponse {
  /** "questions" → clarification needed, "completed" → plan ready, "error" → failure */
  status: "questions" | "completed" | "error";
  questions?: string[];
  editPlan?: EditPlan;
  message?: string;
}

interface DraftspaceContextType {
  requestDraftTask: (payload: DraftTaskRequestPayload) => Promise<DraftTaskApiResponse>
  requestEditTask: (payload: EditTaskRequestPayload) => Promise<EditTaskApiResponse>
  ensureEnrichment: () => Promise<void>
  activeTab: RightPanelTab;
  setActiveTab: (tab: RightPanelTab) => void;
  margins: Margins;
  setMargins: (m: Partial<Margins>) => void;
  typography: { fontFamily: string; fontSize: number; lineHeight: number };
  setTypography: (t: Partial<{ fontFamily: string; fontSize: number; lineHeight: number }>) => void;
}

const DraftspaceContext = createContext<DraftspaceContextType | null>(null)

export function DraftspaceProvider({ children }: { children: React.ReactNode }) {
  const { drafts, activeDraftId: draftId, updateDraft, setEnrichment } = useDraftStore();
  const { addUsage } = useUsageStore();
  const rawDraft = drafts[draftId] || DEFAULT_DRAFT_STATE;





  const normalizedEnrichment = {
    ...DEFAULT_ENRICHMENT,
    ...(rawDraft.enrichment || {}),
    sequentialToLexpalMap:
      rawDraft.enrichment?.sequentialToLexpalMap ??
      rawDraft.enrichment?.seqNodeMap,
    seqNodeMapGenerated:
      rawDraft.enrichment?.seqNodeMapGenerated ??
      rawDraft.enrichment?.sequentialMapsGenerated ??
      false,
    sequentialMapsGenerated:
      rawDraft.enrichment?.sequentialMapsGenerated ??
      rawDraft.enrichment?.seqNodeMapGenerated ??
      false,
  };
  






  // Deep merge to handle cases where localStorage has old data missing new fields
  const currentDraft = {
    ...DEFAULT_DRAFT_STATE,
    ...rawDraft,
    margins: { ...DEFAULT_DRAFT_STATE.margins, ...rawDraft.margins },
    typography: { ...DEFAULT_DRAFT_STATE.typography, ...rawDraft.typography },
    enrichment: normalizedEnrichment,
    comments: rawDraft.comments || [],
    activityLog: rawDraft.activityLog || [],
    tasks: rawDraft.tasks || [],
    editTasks: rawDraft.editTasks || [],
    messages: rawDraft.messages || [],
  };
  
  const activeTab = currentDraft.activeTab as RightPanelTab;
  const setActiveTab = (tab: RightPanelTab) => updateDraft(draftId, { activeTab: tab });

  const margins = currentDraft.margins;
  const setMargins = (m: Partial<Margins>) => 
    updateDraft(draftId, { margins: { ...margins, ...m } });


  
  const typography = currentDraft.typography;
  const setTypography = (t: Partial<{ fontFamily: string; fontSize: number; lineHeight: number }>) =>{
    updateDraft(draftId, { typography: { ...typography, ...t } });
  }














  // -------------------------------------------------------------------------
  // Draft Enrichment Pipeline
  // -------------------------------------------------------------------------

  /**
   * Runs the full enrichment pipeline on a given ProseMirror document.
   * 1. assignIds  — stable lexpalId on every block node
   * 2. createSequentialNodeMap — ephemeral N1/N2/... -> stable lexpalId map
   * 3. buildMinimalTree — lightweight tree for the LLM
   * 4. analyzeDraft — LLM generates memos + dependency references
   * 5. applyMemos — attach memos back into the doc attrs
   * All results are persisted to the draft store.
   */
  const runEnrichmentPipeline = async (
    targetDraftId: string,
    doc: ProseMirrorJsonNode
  ): Promise<void> => {
    console.log("[DraftEnrichment] Pipeline started for draft:", targetDraftId);
    try {
      // Stage 1: assign stable IDs
      const enrichedDoc = assignIds(doc) as ProseMirrorJsonNode;
      updateDraft(targetDraftId, { prosemirrorJson: enrichedDoc });
      console.log("[DraftEnrichment] Stage 1 completed: assignIds");

      // Stage 2: preflight minimal tree build to fail fast on invalid structure
      void (buildMinimalTree(enrichedDoc) as MinimalNode);
      console.log("[DraftEnrichment] Stage 2 completed: buildMinimalTree preflight");

      // Stage 4: LLM analysis — memos + dependency graph
      const llmTree = buildLLMTree(enrichedDoc);
      console.log("[DraftEnrichment] Calling analyzeDraft API with tree:", llmTree);
      const analysis = await analyzeDraft(llmTree);
      console.log("[DraftEnrichment] Stage 4 completed: analyzeDraft", analysis);

      // Stage 5: apply memos back into the doc
      const memoedDoc = applyMemos(enrichedDoc, analysis.memos) as ProseMirrorJsonNode;
      updateDraft(targetDraftId, { prosemirrorJson: memoedDoc });

      // Stage 6: rebuild deterministic artifact bundle from memoed doc
      const sequentialMaps = createSequentialIdMaps(
        memoedDoc as import("./AI_draft_editing/draftIndexer").PMNode
      );
      const finalMinimalTree = buildMinimalTree(memoedDoc) as MinimalNode;
      const nodeMetadata = buildNodeMetadata(
        memoedDoc as import("./AI_draft_editing/draftIndexer").PMNode
      );
      const derivedFromDocHash = computeDocHash(
        memoedDoc as import("./AI_draft_editing/draftIndexer").PMNode
      );
      const derivedFromStructureHash = computeDocStructureHash(
        memoedDoc as import("./AI_draft_editing/draftIndexer").PMNode
      );

      setEnrichment(targetDraftId, {
        artifactVersion: 1,
        generatedAt: new Date().toISOString(),
        derivedFromDocHash,
        derivedFromStructureHash,
        indexed: true,
        sequentialMapsGenerated: true,
        seqNodeMapGenerated: true,
        sequentialToLexpalMap: sequentialMaps.sequentialToLexpalMap,
        lexpalToSequentialMap: sequentialMaps.lexpalToSequentialMap,
        seqNodeMap: sequentialMaps.sequentialToLexpalMap,
        minimalTreeGenerated: true,
        minimalTree: finalMinimalTree,
        memosGenerated: true,
        dependencyGraphGenerated: true,
        dependencyGraph: analysis.dependencies as DependencyGraph,
        nodeMetadata,
      });
      console.log("[DraftEnrichment] Stage 5 completed: applyMemos");
      
      console.log("[DraftEnrichment] Entire pipeline executed successfully.");
    } catch (err) {
      // Enrichment failed — leave whatever partial state we wrote.
      // The failsafe will retry on the next attempt.
      console.error("[DraftEnrichment] Pipeline failed:", err);
    }
  };









  /**
   * Checks whether the current draft is fully enriched.
   * If any stage is missing AND there is content in the draft, triggers the pipeline.
   * Safe to call multiple times — uses a ref to prevent concurrent runs.
   */
  const enrichmentRunningRef = useRef(false);

  const ensureEnrichment = async (): Promise<void> => {
    const latestDraft = useDraftStore.getState().drafts[draftId];
    if (!latestDraft?.prosemirrorJson) return;

    const e = latestDraft.enrichment || DEFAULT_ENRICHMENT;
    const currentStructureHash = computeDocStructureHash(
      latestDraft.prosemirrorJson as import("./AI_draft_editing/draftIndexer").PMNode
    );

    const hasRequiredArtifacts =
      Boolean(e.minimalTree) &&
      Boolean(e.dependencyGraph) &&
      Boolean(e.sequentialToLexpalMap || e.seqNodeMap) &&
      Boolean(e.lexpalToSequentialMap) &&
      Boolean(e.nodeMetadata);

    const hasAnyMissingArtifact = !hasRequiredArtifacts;

    const validation = validateDraftArtifacts(
      latestDraft.prosemirrorJson as import("./AI_draft_editing/draftIndexer").PMNode,
      {
        minimalTree: e.minimalTree,
        dependencyGraph: e.dependencyGraph,
        sequentialToLexpalMap: e.sequentialToLexpalMap,
        lexpalToSequentialMap: e.lexpalToSequentialMap,
        nodeMetadata: e.nodeMetadata,
        seqNodeMap: e.seqNodeMap,
      }
    );

    const isFullyEnriched =
      e.indexed &&
      e.sequentialMapsGenerated &&
      e.memosGenerated &&
      e.minimalTreeGenerated &&
      e.dependencyGraphGenerated &&
      validation.ok;

    const structureChangedSinceLastEnrichment =
      e.derivedFromStructureHash !== currentStructureHash;

    const shouldRunPipeline =
      !isFullyEnriched ||
      hasAnyMissingArtifact ||
      structureChangedSinceLastEnrichment;

    if (!shouldRunPipeline) return;
    if (enrichmentRunningRef.current) return;

    enrichmentRunningRef.current = true;
    try {
      await runEnrichmentPipeline(draftId, latestDraft.prosemirrorJson);
    } finally {
      enrichmentRunningRef.current = false;
    }
  };















  // -------------------------------------------------------------------------
  // Failsafe: auto-enrich whenever the draft's prosemirrorJson changes
  // and enrichment is incomplete. This covers:
  //   - A new draft being loaded/switched
  //   - A draft being replaced (e.g. DOCX import)
  //   - Editor initialization with an existing but un-enriched draft
  // -------------------------------------------------------------------------
  const prosemirrorJson = currentDraft.prosemirrorJson;
  const enrichment = currentDraft.enrichment;

  useEffect(() => {
    if (!prosemirrorJson) return;

    if (!enrichmentRunningRef.current) {
      void ensureEnrichment();
    }
    // Re-check enrichment whenever document identity or enrichment markers change.
    // `ensureEnrichment` itself decides whether to run the pipeline based on:
    // - missing artifacts
    // - failed validation
    // - structural hash changes (e.g., block node insertion/removal/move)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    prosemirrorJson,
    enrichment.generatedAt,
    enrichment.derivedFromStructureHash,
    enrichment.indexed,
    enrichment.sequentialMapsGenerated,
    enrichment.memosGenerated,
    enrichment.minimalTreeGenerated,
    enrichment.dependencyGraphGenerated,
  ]);



















  // -------------------------------------------------------------------------
  //  Drafting request handler
  // -------------------------------------------------------------------------

  const requestDraftTask = async (
    payload: DraftTaskRequestPayload
  ): Promise<DraftTaskApiResponse> => {
   

    try {
      const response = await fetch(`${api_url_base}/api/documents/draftspace-ai`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          taskId: payload.taskId,
          prompt: payload.originalPrompt,
          originalPrompt: payload.originalPrompt,
          state: payload.clarificationHistory,
          clarificationHistory: payload.clarificationHistory,
        })
      })

      const data = await response.json()

      if (!response.ok || data?.success === false) {
        return {
          success: false,
          type: "error",
          message: data?.message || "Failed to process drafting task",
          taskId: payload.taskId,
        };
      }

      // Track usage
      const queryUsage = estimateTokens(payload.originalPrompt)
      const dataStr = JSON.stringify(data)
      const responseUsage = estimateTokens(dataStr)
      addUsage(queryUsage + responseUsage)

      return data as DraftTaskApiResponse;
    } catch (err) {
      console.error("Draftspace AI Error:", err)
      return {
        success: false,
        type: "error",
        message: "Network error while processing drafting task",
        taskId: payload.taskId,
      };
    }
  }















  // -------------------------------------------------------------------------
  // Handle editing request
  // -------------------------------------------------------------------------

  const requestEditTask = async (
    payload: EditTaskRequestPayload
  ): Promise<EditTaskApiResponse> => {
    

    try {
      const response = await fetch(`${api_url_base}/api/documents/draftspace/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: payload.draftId,
          userMessage: payload.userMessage,
          clarificationHistory: payload.clarificationHistory,
          pmDocument: payload.pmDocument,
          minimalIndexTree: payload.minimalIndexTree,
          dependencyGraph: payload.dependencyGraph,
          sequentialToLexpalMap: payload.sequentialToLexpalMap,
          lexpalToSequentialMap: payload.lexpalToSequentialMap,
          nodeMetadata: payload.nodeMetadata,
          draftMetadata: payload.draftMetadata,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          status: "error",
          message: data?.error || "Edit request failed",
        };
      }

      // Track usage
      const queryUsage = estimateTokens(payload.userMessage);
      const responseUsage = estimateTokens(JSON.stringify(data));
      addUsage(queryUsage + responseUsage);

      return data as EditTaskApiResponse;
    } catch (err) {
      console.error("[DraftEdit] Network error:", err);
      return {
        status: "error",
        message: "Network error while processing edit task",
      };
    }
  };












  return (
    <DraftspaceContext.Provider
      value={{
        requestDraftTask,
        requestEditTask,
        ensureEnrichment,
        activeTab,
        setActiveTab,
        margins,
        setMargins,
        typography,
        setTypography,
      }}
    >
      {children}
    </DraftspaceContext.Provider>
  )
}








export function useDraftspace() {
  const ctx = useContext(DraftspaceContext)
  if (!ctx) {
    throw new Error("useDraftspace must be used inside DraftspaceProvider")
  }
  return ctx
}
