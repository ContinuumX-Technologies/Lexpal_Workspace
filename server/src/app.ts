import express from "express";
import cors from "cors";
import documentRoutes from "./routes/document.routes";
import JDSearchRouter from "./routes/JDSearch.routes";

const app = express();

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(cors({ origin: "http://localhost:5173", credentials: true }));
app.use(express.json());

// ── Health check ───────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
});

// ── Routes ─────────────────────────────────────────────────────────────────
app.use("/api/documents", documentRoutes);
app.use("/api/judgements", JDSearchRouter);


export default app;
