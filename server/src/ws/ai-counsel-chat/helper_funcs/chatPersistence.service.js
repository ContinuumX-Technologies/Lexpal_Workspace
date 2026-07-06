import AI_Counsel_Message from "../../../models/AI_Counsel_Messages.model.ts";

/**
 * Save AI Counsel chat message
 */
export default async function saveChatMessage({
    convo_id,
    sender,
    content,
    attachments = [],
    discovered_laws = [],
    
}) {
    try {

        // Keep only required fields from discovered laws
        const transformed_discovered_laws = discovered_laws.map((law) => ({
            act_name: law.act_name,
            section_no: law.section_no,
            reasoning: law.reasoning,
            relevance_score: law.relevance_score,
        }));

        const message = await AI_Counsel_Message.create({
            convo_id,
            sender,
            content,
            attachments,
            discovered_laws: transformed_discovered_laws,
        });

        return message;
    }
    catch (err) {
        console.log("save ai counsel msg error:", err);
        return null;
    }
}