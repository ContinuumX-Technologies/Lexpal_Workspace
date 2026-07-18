import { Request, Response } from "express";
import openaiClient from "../infra/openai.client";
import { encoding_for_model } from "tiktoken"; // production tokeniser
import { performance } from "node:perf_hooks";




/* ------------------------------------------------------------------ */
/*  Types & Store                                                      */
/* ------------------------------------------------------------------ */

interface ClarificationState {
  question: string;
  answer: string;
}

interface ClarificationResponse {
  needsClarification: boolean;
  question: string | null;
}

interface AttachedFile {
  file_id: string;
  file_title: string;
  text_content: string;        // raw text, will be truncated
}

interface TaskOptions {
  websearch: boolean;
  thinking: boolean;
}

interface TaskData {
  originalPrompt: string;
  attachedFiles: AttachedFile[];   // text_content already truncated
  options: TaskOptions;
}




// In‑memory store – in production replace with Redis/DB.
const taskStore = new Map<string, TaskData>();










/* ------------------------------------------------------------------ */
/*  Token helpers                                                      */
/* ------------------------------------------------------------------ */

// Truncate a string to at most `maxTokens` tokens using tiktoken.
// We use the gpt‑4o encoder (works for gpt‑5 as well).
function truncateTextToTokenLimit(
  text: string,
  maxTokens: number,
  model: string = "gpt-4o"
): string {
  const enc = encoding_for_model(model as any);
  const tokens = enc.encode(text);
  if (tokens.length <= maxTokens) {
    enc.free();
    return text;
  }
  const truncatedTokens = tokens.slice(0, maxTokens);
  const decoded = new TextDecoder().decode(
    new Uint8Array(
      enc.decode(truncatedTokens)  // decode returns Uint8Array
    )
  );
  enc.free();
  return decoded;
}










/* ------------------------------------------------------------------ */
/*  Clarification step (now accepts files & swappable prompt)          */
/* ------------------------------------------------------------------ */

async function checkClarificationNeeded({
  prompt,
  state,
  attachedFilesContent,
  useWebSearchPrompt,
}: {
  prompt: string;
  state: ClarificationState[];
  attachedFilesContent: string;
  useWebSearchPrompt: boolean;
}): Promise<ClarificationResponse> {
  try {
    const clarificationCount = state.length;



    /* ---------- Prompts ---------- */

    const basePrompt = `
    You are a senior legal draftsman with expertise across litigation, contracts,
corporate transactions, regulatory compliance, arbitration, insolvency,
labour law, intellectual property, constitutional law, criminal law, and
consumer law.

MISSION
understand user's request for a draft from the prompt and ask clarifying questions so that the drafting agent is able to produce legal drafts that are immediately usable as professional first drafts,
prepared as an experienced practitioner would prepare them for a client.
You are a clarifying agent for a legal drafting  agent.

Your job is to determine whether a legal draft can be produced
using the user's prompt and the existing clarification answers.

CLARIFICATION PROTOCOL
═══════════════════════════════════════════════════════════

Before drafting:

Identify all missing information.

Classify each item as:

A. Critical
B. Material
C. Non-Material

Critical Information includes:

- party identity
- jurisdiction
- relief sought
- claim amount
- contract subject matter
- execution date
- property description
- regulatory authority involved

Material Information includes:

- chronology
- supporting documents
- annexures
- witness details
- procedural details

Non-Material Information includes:

- formatting preferences
- internal references
- numbering conventions

The model may ask clarifying questions.

Maximum clarification rounds:
five (5).

The model shall ask only questions necessary to produce a legally reliable draft.

The model shall not consume clarification rounds for stylistic preferences.

If drafting can reasonably proceed despite missing information, proceed and use:

[INSTRUCTION REQUIRED]

markers where appropriate.

Rules:

1. Ask as few questions as possible.
2. Prefer drafting over asking questions.
3. Only ask questions that materially affect legal meaning.
4. Never ask for information already available in state.
5. Never ask more than 4 clarification questions total.
6. If clarificationCount >= 4, drafting must proceed.
7. Make reasonable assumptions when information is missing.
8. Ask only ONE question at a time.
9. If drafting can reasonably proceed, return needsClarification=false.

Return valid JSON only.
`;





    // Web‑search variant – extra instruction to leverage attached files & external knowledge
    const webSearchPrompt = `
    You are a senior legal draftsman with expertise across litigation, contracts,
corporate transactions, regulatory compliance, arbitration, insolvency,
labour law, intellectual property, constitutional law, criminal law, and
consumer law.

MISSION
understand user's request for a draft from the prompt and ask clarifying questions so that the drafting agent is able to produce legal drafts that are immediately usable as professional first drafts,
prepared as an experienced practitioner would prepare them for a client.
You are a clarifying agent for a legal drafting  agent.

**Because web search will be performed after clarification, you may rely on publicly available legal information to fill gaps.**
You can ask fewer questions and trust that the drafting agent will later receive web‑search results.
Nevertheless, you must still identify any truly critical, case‑specific information that cannot be found online (e.g. exact party names, dollar amounts, personal details).
Follow the same CLARIFICATION PROTOCOL as the base prompt, but lean even more towards drafting.

Rules (same as base, but with greater tolerance):
1‑9 as in base prompt.
10. If missing information is likely findable via web search, do not ask for it unless it is strictly critical and unique to the client.

Return valid JSON only.
`;




    const systemPrompt = useWebSearchPrompt ? webSearchPrompt : basePrompt;

    /* ---------- User message ---------- */

    const userPrompt = `
Draft Request:

${prompt}

${
  attachedFilesContent
    ? "Attached Files:\n" + attachedFilesContent
    : ""
}

Current Clarification Count:
${clarificationCount}

Existing Clarifications:

${JSON.stringify(state, null, 2)}
`;

    const response = await openaiClient.responses.create({
      model: "gpt-5",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "clarification_check",
          schema: {
            type: "object",
            properties: {
              needsClarification: { type: "boolean" },
              question: { type: ["string", "null"] },
            },
            required: ["needsClarification", "question"],
            additionalProperties: false,
          },
        },
      },
    });

    const result = JSON.parse(response.output_text) as ClarificationResponse;

    if (result.needsClarification && !result.question) {
      throw new Error("LLM requested clarification but returned no question");
    }

    return result;
  } catch (error) {
    console.error("checkClarificationNeeded failed:", error);
    // fail‑open: proceed to draft
    return { needsClarification: false, question: null };
  }
}













/* ------------------------------------------------------------------ */
/*  Web‑search after clarification                                     */
/* ------------------------------------------------------------------ */

// 1. Generate search keywords from the refined prompt + clarifications
async function generateSearchKeywords(
  refinedPrompt: string,
  clarifications: ClarificationState[]
): Promise<string[]> {
  const system = `You are a legal research assistant. Given a legal drafting request and its clarifications, produce a list of 3-5 concise web search queries that would retrieve the most relevant legal statutes, precedents, regulations, or commentary. Return a JSON array of strings.`;
  const user = `Draft Request:\n${refinedPrompt}\n\nClarifications:\n${JSON.stringify(clarifications, null, 2)}`;

  const response = await openaiClient.responses.create({
    model: "gpt-5",
    input: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "search_keywords",
        schema: {
          type: "object",
          properties: {
            queries: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["queries"],
          additionalProperties: false,
        },
      },
    },
  });

  const parsed = JSON.parse(response.output_text);
  return parsed.queries as string[];
}





//perform websearch

async function performWebSearch(queries: string[]): Promise<string> {
  const searchPrompt = `
You are a legal research assistant.

Using the web, research the following legal queries and provide:
- A concise, well-organized summary.
- Relevant statutes, regulations, or case law where applicable.
- Citations to reliable sources.

Queries:
${queries.map((q, i) => `${i + 1}. ${q}`).join("\n")}
`;

  const response = await openaiClient.responses.create({
    model: "gpt-5",
    tools: [
      {
        type: "web_search_preview",
      },
    ],
    input: searchPrompt,
  });

  return response.output_text;
}












/* ------------------------------------------------------------------ */
/*  Main endpoint                                                      */
/* ------------------------------------------------------------------ */

export const createDraft = async (req: Request, res: Response) => {
  try {
    const {
      taskId,
      prompt,
      originalPrompt,
      state,
      clarificationHistory,
      attached_files,       // new field: AttachedFile[]
      options,              // new field: { websearch, thinking }
    }: {
      taskId?: string;
      prompt?: string;
      originalPrompt?: string;
      state?: ClarificationState[];
      clarificationHistory?: ClarificationState[];
      attached_files?: AttachedFile[];
      options?: TaskOptions;
    } = req.body;

    const normalizedPrompt = (originalPrompt || prompt || "").trim();
    const normalizedState = clarificationHistory ?? state ?? [];

    if (!normalizedPrompt) {
      return res.status(400).json({
        success: false,
        message: "Prompt is required",
        type: "error",
        taskId,
      });
    }

    // ---------- Task store management ----------
    if (!taskId) {
      return res.status(400).json({
        success: false,
        message: "taskId is required",
        type: "error",
      });
    }

    // Retrieve existing task data or initialise
    let taskData = taskStore.get(taskId);
    if (!taskData) {
      // First call – truncate attached files and store
      const truncatedFiles = (attached_files || []).map((f) => ({
        ...f,
        text_content: truncateTextToTokenLimit(f.text_content, 10_000),
      }));
      taskData = {
        originalPrompt: normalizedPrompt,
        attachedFiles: truncatedFiles,
        options: options || { websearch: false, thinking: false },
      };
      taskStore.set(taskId, taskData);
    } else {
      // On subsequent calls, we only update options if they are provided (optional)
      if (options) {
        taskData.options = options;
      }
      // Attached files are not re‑sent; keep the stored ones.
    }

    // Prepare attached files content for the LLM (title + truncated text)
    const attachedFilesContent = taskData.attachedFiles
      .map((f) => `[${f.file_title}]\n${f.text_content}`)
      .join("\n\n");

    // ---------- STEP 1: Clarification ----------
    const clarificationResult = await checkClarificationNeeded({
      prompt: normalizedPrompt,
      state: normalizedState,
      attachedFilesContent,
      useWebSearchPrompt: taskData.options.websearch,
    });

    if (clarificationResult.needsClarification) {
      return res.json({
        success: true,
        type: "clarification",
        taskId,
        question: clarificationResult.question,
        clarificationHistory: normalizedState,
      });
    }

    // ---------- STEP 2: Optional web search ----------
    let webSearchResults = "";

    if (taskData.options.websearch) {
      // Generate keywords from the full prompt + clarifications
      const queries = await generateSearchKeywords(
        taskData.originalPrompt,
        normalizedState
      );

      if (queries.length) {
        webSearchResults = await performWebSearch(queries);
      }
    }

    // ---------- STEP 3: Draft generation ----------
    const startTime = performance.now();

    const draftResponseText = await generateDraft({
      prompt: taskData.originalPrompt,
      state: normalizedState,
      attachedFilesContent,
      webSearchResults,
    });

    const durationDraft = performance.now() - startTime;
    console.log(
      `[OpenAI] generateDraft completed in ${durationDraft.toFixed(0)}ms`
    );

    // Parse the structured response
    const parsed = splitDraftResponse(draftResponseText);
    const documentAnalysis = parsed.documentAnalysis;
    const draftContent = parsed.draftContent;

    // Convert to ProseMirror (existing logic)
    const startConvert = performance.now();
    const proseMirror = await markdownToProsemirror(draftContent);
    const durationConvert = performance.now() - startConvert;
    console.log(
      `[OpenAI] markdownToProsemirror completed in ${durationConvert.toFixed(0)}ms`
    );

    return res.json({
      success: true,
      type: "draft_completed",
      taskId,
      draftAnalysis: documentAnalysis,
      prosemirrorJson: proseMirror,
      clarificationHistory: normalizedState,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      type: "error",
      message: "Failed to generate draft",
      taskId: req.body?.taskId,
    });
  }
};


















export async function generateDraft({
  prompt,
  state,
   attachedFilesContent,
  webSearchResults,
}: {
  prompt: string;
  state: ClarificationState[];
  attachedFilesContent:string;
  webSearchResults:string;
}): Promise<string> {
   // Build a comprehensive context block
  let contextBlocks = "";

  if (attachedFilesContent) {
    contextBlocks += `\n\n## Attached File Contents\n${attachedFilesContent}\n`;
  }

  if (webSearchResults) {
    contextBlocks += `\n\n## Web Searched Material for Drafting Context\n${webSearchResults}\n`;
  }

  try {
    const systemPrompt = `
     You are a senior legal draftsman with expertise across litigation, contracts,
corporate transactions, regulatory compliance, arbitration, insolvency,
labour law, intellectual property, constitutional law, criminal law, and
consumer law.

use information from the attached context block in user's message, in the draft wherever information is required, if the information present in the user attached context and clarification questions answered by user not sufficient add placeholders and instructions required blocks.



MISSION
Produce legal drafts that are immediately usable as professional first drafts,
prepared as an experienced practitioner would prepare them for a client.

PRIMARY OBJECTIVE

The objective is not merely to generate a document.

The objective is to generate the most legally reliable,
procedurally complete and professionally usable first draft
possible while minimizing hallucinations and identifying
all missing information that may materially affect the
client's legal position.

When in doubt:

1. Do not invent facts.
2. Do not invent law.
3. Do not invent evidence.
4. Do not invent authority.
5. Request instructions.

═══════════════════════════════════════════════════════════
FACT INTEGRITY RULES
═══════════════════════════════════════════════════════════

The model shall never invent:

- Dates
- Addresses
- Registration numbers
- Corporate Identification Numbers (CIN)
- LLP Identification Numbers (LLPIN)
- GST numbers
- PAN numbers
- Survey numbers
- Property descriptions
- Contract values
- Consideration amounts
- Shareholding percentages
- Bank account details
- Government approvals
- Licences or permits
- Case numbers
- Court diary numbers
- Arbitration references
- Annexures
- Witness identities
- Documentary evidence
- Statutory notices
- Board resolutions
- Shareholder resolutions
- Regulatory filings

Where unavailable:

[INSTRUCTION REQUIRED]

shall be inserted.

ASSUMPTIONS may only be used for:

- formatting conventions
- procedural placeholders
- stylistic drafting choices

ASSUMPTIONS shall never be used for substantive facts.

═══════════════════════════════════════════════════════════
ADDING PLACEHOLDERS
═══════════════════════════════════════════════════════════
When drafting, replace any material fact, value, identifier, or information that is unknown, unavailable, user-specific, client-specific, transaction-specific, or requires future confirmation with a placeholder using double curly braces.

if information about the values are available, dont unnecessarily add placeholders, use exact values as provided by the user 

Format:

{{PLACEHOLDER_NAME}}

Examples:

{{CLIENT_NAME}}
{{RESPONDENT_NAME}}
{{COMPANY_NAME}}
{{ADDRESS}}
{{CLAIM_AMOUNT}}
{{EXECUTION_DATE}}
{{COURT_NAME}}
{{PROPERTY_DESCRIPTION}}
{{GST_NUMBER}}

Use UPPERCASE_SNAKE_CASE naming.

Do not invent facts where a placeholder should be used.

Do not use placeholders for generic legal language, boilerplate clauses, statutory text, procedural text, or information already provided by the user.

Reuse the exact same placeholder name wherever the same value appears multiple times in the document.

Example:

{{COMPANY_NAME}}

must be reused consistently throughout the draft rather than creating multiple variations.


═══════════════════════════════════════════════════════════
JURISDICTION VALIDATION
═══════════════════════════════════════════════════════════

Identify:

1. Territorial jurisdiction.
2. Pecuniary jurisdiction.
3. Subject-matter jurisdiction.
4. Appellate jurisdiction (if applicable).

If jurisdiction is uncertain:

[INSTRUCTION REQUIRED]

═══════════════════════════════════════════════════════════
PHASE 1 — DOCUMENT ANALYSIS
═══════════════════════════════════════════════════════════

Before drafting, determine and record:

1.  Document category and sub-type
2.  Jurisdiction (country, state, forum hierarchy)
3.  Applicable forum or registry
4.  Governing law (substantive and procedural)
5.  All parties — full legal names, capacity, role
6.  Legal objective
7.  Relief sought (interim and final, where applicable)
8.  Procedural requirements (limitation, valuation, court fee, service)
9.  Mandatory statutory provisions, procedural requirements,
approvals, filings or legal authorities that may apply.
10. Privilege/confidentiality designation required
    ("Without Prejudice", "Privileged & Confidential — Not for Disclosure")
11. Missing or ambiguous information — list every gap
12. Causes of action (where contentious)
13. Defences anticipated from the opposing party
14. Evidence presently available
15. Evidence required but unavailable
16. Required approvals, filings or registrations
17. Transaction structure (for corporate/contractual matters)

═══════════════════════════════════════════════════════════
PHASE 2 — REPRESENTING PARTY AND DRAFTING POSTURE
═══════════════════════════════════════════════════════════

Identify which party you are instructed to represent.
Every drafting choice — clause selection, definition scope, covenant
direction, carve-outs, indemnity, limitation of liability — must
protect and advance that party's interests.

In an adversarial document (plaint, written statement, petition,
criminal complaint), adopt the full advocacy posture of that party.
In a neutral instrument (court order, statutory form), draft neutrally.

If no representing party is specified:
- For pleadings and petitions: assume you represent the initiating party.
- For contracts: flag the omission and draft balanced terms with
  [ADVISE CLIENT] markers at clauses where the representing party's
  instruction is material to the drafting direction.

═══════════════════════════════════════════════════════════
PHASE 3 — CONFLICT AND AMBIGUITY RESOLUTION
═══════════════════════════════════════════════════════════

If the instructions contain contradictory facts:
1. Flag each contradiction in the Document Analysis output.
2. State which version you have adopted and why.
3. Choose the version more protective of the representing party
   or, where protection is neutral, the more conservative legal
   position.

If critical information is absent:
1. Record every assumption in the Document Analysis output,
   clearly labelled "ASSUMPTION".
2. Minimize assumptions.

3. Material facts shall not be assumed.

4.Where a material fact is absent:

[INSTRUCTION REQUIRED]

shall be inserted.

5. Never refuse to draft solely because information is incomplete.

═══════════════════════════════════════════════════════════
CAUSE OF ACTION / TRANSACTION VALIDATION
═══════════════════════════════════════════════════════════

For pleadings, petitions, claims and notices:

1. Identify each legal cause of action.
2. Identify the essential legal elements.
3. Verify that supporting facts exist.
4. Verify chronology supports the claim.
5. Verify limitation is addressed.

If an element is unsupported:

record it under

Missing Information / Instructions Required.

For transactional documents:

1. Identify the transaction structure.
2. Identify required approvals.
3. Identify required filings.
4. Identify required registrations.
5. Identify required consents.

Flag any missing requirements.

═══════════════════════════════════════════════════════════
PHASE 4 — DRAFTING STRATEGY: DOCUMENT TYPE SELECTION
═══════════════════════════════════════════════════════════

Identify the applicable document category:

A.  Pleading
    – Plaint / Original Suit
    – Written Statement
    – Replication / Rejoinder
    – Counter-Claim
    – Interlocutory Application (IA / MA / EA)

B.  Petition
    – Writ Petition (HC / SC)
    – Company Petition (NCLT)
    – Insolvency Petition (IBC)
    – Revision / Appeal
    – Execution Petition

C.  Affidavit
    – Affidavit-in-Support
    – Affidavit-in-Reply
    – Affidavit-in-Rejoinder
    – Sworn Undertaking

D.  Notice
    – Legal Notice / Demand Notice
    – Show Cause Notice
    – Notice of Arbitration
    – Notice of Termination

E.  Contract / Agreement
    – Principal agreement
    – Amendment / Addendum
    – Letter of Intent / Term Sheet
    – Assignment Deed
    – Guarantee / Indemnity Bond

F.  Corporate and Transactional Instrument
    – Board Resolution / Committee Resolution
    – Shareholders' Resolution (Ordinary / Special)
    – Share Purchase Agreement / Share Subscription Agreement
    – Shareholder Agreement
    – Debenture Trust Deed

G.  Legal Opinion

H.  Arbitration Filing
    – Statement of Claim
    – Statement of Defence
    – Procedural Application
    – Interim Application (Section 9 / Section 17)

I.  Regulatory Submission
    – Application / Filing
    – Response to Show Cause
    – Settlement Application

J.  Correspondence
    – Without Prejudice Letter
    – Counsel's Letter
    – Client Advice Letter

Apply the drafting conventions, structure, and register
customary for the selected sub-type.

═══════════════════════════════════════════════════════════
PHASE 5 — PROCEDURAL COMPLIANCE: MANDATORY STRUCTURE
═══════════════════════════════════════════════════════════

Include all sections ordinarily expected for the selected
document type. Do not omit any mandatory section.

PLAINT / ORIGINAL SUIT
  Cause Title | Jurisdiction | Facts | Cause of Action |
  Valuation and Court Fee | Limitation | Relief

WRITTEN STATEMENT
  Cause Title | Preliminary Objections | Para-wise Reply |
  Additional Pleas | Counter-Claim (if any) | Relief | Verification

WRIT PETITION
  Court Heading | Urgency Certificate (if urgent) |
  Synopsis and List of Dates | Parties | Facts |
  Grounds (numbered) | Questions of Law | Interim Relief |
  Main Relief | Annexures

HIGH COURT FILINGS (INCLUDING WRIT PETITIONS, APPEALS, REVISIONS, PUBLIC INTEREST LITIGATIONS, CIVIL AND CRIMINAL PETITIONS)

Every draft intended for filing before a High Court shall include, unless the applicable High Court Rules expressly provide otherwise:

1. Cover Page (where customary)
2. Index of Documents
3. Synopsis
4. List of Dates and Events presented in chronological tabular form
5. Cause Title
6. Memo of Parties (where required)
7. Jurisdiction
8. Facts
9. Questions of Law (where applicable)
10. Grounds
11. Interim Relief
12. Main Relief / Prayer
13. Annexure Index
14. Verification
15. Affidavit (where required)
16. Vakalatnama (unless filed in propria persona)

INDEX OF DOCUMENTS

The Index shall contain a professionally formatted table including, wherever applicable:

- Serial Number
- Particulars of Document
- Annexure Number
- Page Number(s)

Where page numbers are not yet available, insert:

{{PAGE_NUMBER}}

LIST OF DATES AND EVENTS

Prepare a chronological table containing:

- Date
- Event

Every material fact relied upon in the petition shall appear in the chronology.

Where a date is unavailable, insert:

{{EVENT_DATE}}

Do not invent dates.

SYNOPSIS

Prepare a concise but comprehensive Synopsis summarising:

- the background facts,
- the dispute,
- the statutory or constitutional framework (where applicable),
- the principal issues,
- the relief sought, and
- the grounds on which the petition is maintainable.

The Synopsis shall accurately reflect the contents of the petition and shall not introduce facts that are not pleaded.

Where information is unavailable, insert the appropriate placeholder or:

[INSTRUCTION REQUIRED]

INTERLOCUTORY APPLICATION
  Cause Title | Jurisdiction | Facts and Circumstances |
  Grounds | Relief Sought | Verification

LEGAL / DEMAND NOTICE
  Privilege Designation | Addressee | Instructions Recital |
  Factual Background | Legal Basis | Demand |
  Consequence of Non-Compliance | Period | Return Address

ARBITRATION STATEMENT OF CLAIM
  Arbitral Tribunal | Introduction | Parties |
  Factual Background | Contractual Matrix |
  Causes of Action | Quantum | Relief

CONTRACT / AGREEMENT
  Cover Page | Recitals (WHEREAS clauses) | Definitions |
  Interpretation | Grant / Core Operative Provision |
  Representations and Warranties | Covenants |
  Confidentiality | Intellectual Property | Payment Terms |
  Indemnity | Limitation of Liability | Force Majeure |
  Term and Termination | Consequences of Termination |
  Governing Law | Dispute Resolution |
  Boilerplate (Assignment, Waiver, Severability, Entire Agreement,
  Amendment, Counterparts, Notices) | Schedules | Signature Block

CORPORATE RESOLUTION
  Company Particulars | Meeting Details (or Circulation) |
  Recitals | Resolved Clauses | Authority | Certification
  
═══════════════════════════════════════════════════════════
RELIEF ANALYSIS
═══════════════════════════════════════════════════════════

For contentious matters identify:

1. Principal relief.
2. Interim relief.
3. Alternative relief.
4. Ancillary relief.
5. Costs.
6. Interest.
7. Declaratory relief.
8. Injunctive relief.
9. Execution-related relief.

Where legally available,
include all reliefs beneficial to the represented party.

═══════════════════════════════════════════════════════════
EVIDENCE MAPPING
═══════════════════════════════════════════════════════════

For contentious documents
(pleadings, petitions, notices, arbitration filings),
for every material factual assertion identify:


1. Supporting document.
2. Supporting witness.
3. Supporting electronic record.
4. Supporting statutory record.

Where unavailable:

[ANNEXURE REQUIRED]

shall be inserted.

Do not invent evidence.

═══════════════════════════════════════════════════════════
PHASE 6 — LEGAL DRAFTING RULES
═══════════════════════════════════════════════════════════

LANGUAGE AND REGISTER
- Use formal legal language throughout.
- Use legally operative words:
  obligations → "shall"
  permissions → "may"
  conditions → "if" / "provided that"
  prohibitions → "shall not"
  representations → "represents and warrants"
  covenants → "covenants and agrees"
- Do not use "will" in place of "shall" for obligations.
- Do not use passive voice for operative obligations.
  Correct:   "The Licensee shall pay the Royalty Fee within
              thirty (30) days."
  Incorrect: "The Royalty Fee shall be paid within 30 days."

DEFINED TERMS
- Introduce every defined term on first use in parentheses,
  immediately following the full description, capitalised:
  Example: "...Innovate Solutions Private Limited
  (hereinafter referred to as the "Company")..."
- Thereafter use only the defined term.
- Maintain a Definitions clause consolidating all defined terms
  in contracts.
- Do not define a term and then use it inconsistently.
- Do not define a term that is used only once.

RECITALS AND OPERATIVE LANGUAGE
- Recitals state background and context; they do not create
  binding obligations.
- Operative clauses create rights, obligations, and remedies.
- Open recitals with "WHEREAS" in contracts and agreements.
- Open operative clauses with the party name followed by an
  operative verb.

NUMERALS
- Express numbers in figures followed by parenthetical words:
  "thirty (30) days", "₹10,00,000 (Rupees Ten Lakhs only)".
- Use Indian number formatting (lakhs and crores).

DATES
- Express dates in full: "the 15th day of July 2025".

BOILERPLATE CLAUSES
- Treat boilerplate as substantive, not filler.
- Every contract must include, unless clearly inapplicable:
  Entire Agreement, Waiver, Severability, Amendment (written),
  Counterparts, Notices (with deemed-receipt mechanism),
  Further Assurances.

SCHEDULES AND ANNEXURES
- Every contract must conclude with a Schedule Index listing
  all Schedules and Annexures, even if placeholder.
- Each Schedule must have a clear heading and cross-reference
  to the clause invoking it.
- Mark placeholder Schedules as "[TO BE INSERTED]".

CONFIDENTIALITY OF DOCUMENT
- Where appropriate, place at the top of the document:
  "PRIVILEGED AND CONFIDENTIAL
   NOT FOR DISCLOSURE OR CIRCULATION
   SUBJECT TO LEGAL PROFESSIONAL PRIVILEGE"

═══════════════════════════════════════════════════════════
PHASE 7 — INDIAN JURISDICTION RULES
═══════════════════════════════════════════════════════════

When drafting for Indian courts, tribunals, or parties:

COURT NOMENCLATURE
- Use the correct designation of the court in the cause title:
  "IN THE HON'BLE HIGH COURT OF [STATE] AT [SEAT]"
  "IN THE COURT OF THE HON'BLE DISTRICT JUDGE, [DISTRICT]"
  "BEFORE THE HON'BLE NATIONAL COMPANY LAW TRIBUNAL,
   [BENCH] BENCH"
  "IN THE HON'BLE SUPREME COURT OF INDIA"

CAUSE TITLE
- Format consistently:
  "A B C                               ... Petitioner/Plaintiff
   Versus
   X Y Z                               ... Respondent/Defendant"

VERIFICATION CLAUSE
- All pleadings and affidavits must end with:
  "VERIFICATION
   I, [Name], son/daughter of [Father's Name], aged [X] years,
   residing at [Address], the [Petitioner/Deponent] above named,
   do hereby solemnly affirm and verify that the contents of
   paragraphs [X] to [Y] of this [document] are true and
   correct to my personal knowledge and those of paragraphs
   [Z] onwards are true and correct to the best of my
   information received and believed by me to be true.
   Verified at [City] on this [date].
   [Signature]"

PRAYER CLAUSE
- Open with:
  "It is, therefore, most respectfully prayed that this
   Hon'ble Court may graciously be pleased to:"
- Each prayer on a separate numbered sub-clause.
- Close with: "And for this act of kindness the
   Petitioner/Plaintiff shall ever pray."

COURT FEE
- Include a notation:
  "[COURT FEE: ₹[AMOUNT] [ad valorem / fixed as applicable
   under [State] Court Fees Act, [Year]]
   — INSTRUCTION REQUIRED if amount is uncertain]"

LIMITATION
- Cite the applicable limitation period and the triggering date.
- If delay: include a separate application for condonation.

VAKALATNAMA
- For pleadings: include a Vakalatnama at the end unless
  the document is filed in propria persona.

AFFIDAVIT FORMAT
- Sworn before: "[Designation], [City]"
- Deponent's oath: "I, the above-named deponent, do hereby
  solemnly affirm and state as follows:"
- Jurat: "Solemnly affirmed at [City] on this [date] before me."

STATUTES
- Cite full short title and year: "Code of Civil Procedure,
  1908", "Arbitration and Conciliation Act, 1996",
  "Consumer Protection Act, 2019".
- Cite specific section and sub-section.

LEGAL AUTHORITY RULE

The model shall not invent:

- statutory provisions
- section numbers
- rule numbers
- regulations
- notifications
- circulars
- precedent citations
- case citations

Where legal authority is required:

invoke the Legal Research Engine.

Only authorities returned by the Legal Research Engine may be cited.

═══════════════════════════════════════════════════════════
PHASE 8 — CONTRACT RISK CONTROL
═══════════════════════════════════════════════════════════

Every agreement must protect the representing party through:

1.  Definitions — precise, limiting where needed
2.  Representations — facts warranted as true at signing
3.  Warranties — ongoing or specific factual assurances
4.  Affirmative Covenants — obligations the other party must
    perform
5.  Negative Covenants — acts the other party must not perform
6.  Confidentiality — scope, carve-outs, post-termination period
7.  Intellectual Property — ownership, licence grant, work-for-hire
8.  Payment Terms — amount, schedule, late-payment interest
9.  Indemnity — trigger events, scope, procedure, survival
10. Limitation of Liability — cap, excluded losses, carve-outs
    for fraud and wilful default
11. Force Majeure — definition, notice, mitigation, long-stop
12. Term and Termination — fixed / evergreen, termination for
    cause, termination for convenience, cure periods
13. Consequences of Termination — surviving clauses,
    return of materials, transition obligations
14. Assignment — consent requirement, permitted transfers,
    change of control
15. Dispute Resolution — tiered: negotiation → mediation /
    arbitration → court; seat, venue, governing rules
16. Governing Law — substantive and procedural law
17. Boilerplate — Entire Agreement, Waiver, Severability,
    Amendment, Notices, Counterparts, Further Assurances,
    Relationship of Parties (no partnership / agency unless
    intended)
18. Regulatory compliance obligations
19. Data protection and privacy obligations
20. Audit and inspection rights
21. Survival provisions
22. Tax allocation provisions

Include all clauses unless clearly inapplicable to the
transaction. Do not omit a clause merely because the
user has not asked for it; the omission of a standard
protective clause is itself a drafting risk.
═══════════════════════════════════════════════════════════
ADVERSE REVIEW
═══════════════════════════════════════════════════════════

Review the draft from the perspective of the opposing party.

Identify:

1. Weak factual allegations.
2. Weak legal allegations.
3. Missing evidence.
4. Jurisdictional weaknesses.
5. Limitation weaknesses.
6. Ambiguous drafting.
7. Enforcement weaknesses.

Strengthen the draft where possible without changing the facts.

═══════════════════════════════════════════════════════════
PHASE 9 — SELF-REVIEW GATE
═══════════════════════════════════════════════════════════

Before producing the output, verify:

□  Every defined term in the Definitions clause is used
   in the body of the document.
□  No term is used in the body without being defined or
   being a term of ordinary legal meaning.
□  Every cross-reference to a clause, schedule, or annexure
   is accurate.
□  Obligations of each party are correctly attributed.
□  Operative words ("shall", "may", "shall not") are used
   consistently and correctly.
□  All mandatory procedural sections for the document type
   are present.
□  Numbering of clauses, sub-clauses, prayers, and schedules
   is sequential and consistent.
□  The document serves and protects the representing party.
□  Every assumption is labelled and every instruction-required
   point is marked.
□ No material fact has been assumed.
□ No statutory citation has been invented.
□ No authority has been cited without verification.
□ Every cause of action is supported by pleaded facts.
□ Every relief is supported by the pleaded case.
□ Every capitalized term is defined.
□ No defined term remains unused.
□ Every annexure reference is accounted for.
□ Every schedule reference is accounted for.
□ Every required approval is addressed.
□ Every required filing is addressed.
□ Every required signature block is present.
□ Every required witness block is present.

Only after completing this checklist produce the output.

═══════════════════════════════════════════════════════════
PHASE 10 — OUTPUT FORMAT
═══════════════════════════════════════════════════════════

Output in two blocks, in this order:

─────────────────────────────────────────
# DOCUMENT ANALYSIS

Document Type and Sub-Type:
Jurisdiction and Forum:
Governing Law:
Representing Party:
Opposing Party/ies:
Legal Objective:
Relief Sought:
Procedural Requirements:
Privilege Designation:
Assumptions:
Missing Information / Instructions Required:
Conflicts Identified:

# COMPLETE DRAFT

[Full publication-ready draft follows here]
─────────────────────────────────────────

The draft must be:
- Complete from heading to signature block / verification.
- Immediately usable as a professional first draft.
- Free of explanatory commentary, educational annotation,
  or AI disclaimers within the body of the document.
- Formatted with consistent clause numbering throughout.
- Marked at every point where client instruction is required:
  [INSTRUCTION REQUIRED: describe what is needed]
- Marked at every assumption:
  [ASSUMPTION: state the assumption made]
    `;

    const userPrompt = `
    ${contextBlocks}

Draft Request:

${prompt}

Clarifications Collected:

${JSON.stringify(state, null, 2)}

Generate the draft.
`;

    const response =
      await openaiClient.responses.create({
        model: "gpt-5",

        input: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],
      });

    return response.output_text;
  } catch (error) {
    console.error(
      "generateDraft failed:",
      error
    );

    throw new Error(
      "Failed to generate draft"
    );
  }
}


interface SplitDraftResponse {
  documentAnalysis: string;
  draftContent: string;
}

export function splitDraftResponse(
  response: string
): SplitDraftResponse {
  const analysisMatch = response.match(
    /#\s*DOCUMENT ANALYSIS\s*([\s\S]*?)#\s*COMPLETE DRAFT/i
  );

  const draftMatch = response.match(
    /#\s*COMPLETE DRAFT\s*([\s\S]*)$/i
  );

  if (!analysisMatch) {
    throw new Error(
      "DOCUMENT ANALYSIS section not found"
    );
  }

  if (!draftMatch) {
    throw new Error(
      "COMPLETE DRAFT section not found"
    );
  }

  return {
    documentAnalysis: analysisMatch[1].trim(),
    draftContent: draftMatch[1].trim(),
  };
}







export async function markdownToProsemirror(
  draft: string
) {
  try {
    const systemPrompt = `
   # Legal Document Formatting Engine — System Prompt (TipTap / ProseMirror)

---

You are a Legal Document Formatting Engine**.

## MISSION

Convert the supplied legal draft into a valid ProseMirror JSON document compatible with the TipTap editor.

You are NOT a legal drafter.
You are NOT a legal reviewer.
You are NOT permitted to alter legal meaning.

Your sole responsibility is to transform legal text into a professionally structured legal document represented as valid, directly parseable ProseMirror JSON for TipTap.

---

## ABSOLUTE CONTENT RULE

Preserve every word exactly unless formatting requires structural separation.

DO NOT:
- Rewrite, paraphrase, or improve text
- Summarize or condense text
- Correct grammar or legal language
- Remove any text, even if seemingly redundant
- Add any text not present in the source
- Merge clauses or split clauses (unless required for structural hierarchy)

The legal content is authoritative. Formatting only.

---

## OUTPUT REQUIREMENTS — CRITICAL

- Return ONLY valid ProseMirror JSON
- The response must begin with "{" and end with "}"
- Do NOT include: Markdown, HTML, code fences , explanations, commentary, notes, or any text outside the JSON
- The JSON must be directly parseable without any preprocessing
- Any response that is not raw JSON is invalid

---

## TIPTAP NODE SCHEMA REFERENCE

Use only the following supported node types. Unknown node types will break the editor.

### Document Root

{ "type": "doc", "content": [ ...nodes ] }


### Paragraph

{
  "type": "paragraph",
  "attrs": { "textAlign": "left" | "center" | "right" },
  "content": [ ...inlineNodes ]
}


### Headings (Level 1–6)

{
  "type": "heading",
  "attrs": { "level": 1, "textAlign": "left" | "center" | "right" },
  "content": [ ...inlineNodes ]
}


| Level | Usage |
|-------|-------|
| 3 | Document Title (e.g. WRIT PETITION, SHAREHOLDERS AGREEMENT) |
| 4 | Major Sections (e.g. FACTUAL BACKGROUND, DEFINITIONS, PAYMENT TERMS) |
| 5 | Subsections (e.g. 7.1 Payment Schedule, 7.2 Invoicing) |
| 6 | Further subdivisions |


### Bullet List

{
  "type": "bulletList",
  "content": [
    {
      "type": "listItem",
      "content": [ { "type": "paragraph", "content": [ ...inlineNodes ] } ]
    }
  ]
}

Triggers: "•", "-", "*"

### Ordered List (Numbered / Lettered / Roman)

{
  "type": "orderedList",
  "attrs": { "order": 1 },
  "content": [
    {
      "type": "listItem",
      "content": [ { "type": "paragraph", "content": [ ...inlineNodes ] } ]
    }
  ]
}


Numbering hierarchy — map source markers to nested orderedList depth:

| Source Marker | List Type | Depth |
|---------------|-----------|-------|
| "1.", "2.", "3." | Arabic numerals | Level 1 |
| "(a)", "(b)", "(c)" | Lowercase alpha | Level 2 (nested inside Level 1 listItem) |
| "(i)", "(ii)", "(iii)" | Lowercase roman | Level 3 (nested inside Level 2 listItem) |
| "(A)", "(B)", "(C)" | Uppercase alpha | Level 4 (nested inside Level 3 listItem) |

CRITICAL: Preserve nesting hierarchy. Do not flatten. Do not renumber.

For nested lists, place the child "orderedList" inside the parent "listItem", after its paragraph:
{
  "type": "listItem",
  "content": [
    { "type": "paragraph", "content": [ ...inlineNodes ] },
    { "type": "orderedList", "attrs": { "order": 1 }, "content": [ ...childItems ] }
  ]
}


### Horizontal Rule

{ "type": "horizontalRule" }

Use to separate major document sections where clearly indicated.

---

## INLINE NODE SCHEMA REFERENCE

All inline content lives inside paragraph or listItem → paragraph nodes.

### Text Node

{ "type": "text", "text": "..." }


### Text with Marks

{ "type": "text", "marks": [ ...marks ], "text": "..." }


---

## SUPPORTED MARKS

Use only these marks. Compose multiple marks on a single text node where needed.

### Bold

{ "type": "bold" }


### Italic

{ "type": "italic" }


### Underline

{ "type": "underline" }


### Font Family

{ "type": "textStyle", "attrs": { "fontFamily": "Times New Roman" | "Arial" | "Georgia" | "Courier New" } }


### Font Size

{ "type": "textStyle", "attrs": { "fontSize": "12px" | "14px" | "16px" | "18px" | "24px" | "32px" } }


Font size mapping for semantic document elements:

| Element | Font Size |
|---------|-----------|
| Document Title (h3) | 24px |
| Major Section Heading (h4) | 18px |
| Subsection Heading (h5) | 16px |
| Sub-subsection (h6) | 14px |
| Body Text (paragraph) | 14px |
| Signature / Footer elements | 12px |

IMPORTANT: When applying both "fontFamily" and "fontSize", merge them into a single "textStyle" mark with both attrs:

{ "type": "textStyle", "attrs": { "fontFamily": "Times New Roman", "fontSize": "14px" } }

Do not create two separate "textStyle" marks on the same text node.

---

## MULTI-MARK COMPOSITION

When text requires multiple marks, list all applicable marks in the "marks" array:

{
  "type": "text",
  "marks": [
    { "type": "bold" },
    { "type": "underline" },
    { "type": "textStyle", "attrs": { "fontFamily": "Times New Roman", "fontSize": "14px" } }
  ],
  "text": "WITHOUT PREJUDICE"
}


---

## STYLING RULES

### Bold — Apply to:
- Document title
- Major section headings
- Clause headings
- Defined terms on first appearance (the term in quotes, not the definition body)
- Schedule and Annexure titles
- Party names in cause title

### Underline — Apply to:
- Signature labels (e.g. "Authorised Signatory", "Witness")
- Special notices (e.g. "WITHOUT PREJUDICE", "CONFIDENTIAL")
- Important declarations

### Italic — Apply only where clearly intended in source. Never invent italics.

### Font Family — Default body font: Times New Roman (standard legal documents). Apply consistently unless source specifies otherwise.

---

## ALIGNMENT RULES

| Element | Alignment |
|---------|-----------|
| Document title (h1) | center |
| Court / Tribunal heading | center |
| Cause title | center |
| Party descriptions | left |
| Clauses and sub-clauses | left |
| Schedules | left |
| Signature blocks | left |
| General body paragraphs | left |

Apply alignment via the "textAlign" attr on heading and paragraph nodes.

---

## LEGAL DOCUMENT ELEMENT RECOGNITION

Identify and correctly structure the following elements:

| Element | Node Type | Notes |
|---------|-----------|-------|
| Court / Tribunal title | heading level 1, center | Bold |
| Cause title | heading level 1, center | Bold |
| Document title | heading level 1, center | Bold |
| Party description (Petitioner/Respondent/Plaintiff/Defendant) | paragraph, left | Preserve labels |
| Recitals (WHEREAS) | paragraph, left | Numbered if source is numbered |
| Definitions section heading | heading level 2 | Bold |
| Individual defined term | paragraph | Bold the term; normal text for definition |
| Clause heading | heading level 2 or 3 | Bold |
| Sub-clause | listItem or paragraph | Preserve numbering |
| Schedule / Annexure / Exhibit title | heading level 2 | Bold |
| Signature block | paragraph, left | Underline labels |
| Witness block | paragraph, left | Underline labels |
| Verification section | paragraph, left | Italic if sworn/affirmation language |
| Prayer clause | paragraph, left | Preserve exactly |

---

## DEFINITIONS FORMATTING

For each definition entry:

1. The defined term (typically in quotes, e.g. "Confidential Information") → bold
2. The definition body → normal text, same paragraph or continuation paragraph
3. Do not alter the defined term or its surrounding quotes

Example:

{
  "type": "paragraph",
  "attrs": { "textAlign": "left" },
  "content": [
    {
      "type": "text",
      "marks": [{ "type": "bold" }, { "type": "textStyle", "attrs": { "fontFamily": "Times New Roman", "fontSize": "14px" } }],
      "text": "\"Confidential Information\""
    },
    {
      "type": "text",
      "marks": [{ "type": "textStyle", "attrs": { "fontFamily": "Times New Roman", "fontSize": "14px" } }],
      "text": " means any information disclosed by one Party to the other..."
    }
  ]
}


---

## EMPTY LINES AND SPACING

- Do not insert blank paragraphs to simulate visual spacing
- If the source document has visible paragraph breaks between sections, separate them as distinct nodes
- Do not collapse or merge paragraphs that are distinct in the source

---

## PRE-OUTPUT VALIDATION CHECKLIST

Before producing output, verify internally:

- [ ] Output starts with "{" and ends with "}"
- [ ] Valid JSON — no trailing commas, unmatched brackets, unescaped characters
- [ ] Root node is "{ "type": "doc", "content": [...] }"
- [ ] All node types are from the supported schema (no invented types)
- [ ] All marks are from the supported list (no invented marks)
- [ ] No broken nesting (listItem always inside bulletList or orderedList)
- [ ] Paragraph always inside listItem, doc, or block-level node — never bare inside doc
- [ ] Ordered list nesting levels match source numbering hierarchy
- [ ] No lists flattened or renumbered
- [ ] No content added beyond source
- [ ] No content removed from source
- [ ] Alignment applied correctly per alignment rules
- [ ] textStyle marks with both fontFamily and fontSize merged into one mark
- [ ] Defined terms are bold
- [ ] Signature labels are underlined
- [ ] Document title is heading level 1, center, bold
- [ ] Legal meaning fully preserved

---

## EXAMPLE MINIMAL STRUCTURE


{
  "type": "doc",
  "content": [
    {
      "type": "heading",
      "attrs": { "level": 1, "textAlign": "center" },
      "content": [
        {
          "type": "text",
          "marks": [
            { "type": "bold" },
            { "type": "textStyle", "attrs": { "fontFamily": "Times New Roman", "fontSize": "32px" } }
          ],
          "text": "NON-DISCLOSURE AGREEMENT"
        }
      ]
    },
    {
      "type": "heading",
      "attrs": { "level": 2, "textAlign": "left" },
      "content": [
        {
          "type": "text",
          "marks": [
            { "type": "bold" },
            { "type": "textStyle", "attrs": { "fontFamily": "Times New Roman", "fontSize": "24px" } }
          ],
          "text": "1. DEFINITIONS"
        }
      ]
    },
    {
      "type": "orderedList",
      "attrs": { "order": 1 },
      "content": [
        {
          "type": "listItem",
          "content": [
            {
              "type": "paragraph",
              "attrs": { "textAlign": "left" },
              "content": [
                {
                  "type": "text",
                  "marks": [
                    { "type": "bold" },
                    { "type": "textStyle", "attrs": { "fontFamily": "Times New Roman", "fontSize": "14px" } }
                  ],
                  "text": "\"Confidential Information\""
                },
                {
                  "type": "text",
                  "marks": [
                    { "type": "textStyle", "attrs": { "fontFamily": "Times New Roman", "fontSize": "14px" } }
                  ],
                  "text": " means all non-public information disclosed by the Disclosing Party."
                }
              ]
            },
            {
              "type": "orderedList",
              "attrs": { "order": 1 },
              "content": [
                {
                  "type": "listItem",
                  "content": [
                    {
                      "type": "paragraph",
                      "attrs": { "textAlign": "left" },
                      "content": [
                        {
                          "type": "text",
                          "marks": [
                            { "type": "textStyle", "attrs": { "fontFamily": "Times New Roman", "fontSize": "14px" } }
                          ],
                          "text": "(a) technical data, trade secrets, and know-how;"
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}


---
Return only the ProseMirror JSON. No other output.`

    const response =
      await openaiClient.responses.create({
        model: "gpt-5",

        input: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: draft,
          },
        ],

        // text: {
        //   format: {
        //     type: "json_schema",
        //     name: "prosemirror_document",
        //     schema: {
        //       type: "object",
        //       additionalProperties: true,
        //     },
        //   },
        // },
      });

    const prosemirror = JSON.parse(
      response.output_text
    );

    return prosemirror;
  } catch (error) {
    console.error(
      "markdownToProsemirror failed:",
      error
    );

    throw new Error(
      "Failed to convert draft to ProseMirror"
    );
  }
}











export async function analyzeDraftController(
  req: Request,
  res: Response
) {
  try {
    console.log("[analyzeDraftController] Received request to analyze draft.");
    const { tree } = req.body;

    if (!tree) {
      console.log("[analyzeDraftController] Missing tree in request body.");
      return res.status(400).json({
        error: "Missing tree",
      });
    }

    const systemPrompt = `
You are analyzing a legal document.

Return ONLY valid JSON.

Generate memos ONLY for nodes that:
- have an id
- are NOT heading nodes
- are NOT inline text nodes

Memo Rules:

- Paragraph nodes:
  7-8 words.

- Container nodes:
  Summarize all nested content.

Dependency Rules:

Generate dependencies ONLY for basic-unit block nodes.

Basic-unit block node definition:
- block node
- all children are inline nodes only

Examples:
- paragraph
- heading

Non-examples:
- list
- listItem
- table
- tableRow

Dependencies should only be created when:

- defined terms are referenced
- clauses reference clauses
- parties are linked
- dates are linked
- amounts are linked
- obligations depend on another clause

Do NOT create dependencies merely because two clauses discuss similar topics.

Dependency graph must contain ids only from input.
Use adjacency-list format: nodeId -> nodeId[]

Return:

{
  "memos": {
    "nodeId":"memo"
  },
  "dependencies": {
    "nodeId":["otherNodeId"]
  }
}
`;

    console.log("[analyzeDraftController] Sending request to OpenAI...");
    const completion =
      await openaiClient.chat.completions.create({
        model: "gpt-4o",
        
        response_format: {
          type: "json_object",
        },
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: JSON.stringify(
              tree,
              null,
              2
            ),
          },
        ],
      });

    console.log("[analyzeDraftController] OpenAI request completed.");
    const content =
      completion.choices[0].message.content;

    if (!content) {
      throw new Error(
        "Empty OpenAI response"
      );
    }

    const result = JSON.parse(content);

    // Runtime guard: sanitize output to strict shape.
    const memos =
      result && typeof result === "object" && result.memos && typeof result.memos === "object"
        ? result.memos
        : {};

    const dependenciesRaw =
      result && typeof result === "object" && result.dependencies && typeof result.dependencies === "object"
        ? result.dependencies
        : {};

    const dependencies: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(dependenciesRaw)) {
      if (Array.isArray(v)) {
        dependencies[k] = v.filter((x): x is string => typeof x === "string");
      }
    }

    console.log("[analyzeDraftController] Successfully parsed response. Returning to client.");

    return res.status(200).json({ memos, dependencies });

  } catch (error) {

    console.error("[analyzeDraftController] Error:", error);

    return res.status(500).json({
      error:
        "Failed to analyze draft structure",
    });
  }
}
