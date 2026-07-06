import connectDB from "./src/infra/mongo.db"
import initWebSocketServer from "./src/ws/initiator.js";
import dotenv from "dotenv";
dotenv.config();

import http from "http";
import app from "./src/app";


const PORT = process.env.PORT ?? 3001;

const server = http.createServer(app);

initWebSocketServer(server);

// WebSocket server can be attached here in the future:



server.listen(PORT, () => {
    console.log(`[server] HTTP server running on http://localhost:${PORT}`);
    connectDB();
});
