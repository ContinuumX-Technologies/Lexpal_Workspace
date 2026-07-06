import { useEffect, useMemo, useRef, useState } from "react"
import { PromptInputBox } from "@/components/ui/ai-prompt-box"
import {
  ChatBubble,
  ChatBubbleAvatar,
  ChatBubbleMessage,
} from "@/components/ui/chat-bubble"
import { TextShimmerWave } from "@/components/ui/text-shimmer-wave"
import styles from "./AiChat.module.css"


import { useDraftspace } from "../Draftspace.context"

import { useDraftStore } from "../store/draftStore"
import type { DraftTask, ClarificationPair, EditTask } from "../store/draftStore"

import { useDocumentStore } from "../store/documentStore"


import { applyEditPlan } from "../AI_draft_editing/draftEditTools"
import type { EditOperation } from "../AI_draft_editing/draftEditTools"


import {
  assignIds,
  createSequentialIdMaps,
  buildNodeMetadata,
  computeDocHash,
  computeDocStructureHash,
} from "../AI_draft_editing/draftIndexer"

// PMLparser is a plain JS module — import via relative path
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { parsePML } from "../utils/PMLparser.js"
import type { AnyARecord } from "dns"



interface ChatMessage {
  input_text: string;
  attached_files: {
    file_id: string;
    file_title: string;
    text_content: string;
  }[];
  options: {
    webSearch: boolean;
    thinking: boolean;
  };
}





// ---- Timeline item union ----
type TimelineItem =
  | { kind: "message"; id: string; timestamp: string; text: string }
  | { kind: "draftTask"; id: string; timestamp: string; task: DraftTask }
  | { kind: "editTask"; id: string; timestamp: string; task: EditTask }

type PMNodeLike = { type: string; content?: unknown[] }






const stripCodeFences = (value: string): string => {
  const trimmedUserPrompt = value.trim()
  const match = trimmedUserPrompt.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return match ? match[1].trim() : trimmedUserPrompt
}




const isObjectRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null
  

const isPMNodeLike = (value: unknown): value is PMNodeLike => isObjectRecord(value) && typeof value.type === "string"
  

const asError = (value: unknown): Error => value instanceof Error ? value : new Error(String(value))
  





const logEditTaskError = (source: string, details: Record<string, unknown>, error?: unknown): void => {
  //dev logs
  console.error(`[DraftEdit][${source}]`, {
    ...details,
    error: error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : error,
  })
}










type ParseAttempt = {
  name: "pml" | "json"
  parse: () => unknown[]
}

const parseGeneratedContentToPmNodes = (generatedContent: string): unknown[] => {
  const normalized = stripCodeFences(generatedContent)

  const parseAsJson = (): unknown[] => {
    const parsed = JSON.parse(normalized) as unknown

    if (Array.isArray(parsed)) {
      return parsed
    }

    if (isPMNodeLike(parsed)) {
      if (parsed.type === "doc") {
        const docContent = parsed.content
        if (docContent === undefined) return []
        if (!Array.isArray(docContent)) {
          throw new Error('ProseMirror doc JSON must have an array "content" field')
        }
        return docContent
      }
      return [parsed]
    }

    throw new Error(
      "JSON generatedContent must be a ProseMirror node object, a doc object, or an array of nodes"
    )
  }

  const parseAsPml = (): unknown[] => {
    const pmDoc = parsePML(normalized) as { type?: string; content?: unknown[] }
    return Array.isArray(pmDoc.content) ? pmDoc.content : []
  }

  // Prefer JSON for content that looks like JSON, PML otherwise.
  // Always fall back to the other strategy on failure.
  const looksLikeJson = normalized.startsWith("{") || normalized.startsWith("[")

  const attempts: ParseAttempt[] = looksLikeJson
    ? [{ name: "json", parse: parseAsJson }, { name: "pml", parse: parseAsPml }]
    : [{ name: "pml", parse: parseAsPml }, { name: "json", parse: parseAsJson }]

  const errors: Partial<Record<ParseAttempt["name"], Error>> = {}

  for (const { name, parse } of attempts) {
    try {
      return parse()
    } catch (error) {
      errors[name] = asError(error)
    }
  }

  throw new Error(
    [
      "Unable to parse generated content.",
      errors.pml && `PM-Lite error: ${errors.pml.message}`,
      errors.json && `JSON error: ${errors.json.message}`,
    ]
      .filter(Boolean)
      .join(" ")
  )
}











export default function AiChat() {

  const draftId = useDraftStore(state => state.activeDraftId)
  const draft = useDraftStore(state => state.drafts[draftId])
  const editor = useDocumentStore(state => state.editor)

  const appendUserMessage = useDraftStore(state => state.appendUserMessage)
  const createTask = useDraftStore(state => state.createTask)
  const updateTask = useDraftStore(state => state.updateTask)
  const retryTask = useDraftStore(state => state.retryTask)
  const updateDraft = useDraftStore(state => state.updateDraft)
  const setEnrichment = useDraftStore(state => state.setEnrichment)
  const createEditTask = useDraftStore(state => state.createEditTask)
  const updateEditTask = useDraftStore(state => state.updateEditTask)
  const retryEditTask = useDraftStore(state => state.retryEditTask)



  const { requestDraftTask, requestEditTask, ensureEnrichment } = useDraftspace()
  


  const [clarificationInputs, setClarificationInputs] = useState<Record<string, string>>({})

  const messagesEndRef = useRef<HTMLDivElement>(null)

  const messages = draft?.messages || []
  const tasks = draft?.tasks || []
  const editTasks = draft?.editTasks || []




  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, tasks, editTasks])










  // -------------------------------------------------------------------------
  // Timeline — merge messages + drafting tasks + editing tasks, sorted by time
  // -------------------------------------------------------------------------
  const timeline = useMemo(() => {
    const messageItems: TimelineItem[] = messages.map((message) => ({
      kind: "message",
      id: message.id,
      timestamp: message.timestamp,
      text: message.text,
    }))

    const draftTaskItems: TimelineItem[] = tasks.map((task) => ({
      kind: "draftTask",
      id: task.id,
      timestamp: task.createdAt,
      task,
    }))

    const editTaskItems: TimelineItem[] = editTasks.map((task) => ({
      kind: "editTask",
      id: task.id,
      timestamp: task.createdAt,
      task,
    }))

    return [...messageItems, ...draftTaskItems, ...editTaskItems].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )
  }, [messages, tasks, editTasks])

















  // -------------------------------------------------------------------------
  // Helper: detect whether the editor has real content
  // -------------------------------------------------------------------------
  const editorHasContent = (): boolean => {
    if (!editor) return false
    const json = editor.getJSON()
    if (!json?.content || json.content.length === 0) return false
    // An editor with only a single empty paragraph is treated as empty
    if (json.content.length === 1) {
      const first = json.content[0]
      if (first.type === "paragraph" && (!first.content || first.content.length === 0)) {
        return false
      }
    }
    return true
  }















  // =========================================================================
  // DRAFTING FLOW (existing — unchanged logic)
  // =========================================================================

  const applyDraftingTaskResponse = async (
    taskId: string,
    prompt: string,
    clarificationHistory: ClarificationPair[],
    attached_files?:any[],
    options?:Record<string, boolean>
  ) => {
    const data = await requestDraftTask({
      taskId,
      originalPrompt: prompt,
      clarificationHistory,
      attached_files,
      options,
    })

    if (!data.success || data.type === "error") {
      updateTask(draftId, taskId, (task) => ({
        ...task,
        status: "error",
        currentClarificationQuestion: undefined,
        errorMessage: data.message || "Draft generation failed",
      }))
      return
    }

    if (data.type === "clarification") {
      updateTask(draftId, taskId, (task) => ({
        ...task,
        status: "clarification_required",
        clarificationHistory,
        currentClarificationQuestion: data.question || "Please provide more details.",
        errorMessage: undefined,
      }))
      return
    }

    if (data.type === "draft_completed") {
      updateTask(draftId, taskId, (task) => ({
        ...task,
        status: "draft_completed",
        clarificationHistory,
        currentClarificationQuestion: undefined,
        draftAnalysis: data.draftAnalysis,
        prosemirrorJson: data.prosemirrorJson,
        errorMessage: undefined,
        completedAt: new Date().toISOString(),
      }))

      if (data.prosemirrorJson) {
        updateDraft(draftId, { prosemirrorJson: data.prosemirrorJson })
        if (editor) {
          editor.commands.setContent(data.prosemirrorJson, { emitUpdate: false })
        }
        // Enrichment pipeline will be triggered automatically by the failsafe
        // useEffect in Draftspace.context.tsx when prosemirrorJson changes.
      }
    }
  }




















  // =========================================================================
  // EDITING FLOW (new)
  // =========================================================================

  /**
   * Converts PML markup in edit plan steps to ProseMirror JSON nodes,
   * then calls applyEditPlan to produce the updated document JSON.
   */
  const executeEditPlan = (plan: import("../AI_draft_editing/draftEditTools").EditPlan) => {
    const currentDoc = editor?.getJSON()
    if (!currentDoc) throw new Error("Editor has no document to apply edits to")

    // Build operations array, converting PM-Lite/JSON content where needed.
    // This also normalizes legacy server operation schema fields.
    const operations: EditOperation[] = plan.steps.map((step) => {
      const op = { ...step.operation } as Record<string, unknown> & { op: string }

      const parseStepGeneratedNodes = (): unknown[] => {
        if (!step.generatedContent) {
          throw new Error(`Step ${step.stepId} requires generation but generatedContent is missing`)
        }
        return parseGeneratedContentToPmNodes(step.generatedContent)
      }

      const parseLegacyContentNodes = (): unknown[] => {
        if (typeof op.content !== "string") {
          throw new Error(
            `Step ${step.stepId} has legacy content field but it is not a string (received ${typeof op.content})`
          )
        }
        return parseGeneratedContentToPmNodes(op.content)
      }

      if (op.op === "replaceNode") {
        if (step.requiresGeneration) {
          let pmNodes: unknown[]
          try {
            pmNodes = parseStepGeneratedNodes()
          } catch (err) {
            throw new Error(
              `Step ${step.stepId} generated invalid content: ${err instanceof Error ? err.message : String(err)}`
            )
          }

          if (pmNodes.length !== 1) {
            throw new Error(`replaceNode expected exactly 1 node, received ${pmNodes.length}`)
          }

          return {
            op: "replaceNode",
            nodeId: String(op.nodeId ?? ""),
            replacement: pmNodes[0],
          }
        }

        if (op.replacement && typeof op.replacement === "object") {
          return op as unknown as EditOperation
        }

        if (typeof op.content === "string") {
          let pmNodes: unknown[]
          try {
            pmNodes = parseLegacyContentNodes()
          } catch (err) {
            throw new Error(
              `Step ${step.stepId} has invalid replaceNode.content: ${err instanceof Error ? err.message : String(err)}`
            )
          }

          if (pmNodes.length !== 1) {
            throw new Error(
              `replaceNode(content) expected exactly 1 node, received ${pmNodes.length}`
            )
          }

          return {
            op: "replaceNode",
            nodeId: String(op.nodeId ?? ""),
            replacement: pmNodes[0],
          }
        }

        throw new Error(
          `Step ${step.stepId} replaceNode is missing replacement/content payload`
        )
      }

      if (op.op === "createNode") {
        if (step.requiresGeneration) {
          let pmNodes: unknown[]
          try {
            pmNodes = parseStepGeneratedNodes()
          } catch (err) {
            throw new Error(
              `Step ${step.stepId} generated invalid content: ${err instanceof Error ? err.message : String(err)}`
            )
          }

          return {
            op: "createNode",
            parentId: String(op.parentId ?? ""),
            index: Number(op.index ?? 0),
            nodes: pmNodes,
          }
        }

        if (Array.isArray(op.nodes)) {
          return op as unknown as EditOperation
        }

        if (typeof op.content === "string") {
          let pmNodes: unknown[]
          try {
            pmNodes = parseLegacyContentNodes()
          } catch (err) {
            throw new Error(
              `Step ${step.stepId} has invalid createNode.content: ${err instanceof Error ? err.message : String(err)}`
            )
          }

          return {
            op: "createNode",
            parentId: String(op.parentId ?? ""),
            index: Number(op.index ?? 0),
            nodes: pmNodes,
          }
        }

        throw new Error(
          `Step ${step.stepId} createNode is missing nodes/content payload`
        )
      }

      if (op.op === "deleteNode" || op.op === "moveNode") {
        return op as unknown as EditOperation
      }

      throw new Error(`Unsupported operation type in step ${step.stepId}: ${String(op.op)}`)
    }) as EditOperation[]

    try {
      console.log('[executeEditPlan] doc root lexpalId:', currentDoc.attrs?.lexpalId);




      const updatedDoc = applyEditPlan(
        currentDoc as import("../AI_draft_editing/draftEditTools").PMNode,
        operations
      )



      return updatedDoc;


    } catch (err) {
      logEditTaskError(
        "executeEditPlan.applyEditPlan",
        {
          steps: plan.steps.length,
          operations: operations.map((operation) => operation.op),
        },
        err
      )
      throw err
    }
  }






















  const applyEditResponse = async (
    editTaskId: string,
    prompt: string,
    clarificationHistory: ClarificationPair[]
  ) => {
    const latestDraft = useDraftStore.getState().drafts[draftId]
    const pmDocument = latestDraft?.prosemirrorJson ?? editor?.getJSON()

    if (!pmDocument || !latestDraft) {
      //dev logs
      logEditTaskError("applyEditResponse.missingDocument", {
        draftId,
        editTaskId,
        hasPmDocument: Boolean(pmDocument),
        hasDraft: Boolean(latestDraft),
      })
      updateEditTask(draftId, editTaskId, (task) => ({
        ...task,
        status: "error",
        errorMessage: "No document content found",
      }))
      return
    }

    const enrichment = latestDraft.enrichment
    if (
      !enrichment.minimalTree ||
      !enrichment.dependencyGraph ||
      !enrichment.sequentialToLexpalMap ||
      !enrichment.lexpalToSequentialMap ||
      !enrichment.nodeMetadata
    ) {
      //dev logs
      logEditTaskError("applyEditResponse.missingEnrichment", {
        draftId,
        editTaskId,
        hasMinimalTree: Boolean(enrichment.minimalTree),
        hasDependencyGraph: Boolean(enrichment.dependencyGraph),
        hasSequentialToLexpalMap: Boolean(enrichment.sequentialToLexpalMap),
        hasLexpalToSequentialMap: Boolean(enrichment.lexpalToSequentialMap),
        hasNodeMetadata: Boolean(enrichment.nodeMetadata),
      })
      updateEditTask(draftId, editTaskId, (task) => ({
        ...task,
        status: "error",
        errorMessage: "Draft enrichment not available. Please wait for indexing to complete.",
      }))
      return
    }

    let normalizedPmDocument: import("../store/draftStore").ProseMirrorJsonNode

    let latestSequentialMaps: {
      sequentialToLexpalMap: import("../AI_draft_editing/draftIndexer").SeqNodeMap
      lexpalToSequentialMap: import("../AI_draft_editing/draftIndexer").LexpalToSequentialMap
    }

    let latestNodeMetadata: Record<string, import("../AI_draft_editing/draftIndexer").NodeMetadata>
    let derivedFromDocHash = ""
    let derivedFromStructureHash = ""
    try {
      normalizedPmDocument = assignIds(
        pmDocument as import("../AI_draft_editing/draftIndexer").PMNode
      ) as import("../store/draftStore").ProseMirrorJsonNode
     
      console.log(
  "root before",
  pmDocument.attrs?.lexpalId
);

console.log(
  "root after",
  normalizedPmDocument.attrs?.lexpalId
);
      latestSequentialMaps = createSequentialIdMaps(
        normalizedPmDocument as import("../AI_draft_editing/draftIndexer").PMNode
      )
      latestNodeMetadata = buildNodeMetadata(
        normalizedPmDocument as import("../AI_draft_editing/draftIndexer").PMNode
      )
      derivedFromDocHash = computeDocHash(
        normalizedPmDocument as import("../AI_draft_editing/draftIndexer").PMNode
      )
      derivedFromStructureHash = computeDocStructureHash(
        normalizedPmDocument as import("../AI_draft_editing/draftIndexer").PMNode
      )

      if (editor) {
        editor.commands.setContent(normalizedPmDocument, { emitUpdate: false })
      }

      updateDraft(draftId, {
        prosemirrorJson: normalizedPmDocument,
      })

      setEnrichment(draftId, {
        artifactVersion: 1,
        generatedAt: new Date().toISOString(),
        derivedFromDocHash,
        derivedFromStructureHash,
        sequentialMapsGenerated: true,
        seqNodeMapGenerated: true,
        sequentialToLexpalMap: latestSequentialMaps.sequentialToLexpalMap,
        lexpalToSequentialMap: latestSequentialMaps.lexpalToSequentialMap,
        seqNodeMap: latestSequentialMaps.sequentialToLexpalMap,
        nodeMetadata: latestNodeMetadata,
      })
    } catch (err) {
      //dev logs
      logEditTaskError("applyEditResponse.regenerateSeqNodeMap", {
        draftId,
        editTaskId,
      }, err)
      updateEditTask(draftId, editTaskId, (task) => ({
        ...task,
        status: "error",
        errorMessage: err instanceof Error ? err.message : "Failed to regenerate sequential node map",
      }))
      return
    }

    const data = await requestEditTask({
      draftId,
      userMessage: prompt,
      clarificationHistory,
      pmDocument: normalizedPmDocument,
      minimalIndexTree: enrichment.minimalTree,
      dependencyGraph: enrichment.dependencyGraph,
      sequentialToLexpalMap: latestSequentialMaps.sequentialToLexpalMap,
      lexpalToSequentialMap: latestSequentialMaps.lexpalToSequentialMap,
      nodeMetadata: latestNodeMetadata,
      draftMetadata: {
        title: latestDraft.title,
        margins: latestDraft.margins,
        typography: latestDraft.typography,
      },
    })

    if (data.status === "error") {
      //dev logs
      logEditTaskError("applyEditResponse.apiReturnedError", {
        draftId,
        editTaskId,
        message: data.message,
      })
      updateEditTask(draftId, editTaskId, (task) => ({
        ...task,
        status: "error",
        errorMessage: data.message || "Edit failed",
      }))
      return
    }

    if (data.status === "questions" && data.questions?.length) {
      updateEditTask(draftId, editTaskId, (task) => ({
        ...task,
        status: "clarification_required",
        clarificationHistory,
        currentClarificationQuestion: data.questions![0],
        errorMessage: undefined,
      }))
      return
    }

    if (data.status === "completed" && data.editPlan) {
      try {
        const updatedDoc = executeEditPlan(data.editPlan)
        const normalizedUpdatedDoc = assignIds(
          updatedDoc as import("../AI_draft_editing/draftIndexer").PMNode
        ) as import("../store/draftStore").ProseMirrorJsonNode

        const updatedSequentialMaps = createSequentialIdMaps(
          normalizedUpdatedDoc as import("../AI_draft_editing/draftIndexer").PMNode
        )
        const updatedNodeMetadata = buildNodeMetadata(
          normalizedUpdatedDoc as import("../AI_draft_editing/draftIndexer").PMNode
        )
        const updatedDerivedDocHash = computeDocHash(
          normalizedUpdatedDoc as import("../AI_draft_editing/draftIndexer").PMNode
        )
        const updatedDerivedFromStructureHash = computeDocStructureHash(
          normalizedUpdatedDoc as import("../AI_draft_editing/draftIndexer").PMNode
        )

        if (editor) {
          editor.commands.setContent(normalizedUpdatedDoc, { emitUpdate: false })
        }
        updateDraft(draftId, {
          prosemirrorJson: normalizedUpdatedDoc,
        })
        setEnrichment(draftId, {
          artifactVersion: 1,
          generatedAt: new Date().toISOString(),
          derivedFromDocHash: updatedDerivedDocHash,
          derivedFromStructureHash: updatedDerivedFromStructureHash,
          indexed: true,
          sequentialMapsGenerated: true,
          seqNodeMapGenerated: true,
          sequentialToLexpalMap: updatedSequentialMaps.sequentialToLexpalMap,
          lexpalToSequentialMap: updatedSequentialMaps.lexpalToSequentialMap,
          seqNodeMap: updatedSequentialMaps.sequentialToLexpalMap,
          nodeMetadata: updatedNodeMetadata,
          // Force full post-edit artifact rebuild for memos, dependencies, and minimal tree.
          memosGenerated: false,
          minimalTreeGenerated: false,
          dependencyGraphGenerated: false,
        })

        // Recompute full enrichment artifacts after edit application.
        await ensureEnrichment()

        updateEditTask(draftId, editTaskId, (task) => ({
          ...task,
          status: "edit_completed",
          clarificationHistory,
          currentClarificationQuestion: undefined,
          errorMessage: undefined,
          completedAt: new Date().toISOString(),
        }))
      } catch (err) {
        //dev logs
        logEditTaskError("applyEditResponse.executeEditPlan", {
          draftId,
          editTaskId,
          status: data.status,
          hasEditPlan: Boolean(data.editPlan),
          stepCount: data.editPlan?.steps?.length,
        }, err)
        updateEditTask(draftId, editTaskId, (task) => ({
          ...task,
          status: "error",
          errorMessage: err instanceof Error ? err.message : "Failed to apply edit plan",
        }))
      }
    }
  }















  // =========================================================================
  // handleSend — Route selection
  // =========================================================================

  const handleSend = async (message: ChatMessage) => {
    const trimmedUserPrompt = message.input_text.trim()
    if (!trimmedUserPrompt) return

    appendUserMessage(draftId, trimmedUserPrompt)

    if (!editorHasContent()) {
      // ---- Case 1: Empty editor → draft creation (existing flow) ----
      const taskId = createTask(draftId, trimmedUserPrompt)
      await applyDraftingTaskResponse(taskId, trimmedUserPrompt, [],message.attached_files,message.options)
    } else {
      // ---- Case 2: Editor has content → edit request ----
      // Failsafe: guarantee enrichment exists before sending the edit request
      await ensureEnrichment()
      const editTaskId = createEditTask(draftId, trimmedUserPrompt)
      await applyEditResponse(editTaskId, trimmedUserPrompt, [])
    }
  }










  // =========================================================================
  // Clarification handlers
  // =========================================================================

  const handleClarificationChange = (taskId: string, value: string) => {
    setClarificationInputs((prev) => ({ ...prev, [taskId]: value }))
  }








  // Drafting clarification
  const handleDraftClarificationSubmit = async (task: DraftTask) => {
    const answer = (clarificationInputs[task.id] || "").trim()
    if (!answer || !task.currentClarificationQuestion) return

    const nextHistory: ClarificationPair[] = [
      ...task.clarificationHistory,
      { question: task.currentClarificationQuestion, answer },
    ]

    updateTask(draftId, task.id, (prevTask) => ({
      ...prevTask,
      status: "thinking",
      clarificationHistory: nextHistory,
      currentClarificationQuestion: undefined,
      errorMessage: undefined,
    }))

    setClarificationInputs((prev) => ({ ...prev, [task.id]: "" }))
    await applyDraftingTaskResponse(task.id, task.prompt, nextHistory)
  }









  // Editing clarification
  const handleEditClarificationSubmit = async (task: EditTask) => {
    const answer = (clarificationInputs[task.id] || "").trim()
    if (!answer || !task.currentClarificationQuestion) return

    const nextHistory: ClarificationPair[] = [
      ...task.clarificationHistory,
      { question: task.currentClarificationQuestion, answer },
    ]

    updateEditTask(draftId, task.id, (prevTask) => ({
      ...prevTask,
      status: "thinking",
      clarificationHistory: nextHistory,
      currentClarificationQuestion: undefined,
      errorMessage: undefined,
    }))

    setClarificationInputs((prev) => ({ ...prev, [task.id]: "" }))
    await applyEditResponse(task.id, task.prompt, nextHistory)
  }









  // Retry handlers
  const handleRetryDraftTask = async (task: DraftTask) => {
    retryTask(draftId, task.id)
    await applyDraftingTaskResponse(task.id, task.prompt, task.clarificationHistory)
  }



  const handleRetryEditTask = async (task: EditTask) => {
    retryEditTask(draftId, task.id)
    await applyEditResponse(task.id, task.prompt, task.clarificationHistory)
  }


  //util functions
  const formatTime = (dateStr: string) =>
    new Date(dateStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })






  // =========================================================================
  // Render
  // =========================================================================

  const isLoading =
    tasks.some((t) => t.status === "thinking" || t.status === "pending") ||
    editTasks.some((t) => t.status === "thinking")










  return (
    <div className={styles.chatRoot}>
      <div className={styles.timeline}>
        {timeline.map((item) => {

          // ---- User message bubble ----
          if (item.kind === "message") {
            return (
              <ChatBubble key={item.id} variant="sent">
                <div className={styles.messageWrap}>
                  <ChatBubbleMessage variant="sent">
                    <p className={styles.messageText}>{item.text}</p>
                  </ChatBubbleMessage>
                  <span className={styles.timestamp}>{formatTime(item.timestamp)}</span>
                </div>
              </ChatBubble>
            )
          }

          // ---- Drafting Task Card ----
          if (item.kind === "draftTask") {
            const task = item.task
            const isThinking = task.status === "thinking" || task.status === "pending"
            const isClarification = task.status === "clarification_required"
            const isCompleted = task.status === "draft_completed"
            const isError = task.status === "error"

            return (
              <ChatBubble key={item.id} variant="received">
                <ChatBubbleAvatar fallback="✦" />
                <div className={styles.taskWrap}>
                  <div
                    className={[
                      styles.taskCard,
                      isThinking ? styles.taskCardThinking : "",
                      isClarification ? styles.taskCardClarification : "",
                      isCompleted ? styles.taskCardCompleted : "",
                      isError ? styles.taskCardError : "",
                    ].join(" ")}
                  >
                    <div className={styles.taskHeader}>
                      <span className={styles.taskTitle}>Drafting Task</span>
                      <span className={styles.statusBadge}>
                        {task.status.replaceAll("_", " ")}
                      </span>
                    </div>

                    <p className={styles.taskPrompt}>{task.prompt}</p>

                    {isThinking && (
                      <div className={styles.stateBlock}>
                        <TextShimmerWave className="text-sm" duration={1.1}>
                          Thinking through legal drafting strategy...
                        </TextShimmerWave>
                        <div className={styles.shimmerLine} />
                        <div className={styles.shimmerLineShort} />
                      </div>
                    )}

                    {task.clarificationHistory.length > 0 && (
                      <div className={styles.clarificationHistory}>
                        {task.clarificationHistory.map((pair, index) => (
                          <div key={`${task.id}-${index}`} className={styles.clarificationHistoryRow}>
                            <p><strong>Q:</strong> {pair.question}</p>
                            <p><strong>A:</strong> {pair.answer}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {isClarification && task.currentClarificationQuestion && (
                      <div className={styles.stateBlock}>
                        <p className={styles.clarificationQuestion}>{task.currentClarificationQuestion}</p>
                        <TextShimmerWave className="text-xs" duration={1}>
                          Awaiting clarification...
                        </TextShimmerWave>
                        <div className={styles.clarificationInputRow}>
                          <input
                            className={styles.clarificationInput}
                            value={clarificationInputs[task.id] || ""}
                            onChange={(e) => handleClarificationChange(task.id, e.target.value)}
                            placeholder="Enter clarification"
                          />
                          <button
                            className={styles.actionButton}
                            onClick={() => void handleDraftClarificationSubmit(task)}
                          >
                            Submit
                          </button>
                        </div>
                      </div>
                    )}

                    {isCompleted && (
                      <div className={styles.stateBlock}>
                        <div className={styles.completedBadge}>Completed</div>
                        {task.draftAnalysis && (
                          <p className={styles.analysisText}>{task.draftAnalysis}</p>
                        )}
                        {task.completedAt && (
                          <p className={styles.completionTime}>
                            Completed at {formatTime(task.completedAt)}
                          </p>
                        )}
                      </div>
                    )}

                    {isError && (
                      <div className={styles.stateBlock}>
                        <p className={styles.errorText}>Task failed. Please retry.</p>
                        <button
                          className={styles.retryButton}
                          onClick={() => void handleRetryDraftTask(task)}
                        >
                          Retry Task
                        </button>
                      </div>
                    )}
                  </div>
                  <span className={styles.timestamp}>{formatTime(task.createdAt)}</span>
                </div>
              </ChatBubble>
            )
          }

          // ---- Editing Task Card ----
          if (item.kind === "editTask") {
            const task = item.task
            const isThinking = task.status === "thinking"
            const isClarification = task.status === "clarification_required"
            const isCompleted = task.status === "edit_completed"
            const isError = task.status === "error"

            return (
              <ChatBubble key={item.id} variant="received">
                <ChatBubbleAvatar fallback="✐" />
                <div className={styles.taskWrap}>
                  <div
                    className={[
                      styles.editTaskCard,
                      isThinking ? styles.editTaskCardThinking : "",
                      isClarification ? styles.editTaskCardClarification : "",
                      isCompleted ? styles.editTaskCardCompleted : "",
                      isError ? styles.editTaskCardError : "",
                    ].join(" ")}
                  >
                    <div className={styles.taskHeader}>
                      <span className={styles.editTaskTitle}>
                        <span className={styles.editTaskIcon}>✐</span>
                        Editing Task
                      </span>
                      <span className={styles.editStatusBadge}>
                        {task.status.replaceAll("_", " ")}
                      </span>
                    </div>

                    <p className={styles.taskPrompt}>{task.prompt}</p>

                    {isThinking && (
                      <div className={styles.stateBlock}>
                        <TextShimmerWave className="text-sm" duration={1.1}>
                          Analysing document and planning edits...
                        </TextShimmerWave>
                        <div className={styles.editShimmerLine} />
                        <div className={styles.editShimmerLineShort} />
                      </div>
                    )}

                    {task.clarificationHistory.length > 0 && (
                      <div className={styles.clarificationHistory}>
                        {task.clarificationHistory.map((pair, index) => (
                          <div key={`${task.id}-${index}`} className={styles.clarificationHistoryRow}>
                            <p><strong>Q:</strong> {pair.question}</p>
                            <p><strong>A:</strong> {pair.answer}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {isClarification && task.currentClarificationQuestion && (
                      <div className={styles.stateBlock}>
                        <p className={styles.clarificationQuestion}>{task.currentClarificationQuestion}</p>
                        <TextShimmerWave className="text-xs" duration={1}>
                          Awaiting clarification...
                        </TextShimmerWave>
                        <div className={styles.clarificationInputRow}>
                          <input
                            className={styles.clarificationInput}
                            value={clarificationInputs[task.id] || ""}
                            onChange={(e) => handleClarificationChange(task.id, e.target.value)}
                            placeholder="Enter clarification"
                          />
                          <button
                            className={styles.actionButton}
                            onClick={() => void handleEditClarificationSubmit(task)}
                          >
                            Submit
                          </button>
                        </div>
                      </div>
                    )}

                    {isCompleted && (
                      <div className={styles.stateBlock}>
                        <div className={styles.editCompletedBadge}>
                          <span className={styles.editCompletedIcon}>✓</span>
                          Edits Applied
                        </div>
                        {task.completedAt && (
                          <p className={styles.completionTime}>
                            Applied at {formatTime(task.completedAt)}
                          </p>
                        )}
                      </div>
                    )}

                    {isError && (
                      <div className={styles.stateBlock}>
                        <p className={styles.errorText}>Edit failed. Please retry.</p>
                        <button
                          className={styles.retryButton}
                          onClick={() => void handleRetryEditTask(task)}
                        >
                          Retry Edit
                        </button>
                      </div>
                    )}
                  </div>
                  <span className={styles.timestamp}>{formatTime(task.createdAt)}</span>
                </div>
              </ChatBubble>
            )
          }

          return null
        })}
        <div ref={messagesEndRef} />
      </div>

      <div className={styles.inputArea}>
        <PromptInputBox
          onSend={(message) => void handleSend(message)}
          isLoading={isLoading}
          placeholder={editorHasContent()
            ? "Describe the edits you want to make..."
            : "Describe the legal draft you need..."}
          maxAttachments={3}
        />
      </div>
    </div>
  )
}
