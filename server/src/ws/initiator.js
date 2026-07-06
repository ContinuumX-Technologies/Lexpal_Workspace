import { WebSocketServer } from "ws";
import AICounselChatGateway from "./ai-counsel-chat/AICounselChat.gateway.js";


export default function initWebSocketServer(server) {
  const AICounselwss = new WebSocketServer({ noServer: true });
  // const Chatwss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    
    if (req.url.startsWith("/ws/ai-counsel-chat")) {
      AICounselwss.handleUpgrade(req, socket, head, (ws) => {
        AICounselwss.emit("connection", ws, req);
      });
    }
    
    
    // else if (req.url.startsWith("/ws/user-chat")) {
    //   Chatwss.handleUpgrade(req, socket, head, (ws) => {
    //     Chatwss.emit("connection", ws, req);
    //   });
    // } 
    
    else {
      socket.destroy();
    }


  });

  AICounselChatGateway(AICounselwss);
  // userChatGateway(Chatwss);
}