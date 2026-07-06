// controllers/laws/getSectionsController.js

import { getOrCreateChromaCollection } from "../infra/chroma.client.js"; // adjust path

const COLLECTION_NAME="Indian_Law_Acts"

export const getSectionsController = async (req, res) => {
  try {
    const { sections } = req.body;

    /*
      Expected body:
      {
        "sections": [
          {
            "act_name": "Indian Penal Code",
            "section_no": "420"
          },
          {
            "act_name": "Constitution of India",
            "section_no": "21"
          }
        ]
      }
    */

    if (!Array.isArray(sections) || sections.length === 0) {
      return res.status(400).json({
        success: false,
        message: "sections array is required",
      });
    }

    const collection = await getOrCreateChromaCollection(COLLECTION_NAME);

    const finalResults = [];

    for (const item of sections) {
      const { act_name, section_no } = item;

      if (!act_name || !section_no) continue;

      // fetch all chunks matching same act + section
      const results = await collection.get({
        where: {
          $and: [
            { act_name: act_name },
            { section_no: section_no },
          ],
        },
        include: ["documents", "metadatas"],
      });

      if (!results || !results.ids || results.ids.length === 0) {
        finalResults.push({
          act_name,
          section_no,
          found: false,
          content: null,
        });

        continue;
      }

      // combine split chunks
      const combinedContent = results.documents
        .map((doc) => doc || "")
        .join("\n");

      finalResults.push({
        act_name,
        section_no,
        found: true,
        content: combinedContent,
        chunks_count: results.ids.length,
        metadata: results.metadatas?.[0] || {},
      });
    }

    return res.status(200).json({
      success: true,
      count: finalResults.length,
      data: finalResults,
    });
  } catch (error) {
    console.error("getSectionsController error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch sections",
      error: error.message,
    });
  }
};