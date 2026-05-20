import { Router } from "express";
import multer from "multer";
import { uploadFirmPrecedent, searchFirmPrecedents } from "../controllers/firmPrecedent.controller";

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } 
});

const router = Router();

router.post("/upload", upload.single("file"), uploadFirmPrecedent);
router.post("/search", searchFirmPrecedents);

export default router;
