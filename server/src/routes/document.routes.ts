import { Router } from "express";
import multer from "multer";

import { createDraft as draftspaceAITaskManagerController, analyzeDraftController } from "../controllers/draftspaceAITaskManager.controller";
import { judgementAnalyserController } from "../controllers/judgementAnalyser.controller";
import { importDocxController } from "../controllers/importDocx.controller";
import { editingController } from "../controllers/draftEdit.controller";

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

const router = Router();

// POST /api/documents/generate

router.post("/draftspace-ai", draftspaceAITaskManagerController);
router.post("/draftspace/edit",editingController)
router.post("/judgement-analyse", judgementAnalyserController);
router.post("/import-docx", upload.single("file"), importDocxController);


router.post("/analyze", analyzeDraftController);

export default router;
