import { Router } from "express";

import { draftspaceAIController } from "../controllers/draftspaceAI.controller";

const router = Router();

// POST /api/documents/generate

router.post("/draftspace-ai", draftspaceAIController);
export default router;
