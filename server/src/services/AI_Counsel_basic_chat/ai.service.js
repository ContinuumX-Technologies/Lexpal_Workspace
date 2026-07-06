import { decideQueryRoute } from "./chatRouting.service.js";
import { extractLawMetadata } from "./metadataExtractor.service.js";
import { shouldUseLegalData } from "./dataQueryDecision.service.js";

import {
  generateExactLawResponse,
  generateDataDrivenChatResponse,
  generatePureChatResponse,
} from "./responseComposer.service.js";

import { getOrCreateChromaCollection } from "../../infra/chroma.client.ts";

export async function generateAIResponse(userQuery) {

  const route = await decideQueryRoute(userQuery);
  console.log(route);

  const collection = await getOrCreateChromaCollection("Indian_Law_Acts");

  // EXACT LAW QUERY

  if (route === "EXACT_LAW_QUERY") {

    const metadata = await extractLawMetadata(userQuery);

    const where = {};

    Object.entries(metadata).forEach(([k, v]) => {
      if (v) where[k] = v;
    });

    // Vanilla Chroma query
    const results = await collection.query({
      queryTexts: [userQuery],
      nResults: 5,
      where: Object.keys(where).length ? where : undefined,
    });

    const chunks =
      results.documents?.[0]?.map((doc, index) => ({
        document: doc,
        metadata: results.metadatas?.[0]?.[index],
        id: results.ids?.[0]?.[index],
        distance: results.distances?.[0]?.[index],
      })) || [];

    return generateExactLawResponse(metadata, chunks);
  }

  // CHAT QUERY

  const needsData = await shouldUseLegalData(userQuery);
  console.log(needsData);

  if (!needsData) {
    return generatePureChatResponse(userQuery);
  }

  // Vanilla Chroma query
  const results = await collection.query({
    queryTexts: [userQuery],
    nResults: 5,
  });

  const chunks =
    results.documents?.[0]?.map((doc, index) => ({
      document: doc,
      metadata: results.metadatas?.[0]?.[index],
      id: results.ids?.[0]?.[index],
      distance: results.distances?.[0]?.[index],
    })) || [];

  console.log(chunks);

  return generateDataDrivenChatResponse(userQuery, chunks);
}