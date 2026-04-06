import { Router } from "express";

import { draftspaceAIController } from "../controllers/draftspaceAI.controller";
import { judgementAnalyserController } from "../controllers/judgementAnalyser.controller";



const router = Router();

// POST /api/documents/generate

router.post("/draftspace-ai", draftspaceAIController);
router.post("/judgement-analyse", judgementAnalyserController);


export default router;
