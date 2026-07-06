import AI_Counsel_Convo from "../../../models/AI_Counsel_Convo.model.ts"
import saveChatMessage from "../helper_funcs/chatPersistence.service.js";
import { generateAIResponse } from "../../../services/AI_Counsel_basic_chat/ai.service.js";
import generateConversationTitle from "../../../services/AI_Counsel_basic_chat/titleGenerator.service.js";
import { runReasoning } from "../../../reasoning_pipeline/orchestrator.js";




export async function handleMessage(socket, raw) {

  console.log('📨 Raw WebSocket data:', raw);
  console.log('📨 Raw WebSocket data as string:', raw.toString());
  const payload = JSON.parse(raw.toString());  //ws msgs are bytecode

  // DECLARE userPrompt with const or let
  const attachments_id_array= payload.attachments;
  const userPrompt = payload.content;  // <-- FIXED HERE
  const chat_mode = payload.chat_mode;
  const reasoning_mode= payload.reasoning_mode;
  
  

  socket.msg_count++;

  // Save user message
  saveChatMessage({
    convo_id: socket.convo_id,
    sender: "User",
    content: userPrompt,  // <-- Use the declared variable
    attachments:attachments_id_array
    
  });

  // 3️⃣ ASYNC TITLE GENERATION (fire & forget)
  // ─────────────────────────────────────
  if (socket.msg_count === 1 && !socket.convo_title) {
    (async () => {
      try {
        const { title, description } =
          await generateConversationTitle(userPrompt);

        // update DB only if still unset (race-safe)
        const res = await AI_Counsel_Convo.updateOne(
          { _id: socket.convo_id },
          { title }
        );

        // update socket context if update succeeded
        if (res.modifiedCount === 1) {
          socket.convo_title = title;

          // optional: inform client
          if (socket.readyState === 1) {
            socket.send(
              JSON.stringify({
                type: "convo_title_updated",
                title,
              })
            );
          }
        }
      } catch (err) {

        console.error('Title generation error:', err.message);
      }
    })();
  }

  let aiResponse={};
  // Generate AI response according to chat mode
  if(chat_mode=="basic_chat"){
  aiResponse.text_content = await generateAIResponse(userPrompt);
  }else{
   aiResponse= await runReasoning(userPrompt, reasoning_mode);  // reasoning mode has 2 options high and low
  }



  // Save AI message
  saveChatMessage({
    convo_id: socket.convo_id,
    sender: "AI",
    content: aiResponse.text_content,
    discovered_laws: aiResponse.discovered_laws
  });



  // Send AI response to client
  if (socket.readyState === 1) {
    socket.send(
      JSON.stringify(
        { type: "ai_message", 
          content: aiResponse.text_content, 
          discovered_laws:aiResponse.discovered_laws?aiResponse.discovered_laws:[] 
        })
    );
  }
}