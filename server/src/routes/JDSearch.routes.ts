import { Router } from "express";

import { searchJudgements, getJudgementById } from "../controllers/JDSearch.controller";

const JDSearchRouter = Router();

// POST /api/documents/generate

JDSearchRouter.post("/search", searchJudgements);
JDSearchRouter.get("/:id", getJudgementById);
export default JDSearchRouter;