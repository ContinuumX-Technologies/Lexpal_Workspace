// server/src/utils/normalizer.util.ts

const FILLER_WORDS = new Set(["the", "of", "versus", "vs", "v", "in", "re", "and", "&"]);
const VS_PATTERN = /\bversus\b|\bvs\.?\b|\bv\.(?=\s|$)/gi;
const PUNCT_PATTERN = /[^a-z0-9\s]/g;
const WS_PATTERN = /\s+/g;

/**
 * Normalizes initials (e.g., "K. M. Kanavi" -> "KM Kanavi")
 * This is crucial for matching user queries where initials are typed without spaces.
 */
export function joinInitials(text: string): string {
    if (!text) return "";
    return text.replace(/\b([a-zA-Z])\.(?:\s*([a-zA-Z])\.)*/g, (match) => {
        return match.replace(/[\.\s]/g, '');
    });
}

export function normalizeText(text: string): string {
    if (!text) return "";
    let t = text.toLowerCase();
    t = joinInitials(t);
    t = t.replace(VS_PATTERN, " vs ");
    t = t.replace(PUNCT_PATTERN, " ");
    t = t.replace(WS_PATTERN, " ").trim();
    return t;
}

export function tokenize(text: string, removeStopwords: boolean = true): string[] {
    const norm = normalizeText(text);
    let tokens = norm.split(" ");
    if (removeStopwords) {
        tokens = tokens.filter(t => !FILLER_WORDS.has(t));
    }
    return tokens;
}

/**
 * Extracts petitioner, respondent, and generates a reversed title for indexing.
 */
export function generateTitleMetadata(title: string) {
    if (!title) return { normalized_title: "", petitioner: "", respondent: "", reversed_title: "" };
    
    let t = title.toLowerCase();
    t = joinInitials(t);
    t = t.replace(VS_PATTERN, " vs ");
    
    const parts = t.split(" vs ");
    let petitioner = "";
    let respondent = "";
    let reversed_title = "";

    if (parts.length >= 2) {
        petitioner = parts[0].replace(PUNCT_PATTERN, " ").replace(WS_PATTERN, " ").trim();
        // Handle cases where there might be multiple "vs" by joining the rest
        respondent = parts.slice(1).join(" ").replace(PUNCT_PATTERN, " ").replace(WS_PATTERN, " ").trim();
        reversed_title = `${respondent} vs ${petitioner}`;
    }

    const normalized_title = t.replace(PUNCT_PATTERN, " ").replace(WS_PATTERN, " ").trim();

    return {
        normalized_title,
        petitioner,
        respondent,
        reversed_title
    };
}