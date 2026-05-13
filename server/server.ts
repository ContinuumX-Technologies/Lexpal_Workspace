

import dotenv from "dotenv";
dotenv.config();

import http from "http";
import app from "./src/app";


const PORT = process.env.PORT ?? 3001;

const server = http.createServer(app);

// WebSocket server can be attached here in the future:
// import { WebSocketServer } from "ws";
// const wss = new WebSocketServer({ server });

server.listen(PORT, () => {
    console.log(`[server] HTTP server running on http://localhost:${PORT}`);
});
