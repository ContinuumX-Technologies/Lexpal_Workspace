import { Router } from "express";
import { searchEnrichmentController } from "../controllers/enrichmentSearch.controller";

const enrichmentSearchRouter = Router();

enrichmentSearchRouter.post("/search", searchEnrichmentController);

export default enrichmentSearchRouter;
