import { Router } from "express";
import multer from "multer";

import { draftspaceAIController } from "../controllers/draftspaceAI.controller";
import { judgementAnalyserController } from "../controllers/judgementAnalyser.controller";
import { importDocxController } from "../controllers/importDocx.controller";

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

const router = Router();

// POST /api/documents/generate

router.post("/draftspace-ai", draftspaceAIController);
router.post("/judgement-analyse", judgementAnalyserController);
router.post("/import-docx", upload.single("file"), importDocxController);

export default router;
