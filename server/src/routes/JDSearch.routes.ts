import { Router } from "express";

import { searchJudgements } from "../controllers/JDSearch.controller";

const JDSearchRouter = Router();

// POST /api/documents/generate

JDSearchRouter.post("/search-judgements", searchJudgements);
export default JDSearchRouter;