import { handleMessage } from "./handlers/message.handler.js";
import resolveConversation from "./helper_funcs/convoResolver.service.js";
import AI_Counsel_Convo from "../../models/AI_Counsel_Convo.model";
import { URL } from "url";

export default function AICounselChatGateway(wss) {

  wss.on("connection", async (socket, req) => {

    try {

      console.log("WS CONNECTED");

      socket.msg_count = 0;

      const url = new URL(req.url, "http://localhost");

      const convoId = url.searchParams.get("convo_id");

      let convo;

      if (convoId === "new") {

        convo = await AI_Counsel_Convo.create({
          user_id: "6831d6e12f6f97c3f7fbc1aa", //replace with user_id recieved from auth middleware
          title: null,
        });

      } else {

        convo = await resolveConversation({
          convoId,
        });

      }

      console.log(convo);

      socket.convo_id = convo._id.toString();

      if (convo.title != null) {
        socket.convo_title = convo.title;
      }

      socket.on("message", (data) => {
        handleMessage(socket, data);
      });

    } catch (err) {

      console.error("AI COUNSEL WS ERROR:");
      console.error(err);

      socket.close(1011, "Internal server error");
    }
  });
}