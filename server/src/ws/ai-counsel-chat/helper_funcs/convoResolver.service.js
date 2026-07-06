import AI_Counsel_Convo from "../../../models/AI_Counsel_Convo.model.ts";



/**
 * Ensures:
 * - conversation exists
 * - belongs to user
 
 */
export default async function resolveConversation({
  convoId
  // userId,
}) {
  // ─────────────────────────────────────
  // CASE 1: Existing conversation requested
  // ─────────────────────────────────────
  
    const convo = await AI_Counsel_Convo.findById(convoId);

    if (!convo) {
      throw new Error("Conversation not found");
    }

    // if (convo.user_id.toString() !== userId) {
    //   throw new Error("Unauthorized conversation access");
    // }

    return convo;
  


}