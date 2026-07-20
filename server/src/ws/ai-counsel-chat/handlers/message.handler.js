import AI_Counsel_Convo from "../../../models/AI_Counsel_Convo.model.ts";
import saveChatMessage from "../helper_funcs/chatPersistence.service.js";
import { generateAIResponse } from "../../../services/AI_Counsel_basic_chat/ai.service.js";
import generateConversationTitle from "../../../services/titleGenerator.service.js";
import { runReasoning } from "../../../reasoning_pipeline/orchestrator.js";
import resolveConversation from "../helper_funcs/convoResolver.service.js";
import { performAIWebResearch } from "../../../services/llm_websearch.ts";

const NEW_CONVERSATION_ID = "new";
const titleGenerationLocks = new Map();

const isNonEmptyString = (value) => {
  return typeof value === "string" && value.trim().length > 0;
};

const normalizeAttachmentIds = (rawAttachments) => {
  if (!Array.isArray(rawAttachments)) {
    return [];
  }

  return rawAttachments
    .map((item) => (isNonEmptyString(item) ? item.trim() : ""))
    .filter(Boolean);
};

const normalizeAttachmentMetadata = (rawMetadata) => {
  if (!Array.isArray(rawMetadata)) {
    return [];
  }

  return rawMetadata
    .map((entry) => {
      const id = isNonEmptyString(entry?.id) ? entry.id.trim() : "";
      const file_name = isNonEmptyString(entry?.file_name)
        ? entry.file_name.trim()
        : "";

      if (!id || !file_name) {
        return null;
      }

      return {
        id,
        file_name,
        size:
          typeof entry?.size === "number" &&
            Number.isFinite(entry.size) &&
            entry.size >= 0
            ? entry.size
            : 0,
        mime_type:
          typeof entry?.mime_type === "string" ? entry.mime_type.trim() : "",
      };
    })
    .filter((entry) => entry !== null);
};



const sendSocketMessage = (socket, payload) => {
  if (socket.readyState !== 1) {
    return;
  }

  socket.send(JSON.stringify(payload));
};



const normalizeConvoId = (rawConvoId) => {
  if (!isNonEmptyString(rawConvoId)) {
    return null;
  }

  return rawConvoId.trim();
};



const isBlankTitle = (value) => {
  return typeof value !== "string" || value.trim().length === 0;
};




const getSocketConvoTitle = (value) => {
  if (typeof value !== "string") {
    return "";
  }

  return value;
};





const createConversationForSocket = async (socket) => {
  if (socket.pending_new_convo) {
    return socket.pending_new_convo;
  }

  const creationPromise = AI_Counsel_Convo.create({
    user_id: socket.user_id,
    title: "",
  }).then((convo) => {
    socket.convo_id = convo._id.toString();
    socket.convo_title = getSocketConvoTitle(convo.title);

    sendSocketMessage(socket, {
      type: "convo_created",
      convo_id: socket.convo_id,
      title: socket.convo_title,
    });

    return convo;
  }).finally(() => {
    if (socket.pending_new_convo === creationPromise) {
      socket.pending_new_convo = null;
    }
  });

  socket.pending_new_convo = creationPromise;
  return creationPromise;
};










const resolveConversationForMessage = async ({ socket, requestedConvoId }) => {

  socket.convo_id = requestedConvoId;

  if (socket.convo_id === NEW_CONVERSATION_ID) {


    const convo = await createConversationForSocket(socket);
    socket.convo_id = convo._id.toString();
    return {
      convo,
      convoId: convo._id.toString(),
    };
  }

  else {
    const convo = await resolveConversation({
      convoId: socket.convo_id,
      userId: socket.user_id,
    });


    socket.convo_title = getSocketConvoTitle(convo.title);

    return {
      convo,
      convoId: socket.convo_id,
    };
  }



};






const scheduleConversationTitleGeneration = ({ socket, convoId, userPrompt }) => {
  if (!convoId || titleGenerationLocks.has(convoId)) {
    return;
  }

  const titleGenerationTask = (async () => {
    const latestConvo = await AI_Counsel_Convo.findOne({
      _id: convoId,
      user_id: socket.user_id,
    }).select({ title: 1 });

    if (!latestConvo || !isBlankTitle(latestConvo.title)) {
      if (latestConvo && !isBlankTitle(latestConvo.title)) {
        socket.convo_title = getSocketConvoTitle(latestConvo.title);
      }
      return;
    }

    const { title } = await generateConversationTitle(userPrompt);
    const nextTitle = isNonEmptyString(title) ? title.trim() : "";

    if (!nextTitle) {
      return;
    }

    const updateResult = await AI_Counsel_Convo.updateOne(
      {
        _id: convoId,
        user_id: socket.user_id,
        $or: [
          { title: { $exists: false } },
          { title: null },
          { title: "" },
          { title: /^\s*$/ },
        ],
      },
      {
        $set: {
          title: nextTitle,
        },
      }
    );

    if (updateResult.modifiedCount === 1) {
      socket.convo_title = nextTitle;

      sendSocketMessage(socket, {
        type: "convo_title_updated",
        convo_id: convoId,
        title: nextTitle,
      });
    }
  })().catch(() => {
    // title generation failures should not block chat responses
  }).finally(() => {
    titleGenerationLocks.delete(convoId);
  });

  titleGenerationLocks.set(convoId, titleGenerationTask);
};







export async function handleMessage(socket, raw) {
  if (!socket || !socket.user_id) {
    sendSocketMessage(socket, {
      type: "error",
      code: "UNAUTHORIZED",
      message: "Unauthorized acces to socket message handler",
    });
    return;
  }

  let payload;


  try {
    payload = JSON.parse(raw.toString());
  } catch {
    sendSocketMessage(socket, {
      type: "error",
      code: "INVALID_PAYLOAD",
      message: "invalid WebSocket payload",
    });
    return;
  }

  const userPrompt = isNonEmptyString(payload.content) ? payload.content.trim() : "";
  const chatMode = payload.chat_mode === "reasoning_chat" ? "reasoning_chat" : "basic_chat";
  const reasoningMode = payload.reasoning_mode === "deep" ? "deep" : "lite";
  const attachments = normalizeAttachmentIds(payload.attachments);
  const attachmentMetadata = normalizeAttachmentMetadata(payload.attachment_metadata);
  const clientMessageId =
    isNonEmptyString(payload.client_message_id) ? payload.client_message_id.trim() : null;
  const requestedConvoId = normalizeConvoId(payload.convo_id);
  const webSearchRequired = payload.web_search;

  if (!userPrompt) {
    sendSocketMessage(socket, {
      type: "error",
      code: "EMPTY_PROMPT",
      message: "message content is required",
    });
    return;
  }

  if (!requestedConvoId) {
    sendSocketMessage(socket, {
      type: "error",
      code: "EMPTY_CONVO_ID",
      message: "convo_id is required"
    })
  }

  if (socket.is_processing) {
    sendSocketMessage(socket, {
      type: "error",
      code: "PROCESSING_IN_PROGRESS",
      message: "Please wait for the current response",
    });
    return;
  }

  socket.is_processing = true;


  try {





    const { convo, convoId } = await resolveConversationForMessage({
      socket,
      requestedConvoId,
    });

    socket.msg_count += 1;

    const savedUserMessage = await saveChatMessage({
      convo_id: convoId,
      sender: "User",
      content: userPrompt,
      client_message_id: clientMessageId,
      attachments,
      attachment_metadata: attachmentMetadata,
    });

    if (!savedUserMessage) {
      throw new Error("Failed to persist user message");
    }

    sendSocketMessage(socket, {
      type: "message_ack",
      role: "User",
      message_id: savedUserMessage._id?.toString?.() || null,
      client_message_id: clientMessageId,
      convo_id: convoId,
    });

    if (isBlankTitle(convo?.title)) {
      scheduleConversationTitleGeneration({
        socket,
        convoId,
        userPrompt,
      });
    }


    let finalPrompt = userPrompt;




    // web search 
    let webResearch;

    console.log(webSearchRequired);

    if (webSearchRequired) {
      webResearch = await performAIWebResearch(userPrompt);

      console.log(webResearch.content);

      finalPrompt = `
==================== WEB RESEARCH ====================

The following information was gathered from the web by a dedicated web search agent in response to the user's query.

INSTRUCTIONS:

1. Treat the information below as supplemental evidence, not as authoritative truth.

2. Compare every factual claim with your internal knowledge base.

3. If your internal knowledge confirms a claim from the web research, present it confidently as part of your answer without mentioning the web research.

4. If your internal knowledge does not contain enough information to verify a claim, you may still use the web research, but explicitly tell the user that "Web search found..." or "According to information gathered from the web...".

5. If the web research contradicts your internal knowledge, explicitly mention both viewpoints. For example:

   - "The web search indicates A."

   - "However, my internal knowledge indicates B."

   - "Because these sources disagree, please interpret this information with appropriate caution."

6. Never silently merge conflicting information or present an unverified web claim as a confirmed fact.

INFORMATION FROM THE WEB:

${webResearch.content}

================== END WEB RESEARCH ==================

${userPrompt}
`.trim();
    }



    let aiResponse = {};



    if (chatMode === "basic_chat") {
      const textContent = await generateAIResponse(finalPrompt);
      aiResponse = {
        text_content: textContent,
        discovered_laws: [],
      };
    } else {
      aiResponse = await runReasoning(finalPrompt, reasoningMode);
    }




    const aiContent =
      typeof aiResponse.text_content === "string" ? aiResponse.text_content : "";
    const discoveredLaws = Array.isArray(aiResponse.discovered_laws)
      ? aiResponse.discovered_laws
      : [];

    console.log(aiContent);




    const savedAiMessage = await saveChatMessage({
      convo_id: convoId,
      sender: "AI",
      content: aiContent,
      discovered_laws: discoveredLaws,
      client_message_id: crypto.randomUUID(),
      web_research: webResearch? webResearch: null
    });



    if (!savedAiMessage) {
      throw new Error("Failed to persist AI message");
    } else console.log(savedAiMessage);



    sendSocketMessage(socket, {
      type: "ai_message",
      convo_id: convoId,
      content: aiContent,
      discovered_laws: discoveredLaws,
      message_id: savedAiMessage._id?.toString?.() || null,
      web_sources: webResearch?webResearch.sources:null
      
    });




  } catch (err) {

    console.error(err);

    sendSocketMessage(socket, {
      type: "error",
      code: "MESSAGE_PROCESSING_FAILED",
      message: "Unable to process message",
    });

  } finally {
    socket.is_processing = false;
  }
}
