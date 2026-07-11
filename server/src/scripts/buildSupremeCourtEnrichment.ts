import dotenv from "dotenv";
dotenv.config();

import * as cheerio from "cheerio";
import * as zlib from "zlib";
import { Binary, MongoClient, ObjectId } from "mongodb";

const mongoUrl = process.env.MONGO_CONNECTION_URL;
const dbName = process.env.MONGO_DB_NAME || "Lexpal_Workspace";
const sourceCollectionName = process.env.JUDGMENTS_COLLECTION || "supreme_court_judgements";
const enrichmentCollectionName = process.env.ENRICHMENT_COLLECTION || "supreme_court_enrichement";

if (!mongoUrl) {
  console.error("Please set MONGO_CONNECTION_URL in server/.env");
  process.exit(1);
}

interface CitedJudgment {
  docId: string;
  title: string;
}

interface CitedLaw {
  docId: string;
  section_no: string;
  act_name: string;
  act_year: number | null;
  citation_text: string;
}

interface EnrichmentDocument {
  _id: ObjectId;
  source_docId: string;
  title: string;
  year: number | null;
  bench: string[];
  keywords: string[];
  equivalent_citation: string[];
  subject_areas: string[];
  cited_judgements: CitedJudgment[];
  cited_laws: CitedLaw[];
}

const LEGAL_ACT_NAME =
  "([A-Z][A-Za-z'&.,-]*(?:\\s+(?:of\\s+)?[A-Za-z'&.,-]+){0,6}?\\s+(?:Act|Code|Constitution))";

// --- Global Cache for Document Titles to minimize DB/Web hits ---
const docTitleCache = new Map<string, string>();

function normalizeWhitespace(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = normalizeWhitespace(value);
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

function getBinaryBuffer(value: unknown): Buffer | null {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Binary) return Buffer.from(value.buffer);
  if (value instanceof Uint8Array) return Buffer.from(value);
  const maybeBinary = value as { buffer?: Buffer | Uint8Array };
  if (maybeBinary.buffer) return Buffer.from(maybeBinary.buffer);
  return null;
}

function decodeHtmlContent(value: unknown): string {
  if (typeof value === "string") return value;
  const buffer = getBinaryBuffer(value);
  if (!buffer) return "";
  const isGzip = buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  if (!isGzip) return buffer.toString("utf8");
  return zlib.gunzipSync(buffer).toString("utf8");
}

function splitList(value: string): string[] {
  return unique(
    value.split(/,|;|\band\b/i).map((part) => part.replace(/^Bench\s*:/i, "").trim()).filter(Boolean)
  );
}

function extractYear(title: string, fullText: string): number | null {
  const match = title.match(/\b((?:18|19|20)\d{2})\b/) || fullText.match(/\b((?:18|19|20)\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function extractEquivalentCitations($: cheerio.CheerioAPI, fullText: string): string[] {
  const citationText = normalizeWhitespace(
    $(".doc_citations, .citation-chip").toArray().map((element) => $(element).text()).join(", ")
  ).replace(/^Equivalent citations\s*:/i, "").replace(/^Citations\s*:/i, "");

  const citations = citationText.split(",");
  const patterns = [
    /\bAIR\s+(?:18|19|20)\d{2}\s+SC\s+\d+\b/gi,
    /\b(?:18|19|20)\d{2}\s+INSC\s+\d+\b/gi,
    /\b\((?:18|19|20)\d{2}\)\s+\d+\s+SCC\s+\d+\b/gi,
    /\b(?:18|19|20)\d{2}\s+\(\d+\)\s+SCALE\s+\d+\b/gi,
    /\[(?:18|19|20)\d{2}\]\s*SUPP\s*SCR\s*\d+\b/gi,
    /\b(?:18|19|20)\d{2}\s+Supp\s+SCR\s+\d+\b/gi,
    /\b\[(?:18|19|20)\d{2}\]\s+\d+\s+SCR\s+\d+\b/gi,
  ];

  for (const pattern of patterns) {
    citations.push(...Array.from(fullText.matchAll(pattern), (match) => match[0]));
  }
  return unique(citations);
}

function extractActs(fullText: string): string[] {
  const acts = Array.from(
    fullText.matchAll(new RegExp(`\\b(?:the\\s+)?${LEGAL_ACT_NAME}(?:,?\\s+(?:18|19|20)\\d{2})?\\b`, "g")),
    (match) => match[1]
  );
  return unique(acts.map((act) => act.replace(/^(the|under|of)\s+/i, "")));
}

// -----------------------------------------------------------------------------
// NEW: Title Resolution Logic (Cache -> DB -> Web Fetch)
// -----------------------------------------------------------------------------
async function resolveActNameFromDocId(docId: string, sourceCollection: any): Promise<string | null> {
  if (docTitleCache.has(docId)) return docTitleCache.get(docId) || null;

  // 1. Try local DB first
  try {
    const dbDoc = await sourceCollection.findOne({ "source.docId": docId }, { projection: { title: 1 } });
    if (dbDoc && dbDoc.title) {
      docTitleCache.set(docId, dbDoc.title);
      return dbDoc.title;
    }
  } catch (err) {
    console.error(`DB lookup failed for ${docId}`);
  }

  // 2. Try fetching from Indian Kanoon (Fallback)
  try {
    const res = await fetch(`https://indiankanoon.org/doc/${docId}/`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });
    if (res.ok) {
      const html = await res.text();
      const $c = cheerio.load(html);
      // Grab title from common Indian Kanoon title containers
      const title = normalizeWhitespace($c("div.doc_title").text() || $c("title").text());
      if (title) {
        docTitleCache.set(docId, title);
        return title;
      }
    }
  } catch (err) {
    // Ignore fetch errors to prevent script crashing
  }

  docTitleCache.set(docId, "");
  return null;
}

function parseResolvedTitle(title: string, originalLaw: CitedLaw) {
  let section_no = originalLaw.section_no;
  let act_name = originalLaw.act_name;
  let act_year = originalLaw.act_year;

  // Attempt to parse standard format: "Section 49 in The Transfer of Property Act, 1882"
  const inMatch = title.match(/^(?:Section|Article|Order|Rule|Regulation|Clause|s\.|sec\.)\s+([0-9A-Za-z\(\)\-]+)\s+in\s+(.+)$/i);
  
  let rawActName = title;
  
  if (inMatch) {
    section_no = inMatch[1];
    rawActName = inMatch[2];
  } else if (title.includes(" in ")) {
    rawActName = title.split(" in ").pop() || title;
  }

  // Extract year
  const yearMatch = rawActName.match(/\b((?:18|19|20)\d{2})\b/);
  if (yearMatch) {
    act_year = Number(yearMatch[1]);
    rawActName = rawActName.replace(/\b(?:18|19|20)\d{2}\b/g, "").replace(/,\s*$/, "");
  }
  
  // Clean up "The " prefix
  act_name = normalizeWhitespace(rawActName.replace(/^the\s+/i, ""));

  return { section_no, act_name, act_year };
}
// -----------------------------------------------------------------------------

function extractLinks($: cheerio.CheerioAPI) {
  const citedJudgments = new Map<string, CitedJudgment>();
  const citedLaws = new Map<string, CitedLaw>();

  const reporterPatterns = [
    /\bAIR\s+(?:\d{4}|\d+)\s*(?:SC|SUPREME COURT)\b/i,
    /\b(?:\(\d{4}\)\s*)?\d+\s+SCC\s+\d+\b/i,
    /\b(?:\(\d{4}\)\s*)?\d+\s+SCR\s+\d+\b/i,
    /\b\d{4}\s+INSC\s+\d+\b/i,
    /\b\[\d{4}\]\s+\d+\s+SCR\b/i,
    /\b\d{4}\s+SCALE\b/i,
  ];

  $("a").toArray().forEach((element) => {
    const anchor = $(element);
    const anchorText = normalizeWhitespace(anchor.text());
    
    if (!anchorText) return;

    let docId = anchor.attr("data-doc-id");
    if (!docId) {
      const href = anchor.attr("href");
      if (href && href.includes("/doc/")) {
        docId = href.split("/doc/")[1]?.replace(/\//g, "");
      }
    }

    if (!docId || docId === "javascript:void(0)") return; 

    const isJudgment = /\b(?:v\.?|vs\.?|versus)\b/i.test(anchorText) || reporterPatterns.some((p) => p.test(anchorText));

    if (isJudgment) {
      if (!citedJudgments.has(docId)) {
        citedJudgments.set(docId, { docId, title: anchorText });
      }
    } else {
      if (!citedLaws.has(docId)) {
        const match = anchorText.match(/^(?:Section|Article|Order|Rule|Regulation|Clause|s\.|sec\.)\s+([0-9A-Za-z\(\)\-]+)(?:\s+in\s+(.+))?/i);
        
        let section_no = match ? match[1] : "";
        let act_name = match && match[2] ? match[2] : anchorText;
        let act_year: number | null = null;

        const yearMatch = act_name.match(/\b((?:18|19|20)\d{2})\b/);
        if (yearMatch) {
          act_year = Number(yearMatch[1]);
          act_name = act_name.replace(/\b(?:18|19|20)\d{2}\b/g, "").replace(/,\s*$/, "").trim();
        }

        citedLaws.set(docId, {
          docId,
          section_no,
          act_name,
          act_year,
          citation_text: anchorText
        });
      }
    }
  });

  return {
    judgements: Array.from(citedJudgments.values()),
    laws: Array.from(citedLaws.values()),
  };
}

function inferSubjectAreas(knownActs: string[], fullText: string): string[] {
  const haystack = `${knownActs.join(" ")} ${fullText.slice(0, 6000)}`;
  const checks: Array<[RegExp, string]> = [
    [/\bconstitution\b|\bfundamental rights?\b|\bArticle\s+\d+\b/i, "Constitutional Law"],
    [/\bIPC\b|\bPenal Code\b|\bCriminal\b|\baccused\b|\bconviction\b/i, "Criminal Law"],
    [/\bevidence\b|\bexpert opinion\b|\bwitness\b/i, "Law of Evidence"],
    [/\bContract\b|\bSpecific Relief\b|\bagreement\b/i, "Contract Law"],
    [/\bArbitration\b|\barbitrator\b/i, "Arbitration"],
    [/\bIncome Tax\b|\bGST\b|\bCustoms\b|\btax\b/i, "Taxation"],
    [/\bproperty\b|\btransfer of property\b|\btitle\b|\bpossession\b/i, "Property Law"],
    [/\bservice\b|\bappointment\b|\bpromotion\b|\bseniority\b/i, "Service Law"],
    [/\bfamily\b|\bmarriage\b|\bdivorce\b|\binheritance\b/i, "Family Law"],
    [/\bcompany\b|\bcorporate\b|\binsolvency\b|\bIBC\b/i, "Corporate Law"],
  ];
  return unique(checks.filter(([pattern]) => pattern.test(haystack)).map(([, area]) => area));
}

function buildKeywords(fields: { title: string; subjectAreas: string[]; citedLaws: CitedLaw[]; fullText: string; }): string[] {
  const titleKeywords = fields.title.replace(/\bon\b.+$/i, "").split(/\s+v(?:s\.?|ersus)?\s+/i).flatMap((party) => party.split(/\s+/)).filter((word) => word.length > 3);
  const legalTerms = [
    /\bmurder\b/i, /\bexpert opinion\b/i, /\bevidence\b/i, /\bprivate defence\b/i,
    /\bunlawful assembly\b/i, /\bappeal\b/i, /\bpossession\b/i, /\bcriminal justice\b/i,
  ].filter((pattern) => pattern.test(fields.fullText)).map((pattern) => pattern.source.replace(/\\b|\\/g, "").replace(/\|.*/g, ""));

  return unique([
    ...fields.subjectAreas,
    ...fields.citedLaws.map((law) => law.act_name),
    ...fields.citedLaws.map((law) => law.section_no ? `Section ${law.section_no}` : ""),
    ...legalTerms,
    ...titleKeywords,
  ]).slice(0, 50);
}

// -----------------------------------------------------------------------------
// UPDATED to be async to await document title resolution
// -----------------------------------------------------------------------------
async function buildEnrichment(doc: any, sourceCollection: any): Promise<EnrichmentDocument> {
  const html = decodeHtmlContent(doc.htmlContent);
  if (!html) throw new Error("Document has no readable htmlContent");

  const $ = cheerio.load(html);
  $("script, style, noscript").remove();

  const title = normalizeWhitespace($("h2.doc_title").first().text() || doc.title || $("title").first().text());
  const benchText = normalizeWhitespace($(".doc_bench").first().text());
  const bench = benchText ? splitList(benchText) : unique(doc.bench || []);
  const bodyText = normalizeWhitespace($(".judgments").length ? $(".judgments").text() : $("body").text());
  const fullText = normalizeWhitespace(`${title} ${bodyText}`);
  
  const knownActs = extractActs(fullText);
  const subjectAreas = inferSubjectAreas(knownActs, fullText);

  const { judgements, laws: rawLaws } = extractLinks($);
  const resolvedLaws: CitedLaw[] = [];

  // Async loop to resolve titles for vague laws
  for (const law of rawLaws) {
    // If it looks incomplete (e.g. "S. 49", "Article 12") it needs resolution
    const needsResolution = !law.act_name || law.act_name.length < 12 || /^(?:s\.|sec\.|art\.|section|article)\b/i.test(law.act_name);
    
    if (needsResolution) {
      const fetchedTitle = await resolveActNameFromDocId(law.docId, sourceCollection);
      if (fetchedTitle && fetchedTitle.length > 0) {
        const parsed = parseResolvedTitle(fetchedTitle, law);
        law.section_no = parsed.section_no || law.section_no;
        law.act_name = parsed.act_name || law.act_name;
        law.act_year = parsed.act_year || law.act_year;
      }
    }
    resolvedLaws.push(law);
  }

  return {
    _id: doc._id,
    source_docId: doc.source?.docId || "",
    title,
    year: doc.year || extractYear(title, fullText),
    bench,
    keywords: buildKeywords({
      title,
      subjectAreas,
      citedLaws: resolvedLaws,
      fullText,
    }),
    equivalent_citation: extractEquivalentCitations($, fullText),
    subject_areas: subjectAreas,
    cited_judgements: judgements,
    cited_laws: resolvedLaws,
  };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const has = (flag: string) => args.includes(flag);
  const value = (flag: string) => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };

  return {
    docId: value("--docId"),
    objectId: value("--id"),
    limit: Number(value("--limit") || "25"),
    dryRun: has("--dry-run"),
    overwrite: has("--overwrite"),
  };
}

async function main() {
  const options = parseArgs();
  const client = new MongoClient(mongoUrl as string);
  await client.connect();

  try {
    const db = client.db(dbName);
    const sourceCollection = db.collection(sourceCollectionName);
    const enrichmentCollection = db.collection(enrichmentCollectionName);
    const query: Record<string, unknown> = { htmlContent: { $exists: true } };

    if (options.docId) query["source.docId"] = options.docId;
    if (options.objectId) query._id = new ObjectId(options.objectId);

    const totalCount = await sourceCollection.countDocuments(query);
    const limit = options.limit === 0 ? totalCount : options.limit;
    console.log(`Found ${totalCount} matching judgment(s). Processing up to ${limit}...`);

    const cursor = sourceCollection.find(query).limit(limit === totalCount ? 0 : limit);
    
    let batch: any[] = [];
    const BATCH_SIZE = 50; // Increased throughput 
    let processed = 0;
    let skipped = 0;
    let errors = 0;

    const processBatch = async (docs: any[]) => {
      await Promise.all(docs.map(async (doc) => {
        const docLabel = doc.source?.docId || doc._id.toString();
        try {
          if (!options.overwrite) {
            const existing = await enrichmentCollection.findOne(
              { _id: doc._id },
              { projection: { _id: 1 } }
            );
            if (existing) {
              console.log(`[SKIP] ${docLabel}: enrichment already exists.`);
              skipped++;
              return;
            }
          }

          // Must await buildEnrichment now since it queries the DB
          const enrichment = await buildEnrichment(doc, sourceCollection);

          if (options.dryRun) {
            console.log(JSON.stringify(enrichment, null, 2));
            return;
          }

          await enrichmentCollection.updateOne(
            { _id: enrichment._id },
            { $set: enrichment },
            { upsert: true }
          );

          console.log(`[OK] ${docLabel}: ${enrichment.cited_judgements.length} cited judgments, ${enrichment.cited_laws.length} cited laws`);
        } catch (error: any) {
          console.error(`[ERROR] ${docLabel}: ${error.message}`);
          errors++;
        }
      }));
    };

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      if (doc) batch.push(doc);

      if (batch.length >= BATCH_SIZE) {
        await processBatch(batch);
        processed += batch.length;
        console.log(`--- Processed ${processed}/${limit} ---`);
        batch = [];
      }
    }

    if (batch.length > 0) {
      await processBatch(batch);
      processed += batch.length;
      console.log(`--- Processed ${processed}/${limit} ---`);
    }

    console.log(`\nFinished! Processed: ${processed}, Skipped: ${skipped}, Errors: ${errors}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});