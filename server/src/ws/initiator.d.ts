import type { Server as HTTPServer } from "http";

declare function initWebSocketServer(server: HTTPServer): void;

export default initWebSocketServer;
