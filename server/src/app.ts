import express from "express";
import cors from "cors";
import documentRoutes from "./routes/document.routes";
import JDSearchRouter from "./routes/JDSearch.routes";
import firmPrecedentRoutes from "./routes/firmPrecedent.routes";
import authRoutes from "./routes/auth.routes.js";

const app = express();

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(cors({ origin: "http://localhost:5173", credentials: true }));
app.use(express.json({ limit: '10mb' }));

// ── Health check ───────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
});

// ── Routes ─────────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);


app.use("/api/documents", documentRoutes);
app.use("/api/judgements", JDSearchRouter);
app.use("/api/firm-precedents", firmPrecedentRoutes);


export default app;
