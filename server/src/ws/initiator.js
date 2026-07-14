import { WebSocketServer } from "ws";
import AICounselChatGateway from "./ai-counsel-chat/AICounselChat.gateway.js";
import { authenticateWebSocketRequest } from "./ai-counsel-chat/helper_funcs/wsAuth.service.js";


export default function initWebSocketServer(server) {
  const AICounselwss = new WebSocketServer({ noServer: true });
  // const Chatwss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
     console.log("Upgrade:", req.url);
    if (req.url.startsWith("/ws/ai-counsel-chat")) {
      const wsAuth = authenticateWebSocketRequest(req);

      if (!wsAuth) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }

      req.wsAuth = wsAuth;

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
