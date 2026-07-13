import { Request, Response } from "express";
import {
  getOwnedConversationMessages,
  listUserConversations,
  lookupLawByActAndSection,
} from "../services/aiCounsel.service";

type AuthenticatedRequest = Request & {
  user?: {
    id?: string;
  };
};

const respondUnauthorized = (res: Response) => {
  return res.status(401).json({
    message: "Unauthorized",
    errorCode: "UNAUTHORIZED",
  });
};

export const listConversationsController = async (
  req: Request,
  res: Response
) => {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user?.id;

  if (!userId) {
    return respondUnauthorized(res);
  }

  try {
    const conversations = await listUserConversations(userId);

    return res.status(200).json({
      conversations,
    });
  } catch {
    return res.status(500).json({
      message: "Failed to fetch conversations",
      errorCode: "CONVERSATION_LIST_FAILED",
    });
  }
};

export const getConversationMessagesController = async (
  req: Request,
  res: Response
) => {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user?.id;

  if (!userId) {
    return respondUnauthorized(res);
  }

  const conversationId =
    typeof req.params.conversationId === "string"
      ? req.params.conversationId.trim()
      : "";

  if (!conversationId) {
    return res.status(400).json({
      message: "conversationId is required",
      errorCode: "INVALID_CONVERSATION_ID",
    });
  }

  try {
    const messages = await getOwnedConversationMessages(conversationId, userId);

    if (!messages) {
      return res.status(404).json({
        message: "Conversation not found",
        errorCode: "CONVERSATION_NOT_FOUND",
      });
    }

    return res.status(200).json({
      messages,
    });
  } catch {
    return res.status(500).json({
      message: "Failed to fetch conversation messages",
      errorCode: "CONVERSATION_MESSAGES_FAILED",
    });
  }
};

export const lookupLawSectionController = async (
  req: Request,
  res: Response
) => {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user?.id;

  if (!userId) {
    return respondUnauthorized(res);
  }

  const actName =
    typeof req.query.act_name === "string" ? req.query.act_name.trim() : "";
  const sectionNo =
    typeof req.query.section_no === "string"
      ? req.query.section_no.trim()
      : "";

  if (!actName || !sectionNo) {
    return res.status(400).json({
      message: "act_name and section_no are required",
      errorCode: "INVALID_LAW_LOOKUP_INPUT",
    });
  }

  try {
    const law = await lookupLawByActAndSection(actName, sectionNo);

    if (!law) {
      return res.status(404).json({
        message: "Law section not found",
        errorCode: "LAW_SECTION_NOT_FOUND",
      });
    }

    return res.status(200).json({
      law,
    });
  } catch {
    return res.status(500).json({
      message: "Failed to fetch law section",
      errorCode: "LAW_LOOKUP_FAILED",
    });
  }
};

