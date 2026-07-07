import dotenv from "dotenv";
dotenv.config();

import * as cheerio from "cheerio";
import * as zlib from "zlib";
import { Binary, MongoClient, ObjectId } from "mongodb";

const mongoUrl = process.env.MONGO_CONNECTION_URL;
const dbName = process.env.MONGO_DB_NAME || "Lexpal_Workspace";
const sourceCollectionName =
  process.env.JUDGMENTS_COLLECTION || "supreme_court_judgements";
const enrichmentCollectionName =
  process.env.ENRICHMENT_COLLECTION || "supreme_court_enrichement";

if (!mongoUrl) {
  console.error("Please set MONGO_CONNECTION_URL in server/.env");
  process.exit(1);
}

interface CitedJudgment {
  docId: string;
  title: string;
}

interface CitedLaw {
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

const ACT_YEAR_BY_NAME: Record<string, number> = {
  "Indian Penal Code": 1860,
  "Code of Criminal Procedure": 1973,
  "Criminal Procedure Code": 1973,
  "Code of Civil Procedure": 1908,
  "Civil Procedure Code": 1908,
  "Indian Evidence Act": 1872,
  "Evidence Act": 1872,
  "Constitution of India": 1950,
  "Constitution": 1950,
  "Transfer of Property Act": 1882,
  "Specific Relief Act": 1963,
  "Indian Contract Act": 1872,
  "Arbitration and Conciliation Act": 1996,
  "Companies Act": 2013,
  "Income Tax Act": 1961,
  "Motor Vehicles Act": 1988,
  "Limitation Act": 1963,
};

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
    value
      .split(/,|;|\band\b/i)
      .map((part) => part.replace(/^Bench\s*:/i, "").trim())
      .filter(Boolean)
  );
}

function extractYear(title: string, fullText: string): number | null {
  const match =
    title.match(/\b((?:18|19|20)\d{2})\b/) ||
    fullText.match(/\b((?:18|19|20)\d{2})\b/);

  return match ? Number(match[1]) : null;
}

function extractEquivalentCitations($: cheerio.CheerioAPI, fullText: string): string[] {
  const citationText = normalizeWhitespace(
    $(".doc_citations, .citation-chip")
      .toArray()
      .map((element) => $(element).text())
      .join(", ")
  )
    .replace(/^Equivalent citations\s*:/i, "")
    .replace(/^Citations\s*:/i, "");

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
    fullText.matchAll(
      /\b(?:the\s+)?([A-Z][A-Za-z '&.-]{2,80}?(?:Act|Code|Constitution)(?:,?\s+(?:18|19|20)\d{2})?)\b/g
    ),
    (match) => match[1]
  );

  return unique(
    acts
      .map((act) => act.replace(/^(the|under|of)\s+/i, ""))
      .filter((act) => !/\b(this|that|said|same|learned|hon'?ble)\b/i.test(act))
  );
}

function normalizeActName(value: string): { act_name: string; act_year: number | null } {
  const cleaned = normalizeWhitespace(value)
    .replace(/^the\s+/i, "")
    .replace(/,\s*$/, "");
  const yearMatch = cleaned.match(/\b((?:18|19|20)\d{2})\b/);
  const withoutYear = normalizeWhitespace(cleaned.replace(/\b(?:18|19|20)\d{2}\b/g, "").replace(/,\s*$/, ""));
  const mappedName =
    withoutYear === "Penal Code"
      ? "Indian Penal Code"
      : withoutYear === "I.P.C." || withoutYear === "IPC"
        ? "Indian Penal Code"
        : withoutYear;

  return {
    act_name: mappedName,
    act_year: yearMatch ? Number(yearMatch[1]) : ACT_YEAR_BY_NAME[mappedName] ?? null,
  };
}

function inferActFromContext(context: string, knownActs: string[]): { act_name: string; act_year: number | null } {
  const explicitAct = context.match(
    /\b(?:of|under|read with|punishable under)\s+(?:the\s+)?([A-Z][A-Za-z '&.-]{2,80}?(?:Act|Code|Constitution)(?:,?\s+(?:18|19|20)\d{2})?)\b/i
  );

  if (explicitAct) return normalizeActName(explicitAct[1]);

  for (const act of knownActs) {
    if (new RegExp(act.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(context)) {
      return normalizeActName(act);
    }
  }

  if (/\bI\.?\s*P\.?\s*C\.?\b|\bPenal Code\b/i.test(context)) {
    return { act_name: "Indian Penal Code", act_year: 1860 };
  }

  return normalizeActName(knownActs[0] || "");
}

function extractSectionNumbers(text: string): string[] {
  const numbers: string[] = [];
  const clusterPattern =
    /\b(?:sections?|secs?\.?|ss\.|s\.)\s+((?:\d+[A-Za-z]?(?:\s*\([^)]+\))*\s*(?:,|and|&|read with)?\s*){1,10})/gi;

  for (const match of text.matchAll(clusterPattern)) {
    const cluster = match[1] || "";
    numbers.push(...(cluster.match(/\d+[A-Za-z]?(?:\s*\([^)]+\))*/g) || []));
  }

  return unique(numbers.map((number) => normalizeWhitespace(number)));
}

function extractCitedLaws($: cheerio.CheerioAPI, fullText: string, knownActs: string[]): CitedLaw[] {
  const laws = new Map<string, CitedLaw>();

  $("a[data-doc-id]")
    .toArray()
    .forEach((element) => {
      const anchor = $(element);
      const anchorText = normalizeWhitespace(anchor.text());
      if (!/^(?:s\.|ss\.|section|sections?)\s*\d+/i.test(anchorText) && !/^\d+[A-Za-z]?/.test(anchorText)) {
        return;
      }

      const paragraphContext = normalizeWhitespace(anchor.closest("p, blockquote, div").text());
      const sectionNumbers = extractSectionNumbers(anchorText);
      if (!sectionNumbers.length) {
        const direct = anchorText.match(/\d+[A-Za-z]?(?:\s*\([^)]+\))*/);
        if (direct) sectionNumbers.push(direct[0]);
      }

      const act = inferActFromContext(paragraphContext, knownActs);
      if (!act.act_name) return;

      for (const sectionNo of sectionNumbers) {
        const citationText = `Section ${sectionNo} of the ${act.act_name}${act.act_year ? `, ${act.act_year}` : ""}`;
        laws.set(`${act.act_name.toLowerCase()}::${sectionNo.toLowerCase()}`, {
          section_no: sectionNo,
          act_name: act.act_name,
          act_year: act.act_year,
          citation_text: citationText,
        });
      }
    });

  const fallbackSections = extractSectionNumbers(fullText);
  const fallbackAct = inferActFromContext(fullText.slice(0, 5000), knownActs);
  if (fallbackAct.act_name) {
    for (const sectionNo of fallbackSections) {
      const citationText = `Section ${sectionNo} of the ${fallbackAct.act_name}${fallbackAct.act_year ? `, ${fallbackAct.act_year}` : ""}`;
      laws.set(`${fallbackAct.act_name.toLowerCase()}::${sectionNo.toLowerCase()}`, {
        section_no: sectionNo,
        act_name: fallbackAct.act_name,
        act_year: fallbackAct.act_year,
        citation_text: citationText,
      });
    }
  }

  return Array.from(laws.values()).slice(0, 100);
}

function extractCitedJudgments($: cheerio.CheerioAPI): CitedJudgment[] {
  const cited = new Map<string, CitedJudgment>();

  $("span.citetext a[data-doc-id], a.citation-link")
    .toArray()
    .forEach((element) => {
      const anchor = $(element);
      const docId = anchor.attr("data-doc-id");
      if (!docId) return;

      const anchorText = normalizeWhitespace(anchor.text());
      const spanText = normalizeWhitespace(anchor.closest("span.citetext").text());
      const parentText = normalizeWhitespace(anchor.parent().text());
      const context = spanText || parentText || anchorText;
      const looksLikeCase =
        /\b(?:v\.?|vs\.?|versus)\b/i.test(anchorText) ||
        /\b(?:v\.?|vs\.?|versus)\b/i.test(context) ||
        anchor.closest("span.citetext").length > 0;

      if (!looksLikeCase) return;

      const title = normalizeWhitespace(
        anchorText ||
          context
            .replace(/^In\s+/i, "")
            .replace(/\s*\([^)]*\).*$/, "")
      );

      if (title) cited.set(docId, { docId, title });
    });

  return Array.from(cited.values());
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

function buildKeywords(fields: {
  title: string;
  subjectAreas: string[];
  citedLaws: CitedLaw[];
  fullText: string;
}): string[] {
  const titleKeywords = fields.title
    .replace(/\bon\b.+$/i, "")
    .split(/\s+v(?:s\.?|ersus)?\s+/i)
    .flatMap((party) => party.split(/\s+/))
    .filter((word) => word.length > 3);

  const legalTerms = [
    /\bmurder\b/i,
    /\bexpert opinion\b/i,
    /\bevidence\b/i,
    /\bprivate defence\b/i,
    /\bunlawful assembly\b/i,
    /\bappeal\b/i,
    /\bpossession\b/i,
    /\bcriminal justice\b/i,
  ]
    .filter((pattern) => pattern.test(fields.fullText))
    .map((pattern) => pattern.source.replace(/\\b|\\/g, "").replace(/\|.*/g, ""));

  return unique([
    ...fields.subjectAreas,
    ...fields.citedLaws.map((law) => law.act_name),
    ...fields.citedLaws.map((law) => `Section ${law.section_no}`),
    ...legalTerms,
    ...titleKeywords,
  ]).slice(0, 50);
}

function buildEnrichment(doc: any): EnrichmentDocument {
  const html = decodeHtmlContent(doc.htmlContent);
  if (!html) throw new Error("Document has no readable htmlContent");

  const $ = cheerio.load(html);
  $("script, style, noscript").remove();

  const title = normalizeWhitespace(
    $("h2.doc_title").first().text() || doc.title || $("title").first().text()
  );
  const benchText = normalizeWhitespace($(".doc_bench").first().text());
  const bench = benchText ? splitList(benchText) : unique(doc.bench || []);
  const bodyText = normalizeWhitespace($(".judgments").length ? $(".judgments").text() : $("body").text());
  const fullText = normalizeWhitespace(`${title} ${bodyText}`);
  const knownActs = extractActs(fullText);
  const citedLaws = extractCitedLaws($, fullText, knownActs);
  const subjectAreas = inferSubjectAreas(knownActs, fullText);

  return {
    _id: doc._id,
    source_docId: doc.source?.docId || "",
    title,
    year: doc.year || extractYear(title, fullText),
    bench,
    keywords: buildKeywords({
      title,
      subjectAreas,
      citedLaws,
      fullText,
    }),
    equivalent_citation: extractEquivalentCitations($, fullText),
    subject_areas: subjectAreas,
    cited_judgements: extractCitedJudgments($),
    cited_laws: citedLaws,
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

    // If limit is exactly 0, it removes the limit in mongodb
    const totalCount = await sourceCollection.countDocuments(query);
    const limit = options.limit === 0 ? totalCount : options.limit;
    console.log(`Found ${totalCount} matching judgment(s). Processing up to ${limit}...`);

    const cursor = sourceCollection.find(query).limit(limit === totalCount ? 0 : limit);
    
    let batch: any[] = [];
    const BATCH_SIZE = 50;
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

          const enrichment = buildEnrichment(doc);

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
