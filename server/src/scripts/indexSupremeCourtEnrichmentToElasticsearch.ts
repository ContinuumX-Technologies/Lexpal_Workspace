import dotenv from "dotenv";
dotenv.config();

import { MongoClient } from "mongodb";
import {
  bulkIndexEnrichments,
  createEnrichmentIndex,
  deleteEnrichmentIndex,
  normalizeEnrichmentDocument,
  setEnrichmentIndexSearchMode,
  setEnrichmentIndexWriteMode,
} from "../search/enrichmentIndex.service";

const mongoUrl = process.env.MONGO_CONNECTION_URL;
const dbName = process.env.MONGO_DB_NAME || "Lexpal_Workspace";
const enrichmentCollectionName =
  process.env.ENRICHMENT_COLLECTION || "supreme_court_enrichement";

if (!mongoUrl) {
  console.error("Please set MONGO_CONNECTION_URL in server/.env");
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const has = (flag: string) => args.includes(flag);
  const value = (flag: string) => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };

  return {
    limit: has("--all") ? 0 : Number(value("--limit") || "1000"),
    batchSize: Number(value("--batchSize") || "1000"),
    concurrency: Number(value("--concurrency") || "3"),
    recreate: has("--recreate"),
    keepWriteMode: has("--keep-write-mode"),
  };
}

async function main() {
  const options = parseArgs();
  const client = new MongoClient(mongoUrl as string);
  await client.connect();

  try {
    if (options.recreate) {
      console.log("Recreating enrichment Elasticsearch index...");
      await deleteEnrichmentIndex();
    }

    await createEnrichmentIndex();
    await setEnrichmentIndexWriteMode();

    const collection = client.db(dbName).collection(enrichmentCollectionName);
    const total = options.limit || await collection.countDocuments({});
    const findCursor = collection.find({}).sort({ _id: 1 });
    if (options.limit > 0) findCursor.limit(options.limit);
    const cursor = findCursor.batchSize(options.batchSize);

    let batch: any[] = [];
    let indexed = 0;
    let failed = 0;
    let submitted = 0;
    const startedAt = Date.now();
    const inFlight = new Set<Promise<void>>();

    async function submitBatch(docs: any[]) {
      submitted += docs.length;
      const job = bulkIndexEnrichments(docs)
        .then((result) => {
          indexed += result.indexed;
          failed += result.errors.length;
          const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 1);
          const rate = Math.round(indexed / elapsedSeconds);
          console.log(
            `[BULK] submitted=${submitted}/${total}, indexed=${indexed}, failed=${failed}, rate=${rate}/s`
          );
          if (result.errors.length) {
            console.error(JSON.stringify(result.errors.slice(0, 3), null, 2));
          }
        })
        .finally(() => {
          inFlight.delete(job);
        });

      inFlight.add(job);

      if (inFlight.size >= options.concurrency) {
        await Promise.race(inFlight);
      }
    }

    for await (const doc of cursor) {
      batch.push(normalizeEnrichmentDocument(doc));

      if (batch.length >= options.batchSize) {
        await submitBatch(batch);
        batch = [];
      }
    }

    if (batch.length) {
      await submitBatch(batch);
    }

    await Promise.all(inFlight);

    if (!options.keepWriteMode) {
      await setEnrichmentIndexSearchMode();
    }

    const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 1);
    console.log(
      `[DONE] indexed=${indexed}, failed=${failed}, elapsed=${elapsedSeconds.toFixed(1)}s`
    );
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
