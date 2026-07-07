import { Request, Response } from "express";
import { searchEnrichmentMetadata } from "../search/enrichmentSearch.service";

export async function searchEnrichmentController(req: Request, res: Response) {
  try {
    const result = await searchEnrichmentMetadata(req.body || {});
    res.json(result);
  } catch (error: any) {
    console.error("Enrichment search failed:", error);
    res.status(500).json({
      error: "Enrichment metadata search failed",
      details: error.message,
    });
  }
}
