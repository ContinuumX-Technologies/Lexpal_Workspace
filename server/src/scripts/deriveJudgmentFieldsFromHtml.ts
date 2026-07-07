import dotenv from "dotenv";
dotenv.config();

import * as cheerio from "cheerio";
import * as zlib from "zlib";
import { Binary, MongoClient, ObjectId } from "mongodb";

const mongoUrl = process.env.MONGO_CONNECTION_URL;
const dbName = process.env.MONGO_DB_NAME || "Lexpal_Workspace";
const collectionName =
  process.env.JUDGMENTS_COLLECTION || "supreme_court_judgements";

if (!mongoUrl) {
  console.error("Please set MONGO_CONNECTION_URL in server/.env");
  process.exit(1);
}

type LegalTextType =
  | "facts"
  | "issue"
  | "petarg"
  | "resparg"
  | "reasoning"
  | "ratio"
  | "decision"
  | "text";

interface DerivedText {
  type: LegalTextType;
  paragraphNo: number;
  content: string;
}

interface DerivedJudgmentFields {
  title: string;
  court: string;
  source: {
    url: string;
    docId: string;
    provider: "indiankanoon" | "supremecourt" | "escr";
  };
  citation: string;
  equivalentCitations: string[];
  neutralCitation: string;
  date: Date | null;
  year: number | null;
  bench: string[];
  judges: string[];
  benchStrength: number;
  acts: string[];
  sections: string[];
  articles: string[];
  caseType: string;
  subjectArea: string[];
  outcome: string;
  citationGraph: {
    cites: string[];
    reliedOn: string[];
    overruled: string[];
    distinguished: string[];
    followed: string[];
    referredTo: string[];
  };
  texts: DerivedText[];
  summary: {
    factsSummary: string;
    legalIssues: string[];
    petitionerArguments: string;
    respondentArguments: string;
    courtReasoning: string;
    ratioDecidendi: string;
    obiterDicta: string;
    finalHolding: string;
    whyThisCaseMatters: string;
    importantParagraphs: number[];
    keywords: string[];
  };
}

const STRUCTURE_MAP: Record<string, LegalTextType> = {
  facts: "facts",
  fact: "facts",
  issue: "issue",
  issues: "issue",
  petarg: "petarg",
  petitioner: "petarg",
  "petitioner's argument": "petarg",
  resparg: "resparg",
  respondent: "resparg",
  "respondent's argument": "resparg",
  section: "reasoning",
  analysis: "reasoning",
  precedent: "reasoning",
  "precedent analysis": "reasoning",
  cdiscource: "reasoning",
  reasoning: "reasoning",
  "court's reasoning": "reasoning",
  ratio: "ratio",
  conclusion: "decision",
  decision: "decision",
  order: "decision",
};

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const cleaned = value.replace(/\s+/g, " ").trim();
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }

  return result;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function splitList(value: string): string[] {
  return unique(
    value
      .split(/,|;|\band\b/i)
      .map((part) => part.replace(/^Bench\s*:/i, "").trim())
      .filter(Boolean)
  );
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

function parseDateFromText(text: string): Date | null {
  const direct = text.match(
    /\bon\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+),?\s+((?:19|20)\d{2})\b/i
  );
  if (direct) {
    const day = Number(direct[1]);
    const month = MONTHS[direct[2].toLowerCase()];
    const year = Number(direct[3]);
    if (!Number.isNaN(day) && month !== undefined && !Number.isNaN(year)) {
      return new Date(Date.UTC(year, month, day));
    }
  }

  const numeric = text.match(/\b(\d{1,2})[./-](\d{1,2})[./-]((?:19|20)\d{2})\b/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]) - 1;
    const year = Number(numeric[3]);
    if (month >= 0 && month <= 11) return new Date(Date.UTC(year, month, day));
  }

  return null;
}

function extractYear(title: string, fullText: string, parsedDate: Date | null): number | null {
  if (parsedDate) return parsedDate.getUTCFullYear();

  const yearMatch =
    title.match(/\b((?:19|20)\d{2})\b/) || fullText.match(/\b((?:19|20)\d{2})\b/);

  return yearMatch ? Number(yearMatch[1]) : null;
}

function extractCitations(rawCitationText: string, fullText: string): string[] {
  const citations: string[] = [];
  const cleanedCitationText = rawCitationText
    .replace(/^Equivalent citations\s*:/i, "")
    .replace(/^Citations\s*:/i, "");

  citations.push(...cleanedCitationText.split(","));

  const citationPatterns = [
    /\bAIR\s+(?:19|20)\d{2}\s+SC\s+\d+\b/gi,
    /\b(?:19|20)\d{2}\s+INSC\s+\d+\b/gi,
    /\b\((?:19|20)\d{2}\)\s+\d+\s+SCC\s+\d+\b/gi,
    /\b(?:19|20)\d{2}\s+\(\d+\)\s+SCALE\s+\d+\b/gi,
    /\b(?:19|20)\d{2}\s+Supp\s+SCR\s+\d+\b/gi,
    /\[(?:19|20)\d{2}\]\s*SUPP\s*SCR\s*\d+\b/gi,
    /\b\[(?:19|20)\d{2}\]\s+\d+\s+SCR\s+\d+\b/gi,
  ];

  for (const pattern of citationPatterns) {
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
      .slice(0, 50)
  );
}

function extractSections(fullText: string): string[] {
  const directSections = Array.from(
    fullText.matchAll(
      /\b(?:Section|Sec\.?|S\.)\s+\d+[A-Za-z]?(?:\s*\([^)]+\))*\b/gi
    ),
    (match) => normalizeWhitespace(match[0].replace(/^Sec\.?/i, "Section").replace(/^S\./i, "Section"))
  );

  const clusteredSections: string[] = [];
  const clusterPattern =
    /\b(?:ss\.|s\.|sections?)\s+((?:\d+[A-Za-z]?(?:\s*\([^)]+\))*\s*(?:,|and|&|read with)?\s*){1,8})/gi;

  for (const match of fullText.matchAll(clusterPattern)) {
    const cluster = match[1] || "";
    const numbers = cluster.match(/\d+[A-Za-z]?(?:\s*\([^)]+\))*/g) || [];
    clusteredSections.push(...numbers.map((number) => `Section ${normalizeWhitespace(number)}`));
  }

  return unique([...directSections, ...clusteredSections]).slice(0, 80);
}

function extractArticles(fullText: string): string[] {
  const articles = Array.from(
    fullText.matchAll(/\bArticle\s+\d+[A-Za-z]?(?:\s*\([^)]+\))*\b/gi),
    (match) => normalizeWhitespace(match[0])
  );

  return unique(articles).slice(0, 80);
}

function inferCaseType(title: string, fullText: string): string {
  const haystack = `${title} ${fullText.slice(0, 2500)}`;
  const checks: Array<[RegExp, string]> = [
    [/\bcriminal\b|\bIPC\b|\bCr\.?\s*P\.?\s*C\.?\b|\baccused\b/i, "Criminal"],
    [/\bcivil\b|\bsuit\b|\bplaintiff\b|\bdefendant\b/i, "Civil"],
    [/\bwrit\b|\bArticle\s+32\b|\bArticle\s+226\b/i, "Writ"],
    [/\barbitration\b|\barbitrator\b/i, "Arbitration"],
    [/\btax\b|\bincome tax\b|\bGST\b|\bcustoms\b/i, "Tax"],
    [/\bservice\b|\bappointment\b|\bpromotion\b/i, "Service"],
    [/\bconstitution\b|\bfundamental right\b|\bArticle\s+\d+\b/i, "Constitutional"],
  ];

  return checks.find(([pattern]) => pattern.test(haystack))?.[1] || "General";
}

function inferSubjectAreas(acts: string[], articles: string[], fullText: string): string[] {
  const areas: string[] = [];
  const haystack = `${acts.join(" ")} ${articles.join(" ")} ${fullText.slice(0, 5000)}`;

  const checks: Array<[RegExp, string]> = [
    [/\bconstitution\b|\bfundamental rights?\b|\bArticle\s+\d+\b/i, "Constitutional Law"],
    [/\bIPC\b|\bPenal Code\b|\bCriminal\b|\baccused\b/i, "Criminal Law"],
    [/\bContract\b|\bSpecific Relief\b|\bagreement\b/i, "Contract Law"],
    [/\bArbitration\b|\barbitrator\b/i, "Arbitration"],
    [/\bIncome Tax\b|\bGST\b|\bCustoms\b|\btax\b/i, "Taxation"],
    [/\bproperty\b|\btransfer of property\b|\btitle\b/i, "Property Law"],
    [/\bservice\b|\bappointment\b|\bpromotion\b|\bseniority\b/i, "Service Law"],
    [/\bfamily\b|\bmarriage\b|\bdivorce\b|\binheritance\b/i, "Family Law"],
    [/\bcompany\b|\bcorporate\b|\binsolvency\b|\bIBC\b/i, "Corporate Law"],
  ];

  for (const [pattern, area] of checks) {
    if (pattern.test(haystack)) areas.push(area);
  }

  return unique(areas);
}

function splitSentences(text: string): string[] {
  return normalizeWhitespace(text).split(/(?<=[.!?])\s+/).filter(Boolean);
}

function getDispositionMatches(texts: DerivedText[], fullText: string): Array<{ sentence: string; score: number }> {
  const dispositionPattern =
    /\b(appeal|appeals|petition|petitions|application|applications|suit|writ|conviction|sentence|sentences|order|orders|judgment|judgments|matter|case|proceeding|proceedings|leave)\b[\s\S]{0,180}\b(allowed|dismissed|disposed of|set aside|quashed|remanded|restored|upheld|affirmed|modified|confirmed|acquitted|convicted|sentenced|granted|rejected)\b/i;
  const courtDirectionPattern =
    /\b(we|this court|the court|accordingly|therefore|hence|in the result|for the reasons)\b[\s\S]{0,220}\b(allow|dismiss|dispose of|set aside|quash|remand|restore|uphold|affirm|modify|confirm|acquit|convict|sentence|grant|reject|direct|order)\b/i;
  const presentCasePattern =
    /\b(appellant|respondent|petitioner|accused|conviction|sentence|appeal|petition|case|matter|order|judgment|high court|trial court|this court|we|therefore|accordingly|hence)\b/i;
  const citedCasePattern =
    /^\s*(?:\d+\.\s*)?In\s+[A-Z][A-Za-z .]*\s+v\.?\s+|Privy Council|their Lordships|Lord\s+[A-Z]|Sir\s+[A-Z]|Viscount\s+[A-Z]/i;
  const sectionsToScan = texts.length
    ? texts
    : [{ type: "text" as LegalTextType, paragraphNo: 0, content: fullText.slice(-9000) }];
  const matches: Array<{ sentence: string; score: number }> = [];
  const midpoint = sectionsToScan.length / 2;

  sectionsToScan.forEach((text, index) => {
    for (const sentence of splitSentences(text.content)) {
      const isDisposition = dispositionPattern.test(sentence);
      const isDirection = courtDirectionPattern.test(sentence);
      if (!isDisposition && !isDirection) continue;

      let score = 0;
      if (isDisposition) score += 4;
      if (isDirection) score += 3;
      if (presentCasePattern.test(sentence)) score += 2;
      if (text.type === "decision") score += 4;
      if (text.type === "reasoning") score += 1;
      if (index >= midpoint) score += 1;
      if (citedCasePattern.test(sentence)) score -= 5;

      matches.push({ sentence: normalizeWhitespace(sentence), score });
    }
  });

  return matches.sort((a, b) => b.score - a.score);
}

function inferOutcome(texts: DerivedText[], fullText: string): string {
  const matches = getDispositionMatches(texts, fullText);
  return matches.length ? firstWords(matches[0].sentence, 90) : "";
}

function detectTextType(rawType: string, content: string, currentType: LegalTextType): LegalTextType {
  const normalizedType = normalizeWhitespace(rawType).toLowerCase();
  if (STRUCTURE_MAP[normalizedType]) return STRUCTURE_MAP[normalizedType];

  const heading = content.slice(0, 140);
  const headingChecks: Array<[RegExp, LegalTextType]> = [
    [/\b(facts?|background)\b/i, "facts"],
    [/\b(issues?|questions? for consideration)\b/i, "issue"],
    [/\b(submissions?|arguments?)\b.*\b(petitioner|appellant)\b/i, "petarg"],
    [/\b(submissions?|arguments?)\b.*\b(respondent|state)\b/i, "resparg"],
    [/\b(analysis|consideration|discussion)\b/i, "reasoning"],
    [/\b(precedents?|authorities)\b/i, "reasoning"],
    [/\b(reasoning|reasons)\b/i, "reasoning"],
    [/\b(ratio|principle)\b/i, "ratio"],
    [/\b(conclusion|held|order|result)\b/i, "decision"],
  ];

  return headingChecks.find(([pattern]) => pattern.test(heading))?.[1] || currentType;
}

function extractTexts($: cheerio.CheerioAPI): DerivedText[] {
  const container = $(".judgments").length ? $(".judgments") : $("body");
  const elements = container.find("p, div[id^='p_'], blockquote, li").toArray();
  const texts: DerivedText[] = [];
  let paragraphNo = 1;
  let currentType: LegalTextType = "text";

  for (const element of elements) {
    const node = $(element);
    const content = normalizeWhitespace(node.text());
    if (!content || content.length < 3) continue;

    const rawType =
      node.attr("data-structure") ||
      node.attr("title") ||
      node.prevAll("[data-structure]").first().attr("data-structure") ||
      "";

    currentType = detectTextType(rawType, content, currentType);

    const idParagraph = node.attr("id")?.match(/^p_(\d+)$/i);
    const resolvedParagraphNo = idParagraph ? Number(idParagraph[1]) : paragraphNo;

    texts.push({
      type: currentType,
      paragraphNo: resolvedParagraphNo,
      content,
    });

    paragraphNo += 1;
  }

  return texts;
}

function firstWords(text: string, wordLimit: number): string {
  const words = normalizeWhitespace(text).split(" ").filter(Boolean);
  return words.slice(0, wordLimit).join(" ");
}

function joinTexts(texts: DerivedText[], types: LegalTextType[], wordLimit: number): string {
  const content = texts
    .filter((text) => types.includes(text.type))
    .map((text) => text.content)
    .join(" ");

  return firstWords(content, wordLimit);
}

function extractIssues(texts: DerivedText[], fullText: string): string[] {
  const issueTexts = texts
    .filter((text) => text.type === "issue")
    .map((text) => text.content);

  const candidates = issueTexts.length
    ? issueTexts
    : fullText.split(/(?<=[.?])\s+/).filter((text) =>
        /\b(whether|question|issue|contention|ground)\b/i.test(text)
      );

  return unique(
    candidates
      .filter((text) => issueTexts.length || /\b(whether|question|issue|consideration)\b/i.test(text))
      .map((text) => firstWords(text, 45))
      .slice(0, 10)
  );
}

function extractRatio(texts: DerivedText[], fullText: string): string {
  const ratioSource =
    joinTexts(texts, ["ratio", "decision", "reasoning"], 900) ||
    fullText.slice(-6000);

  const sentences = ratioSource.split(/(?<=[.!?])\s+/);
  const ratioSentences = sentences.filter((sentence) =>
    /\b(held that|we hold|it is held|law is|principle|settled law|therefore|accordingly)\b/i.test(
      sentence
    )
  );

  return firstWords((ratioSentences.length ? ratioSentences : sentences.slice(-5)).join(" "), 180);
}

function extractFinalHolding(texts: DerivedText[], fullText: string): string {
  const dispositionMatches = getDispositionMatches(texts, fullText);
  if (dispositionMatches.length) {
    return firstWords(dispositionMatches[0].sentence, 180);
  }

  const endingTexts = texts.slice(Math.max(0, texts.length - 8));
  const decisionTexts = texts.filter((text) => text.type === "decision");
  const sourceTexts = decisionTexts.length ? decisionTexts : endingTexts;
  const source = normalizeWhitespace(
    sourceTexts.map((text) => text.content).join(" ") || fullText.slice(-7000)
  );
  const sentences = splitSentences(source);

  const dispositionPattern =
    /\b(appeal|petition|application|suit|writ|conviction|sentence|order|judgment|matter|case|proceedings?)\b[\s\S]{0,140}\b(allowed|dismissed|disposed of|set aside|quashed|remanded|restored|upheld|affirmed|modified|confirmed|acquitted|convicted|sentenced|granted|rejected)\b/i;
  const directionPattern =
    /\b(we|this court|the court|accordingly|therefore|hence|in the result|for the reasons)\b[\s\S]{0,180}\b(direct|order|hold|allow|dismiss|set aside|quash|remand|dispose|restore|uphold|affirm|modify|grant|reject)\b/i;

  const matches = sentences.filter(
    (sentence) => dispositionPattern.test(sentence) || directionPattern.test(sentence)
  );

  if (matches.length) {
    return firstWords(matches.slice(-3).join(" "), 180);
  }

  return firstWords(sentences.slice(-4).join(" "), 180);
}

function extractImportantParagraphs(texts: DerivedText[]): number[] {
  return unique(texts
    .filter((text) =>
      /\b(held that|we hold|settled law|principle|therefore|accordingly|allowed|dismissed|set aside)\b/i.test(
        text.content
      )
    )
    .map((text) => String(text.paragraphNo)))
    .map(Number)
    .slice(0, 20);
}

function extractCitationGraph($: cheerio.CheerioAPI, fullText: string): DerivedJudgmentFields["citationGraph"] {
  const caseCitationAnchors = $("span.citetext a[data-doc-id], a.citation-link")
    .toArray()
    .filter((element) => {
      const anchor = $(element);
      const anchorText = normalizeWhitespace(anchor.text());
      const parentText = normalizeWhitespace(anchor.closest("span.citetext").text());
      const contextText = parentText || normalizeWhitespace(anchor.parent().text());

      if (anchor.closest("span.citetext").length) return true;
      if (/\b(?:v\.?|vs\.?|versus)\b/i.test(anchorText)) return true;
      if (/\b(?:v\.?|vs\.?|versus)\b/i.test(contextText)) return true;

      return false;
    });

  const linkedDocIds = unique(
    caseCitationAnchors
      .map((element) => $(element).attr("data-doc-id") || "")
      .filter(Boolean)
  );

  const graph: DerivedJudgmentFields["citationGraph"] = {
    cites: linkedDocIds,
    reliedOn: [],
    overruled: [],
    distinguished: [],
    followed: [],
    referredTo: [],
  };

  const relationshipChecks: Array<[keyof typeof graph, RegExp]> = [
    ["reliedOn", /\b(relied on|relies on|reliance was placed)\b/i],
    ["overruled", /\b(overruled|overrules)\b/i],
    ["followed", /\b(followed|follows)\b/i],
    ["distinguished", /\b(distinguished|distinguishes)\b/i],
    ["referredTo", /\b(referred to|refers to|cited|approved|approves|disapproved|disapproves|explained|explains)\b/i],
  ];

  for (const docId of linkedDocIds) {
    const anchors = caseCitationAnchors.filter((element) => $(element).attr("data-doc-id") === docId);
    const contexts = anchors.map((element) => {
      const anchor = $(element);
      const spanContext = normalizeWhitespace(anchor.closest("span.citetext").text());
      const paragraphContext = normalizeWhitespace(anchor.closest("p, blockquote, div").text());
      return spanContext || paragraphContext;
    });
    const context = contexts.join(" ");

    for (const [key, pattern] of relationshipChecks) {
      if (pattern.test(context)) graph[key].push(docId);
    }

    const hasRelationship =
      graph.reliedOn.includes(docId) ||
      graph.overruled.includes(docId) ||
      graph.distinguished.includes(docId) ||
      graph.followed.includes(docId) ||
      graph.referredTo.includes(docId);

    if (!hasRelationship) {
      graph.referredTo.push(docId);
    }
  }

  for (const key of Object.keys(graph) as Array<keyof typeof graph>) {
    graph[key] = unique(graph[key]);
  }

  return graph;
}

function keywordsFromFields(fields: {
  acts: string[];
  sections: string[];
  articles: string[];
  subjectAreas: string[];
  caseType: string;
  title: string;
}): string[] {
  const titleKeywords = fields.title
    .replace(/\bon\b.+$/i, "")
    .split(/\s+v(?:s\.?|ersus)?\s+/i)
    .flatMap((party) => party.split(/\s+/))
    .filter((word) => word.length > 3);

  return unique([
    ...fields.subjectAreas,
    fields.caseType,
    ...fields.acts,
    ...fields.sections,
    ...fields.articles,
    ...titleKeywords,
  ]).slice(0, 40);
}

function deriveFieldsFromHtml(doc: any): DerivedJudgmentFields {
  const html = decodeHtmlContent(doc.htmlContent);
  if (!html) throw new Error("Document has no readable htmlContent");

  const $ = cheerio.load(html);
  $("script, style, noscript").remove();

  const title = normalizeWhitespace(
    $("h2.doc_title").first().text() || doc.title || $("title").first().text()
  );

  const rawBenchText = normalizeWhitespace($(".doc_bench").first().text());
  const bench = rawBenchText ? splitList(rawBenchText) : unique(doc.bench || []);
  const judges = bench.map((judge) =>
    judge.replace(/^hon'?ble\s+(mr\.?|mrs\.?|ms\.?)?\s*justice\s+/i, "").trim()
  );

  const rawCitationText = normalizeWhitespace($(".doc_citations").first().text());
  const citationChipText = normalizeWhitespace(
    $(".citation-chip")
      .toArray()
      .map((element) => $(element).text())
      .join(", ")
  );
  const bodyText = normalizeWhitespace($(".judgments").length ? $(".judgments").text() : $("body").text());
  const citationText = rawCitationText || citationChipText;
  const fullText = normalizeWhitespace(`${title} ${citationText} ${rawBenchText} ${bodyText}`);

  const date = parseDateFromText(title) || parseDateFromText(fullText);
  const year = extractYear(title, fullText, date);
  const equivalentCitations = extractCitations(citationText, fullText);
  const neutralCitation =
    equivalentCitations.find((citation) => /\b(?:19|20)\d{2}\s+INSC\s+\d+\b/i.test(citation)) ||
    "";
  const citation = equivalentCitations[0] || neutralCitation || "";
  const sourceUrl = doc.source?.url || "";
  const provider: DerivedJudgmentFields["source"]["provider"] = sourceUrl.includes("sci.gov.in")
    ? "supremecourt"
    : sourceUrl.includes("escr")
      ? "escr"
      : "indiankanoon";

  const texts = extractTexts($);
  const acts = extractActs(fullText);
  const sections = extractSections(fullText);
  const articles = extractArticles(fullText);
  const caseType = inferCaseType(title, fullText);
  const subjectArea = inferSubjectAreas(acts, articles, fullText);
  const outcome = inferOutcome(texts, fullText);
  const citationGraph = extractCitationGraph($, fullText);
  const importantParagraphs = extractImportantParagraphs(texts);
  const keywords = keywordsFromFields({
    acts,
    sections,
    articles,
    subjectAreas: subjectArea,
    caseType,
    title,
  });

  const factsSummary =
    joinTexts(texts, ["facts"], 160) || firstWords(bodyText, 160);
  const legalIssues = extractIssues(texts, fullText);
  const petitionerArguments = joinTexts(texts, ["petarg"], 220);
  const respondentArguments = joinTexts(texts, ["resparg"], 220);
  const courtReasoning = joinTexts(texts, ["reasoning"], 260);
  const ratioDecidendi = extractRatio(texts, fullText);
  const finalHolding = extractFinalHolding(texts, fullText);

  return {
    title,
    court: "Supreme Court of India",
    source: {
      url: sourceUrl,
      docId: doc.source?.docId || "",
      provider,
    },
    citation,
    equivalentCitations,
    neutralCitation,
    date,
    year,
    bench,
    judges,
    benchStrength: judges.length,
    acts,
    sections,
    articles,
    caseType,
    subjectArea,
    outcome,
    citationGraph,
    texts,
    summary: {
      factsSummary,
      legalIssues,
      petitionerArguments,
      respondentArguments,
      courtReasoning,
      ratioDecidendi,
      obiterDicta: "",
      finalHolding,
      whyThisCaseMatters: [
        subjectArea.length ? `Subject area: ${subjectArea.join(", ")}` : "",
        ratioDecidendi ? `Key principle: ${firstWords(ratioDecidendi, 45)}` : "",
        importantParagraphs.length
          ? `Important paragraphs: ${importantParagraphs.slice(0, 8).join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
      importantParagraphs,
      keywords,
    },
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
    const collection = client.db(dbName).collection(collectionName);
    const query: Record<string, unknown> = { htmlContent: { $exists: true } };

    if (options.docId) query["source.docId"] = options.docId;
    if (options.objectId) query._id = new ObjectId(options.objectId);
    if (!options.overwrite) query.derived = { $exists: false };

    const docs = await collection.find(query).limit(options.limit).toArray();
    console.log(`Found ${docs.length} judgment(s) to derive.`);

    for (const doc of docs) {
      const docLabel = doc.source?.docId || doc._id.toString();

      try {
        const derived = deriveFieldsFromHtml(doc);

        if (options.dryRun) {
          console.log(
            JSON.stringify(
              {
                title: derived.title,
                court: derived.court,
                source: derived.source,
                citation: derived.citation,
                equivalentCitations: derived.equivalentCitations,
                neutralCitation: derived.neutralCitation,
                date: derived.date,
                year: derived.year,
                bench: derived.bench,
                judges: derived.judges,
                benchStrength: derived.benchStrength,
                acts: derived.acts,
                sections: derived.sections,
                articles: derived.articles,
                subjectArea: derived.subjectArea,
                outcome: derived.outcome,
                caseType: derived.caseType,
                texts: derived.texts,
                summary: derived.summary,
                citationGraph: derived.citationGraph,
                htmlContent: "[existing Binary preserved]",
                createdAt: doc.createdAt || "[set on write]",
                updatedAt: doc.updatedAt || "[set on write]",
              },
              null,
              2
            )
          );
          continue;
        }

        await collection.updateOne(
          { _id: doc._id },
          {
            $set: {
              title: derived.title || doc.title,
              court: derived.court,
              source: derived.source,
              citation: derived.citation,
              equivalentCitations: derived.equivalentCitations,
              neutralCitation: derived.neutralCitation,
              date: derived.date,
              year: derived.year || doc.year,
              bench: derived.bench.length ? derived.bench : doc.bench,
              judges: derived.judges,
              benchStrength: derived.benchStrength,
              acts: derived.acts,
              sections: derived.sections,
              articles: derived.articles,
              caseType: derived.caseType,
              subjectArea: derived.subjectArea,
              outcome: derived.outcome,
              citationGraph: derived.citationGraph,
              texts: derived.texts,
              summary: derived.summary,
              createdAt: doc.createdAt || new Date(),
              updatedAt: new Date(),
            },
            $unset: {
              derived: "",
              derivedAt: "",
              sourceProvider: "",
              landmark: "",
              constitutionBench: "",
              "summary.applicableActs": "",
              "summary.applicableSections": "",
              "summary.applicableArticles": "",
              "summary.subjectAreas": "",
              "citationGraph.reliesOn": "",
              "citationGraph.overrules": "",
              "citationGraph.follows": "",
              "citationGraph.distinguishes": "",
              "citationGraph.approves": "",
              "citationGraph.disapproves": "",
              "citationGraph.refersTo": "",
              "citationGraph.explains": "",
            },
          }
        );

        console.log(
          `[OK] ${docLabel}: ${derived.texts.length} paragraphs, ${derived.equivalentCitations.length} citations, ${derived.acts.length} acts`
        );
      } catch (error: any) {
        console.error(`[ERROR] ${docLabel}: ${error.message}`);
      }
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
