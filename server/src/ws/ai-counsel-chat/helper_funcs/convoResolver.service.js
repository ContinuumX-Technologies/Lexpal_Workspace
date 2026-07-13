import AI_Counsel_Convo from "../../../models/AI_Counsel_Convo.model.ts";
import mongoose from "mongoose";



/**
 * Ensures:
 * - conversation exists
 * - belongs to user
 
 */
export default async function resolveConversation({
  convoId,
  userId,
}) {
  if (!convoId || !mongoose.isValidObjectId(convoId)) {
    throw new Error("Conversation not found");
  }

  const convo = await AI_Counsel_Convo.findById(convoId);

  if (!convo) {
    throw new Error("Conversation not found");
  }

  if (!userId || !convo.user_id || convo.user_id.toString() !== userId) {
    throw new Error("Unauthorized conversation access");
  }

  return convo;
}
