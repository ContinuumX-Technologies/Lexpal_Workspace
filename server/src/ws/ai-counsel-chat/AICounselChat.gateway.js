import { handleMessage } from "./handlers/message.handler.js";
import resolveConversation from "./helper_funcs/convoResolver.service.js";
import { URL } from "url";

const NEW_CONVERSATION_ID = "new";

export default function AICounselChatGateway(wss) {

  wss.on("connection", async (socket, req) => {

    try {
      socket.msg_count = 0;
      socket.convo_id = null;
      socket.convo_title = null;
      socket.user_id = req.wsAuth?.userId || null;

      if (!socket.user_id) {
        socket.close(1008, "Unauthorized");
        return;
      }


      const url = new URL(req.url, "http://localhost");


      const convoId = url.searchParams.get("convo_id")?.trim() || "";


      if (convoId && convoId !== NEW_CONVERSATION_ID) {
        const convo = await resolveConversation({
          convoId,
          userId: socket.user_id,
        });

        socket.convo_id = convo._id.toString();
        socket.convo_title = convo.title || null;
      } else {
        socket.convo_id = null;
        socket.convo_title = null;
      }

      
      socket.pending_new_convo = null;
      socket.title_generation_in_flight = false;



      socket.on("message", (data) => {
        handleMessage(socket, data);
      });





    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Internal server error";

      console.log(errorMessage);

      if (errorMessage.includes("Unauthorized")) {
        socket.close(1008, "Unauthorized");
        return;
      }

      if (errorMessage.includes("Conversation not found")) {
        socket.close(1008, "Conversation not found");
        return;
      }

      socket.close(1011, "Internal server error");


    }
  });
}
