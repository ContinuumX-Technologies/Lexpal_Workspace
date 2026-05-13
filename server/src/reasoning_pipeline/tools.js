import { getOrCreateChromaCollection } from "../infra/chroma.client";

const COLLECTION = "Indian_Law_Acts";


//vector search tool call
export async function searchLaw({ queries, act_name }) {
  const collection = await getOrCreateChromaCollection(COLLECTION);

  const results = {};

  for (const query of queries) {
    const res = await collection.query({
      queryTexts: [query],
      nResults: 3,
      where: act_name ? { act_name } : undefined
    });

    const chunks = [];

    const docs = res.documents?.[0] || [];
    const metas = res.metadatas?.[0] || [];

    for (let i = 0; i < docs.length; i++) {
      chunks.push({
        text: docs[i],
        metadata: metas[i]
      });
    }

    results[query] = chunks;
  }

  return results;
}




//exact law lookup
export async function lookupLaw({ act_name, section_no }) {
  const collection = await getOrCreateChromaCollection(COLLECTION);

  const res = await collection.get({
    where: {
      act_name,
      section_no
    },
    include: ["documents", "metadatas"],
    limit: 5
  });

  const docs = res.documents || [];
  const metas = res.metadatas || [];

  const results = [];

  for (let i = 0; i < docs.length; i++) {
    results.push({
      text: docs[i],
      metadata: metas[i]
    });
  }

  return results;
}



//get all act chunks or all chapter chunks
export async function getLaw({ act_name, chapter_name }) {
  const collection = await getOrCreateChromaCollection(COLLECTION);

  const where = {
    act_name
  };

  if (chapter_name) {
    where.chapter_name = chapter_name;
  }

  const res = await collection.get({
    where,
    include: ["documents", "metadatas"],
    limit: 50 // safeguard
  });

  const docs = res.documents || [];
  const metas = res.metadatas || [];

  const results = [];

  for (let i = 0; i < docs.length; i++) {
    results.push({
      text: docs[i],
      metadata: metas[i]
    });
  }

  return results;
}
