import dotenv from "dotenv";
dotenv.config();

const ELASTICSEARCH_URL = (process.env.ELASTICSEARCH_URL || "http://localhost:9200").replace(/\/$/, "");
const ELASTICSEARCH_API_KEY = process.env.ELASTICSEARCH_API_KEY;
const ELASTICSEARCH_USERNAME = process.env.ELASTICSEARCH_USERNAME;
const ELASTICSEARCH_PASSWORD = process.env.ELASTICSEARCH_PASSWORD;

type JsonBody = Record<string, unknown> | Array<unknown>;

export const ENRICHMENT_INDEX =
  process.env.ELASTICSEARCH_ENRICHMENT_INDEX || "supreme_court_enrichment_v1";

function headers(extra?: Record<string, string>) {
  const base: Record<string, string> = {
    "content-type": "application/json",
    ...extra,
  };

  if (ELASTICSEARCH_API_KEY) {
    base.authorization = `ApiKey ${ELASTICSEARCH_API_KEY}`;
  } else if (ELASTICSEARCH_USERNAME && ELASTICSEARCH_PASSWORD) {
    base.authorization = `Basic ${Buffer.from(
      `${ELASTICSEARCH_USERNAME}:${ELASTICSEARCH_PASSWORD}`
    ).toString("base64")}`;
  }

  return base;
}

export async function elasticsearchRequest<T>(
  path: string,
  options: {
    method?: string;
    body?: JsonBody | string;
    headers?: Record<string, string>;
    allowNotFound?: boolean;
  } = {}
): Promise<T> {
  const method = options.method || "GET";
  const body =
    typeof options.body === "string"
      ? options.body
      : options.body
        ? JSON.stringify(options.body)
        : undefined;

  const response = await fetch(`${ELASTICSEARCH_URL}${path}`, {
    method,
    headers: headers(options.headers),
    body,
  });

  if (response.status === 404 && options.allowNotFound) {
    return undefined as T;
  }

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Elasticsearch ${method} ${path} failed (${response.status}): ${text}`
    );
  }

  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export async function elasticsearchNdjsonRequest<T>(
  path: string,
  ndjson: string
): Promise<T> {
  return elasticsearchRequest<T>(path, {
    method: "POST",
    body: ndjson.endsWith("\n") ? ndjson : `${ndjson}\n`,
    headers: { "content-type": "application/x-ndjson" },
  });
}

export async function indexExists(indexName = ENRICHMENT_INDEX): Promise<boolean> {
  const response = await fetch(`${ELASTICSEARCH_URL}/${indexName}`, {
    method: "HEAD",
    headers: headers(),
  });

  if (response.status === 404) return false;
  if (!response.ok) {
    throw new Error(`Elasticsearch HEAD /${indexName} failed (${response.status})`);
  }

  return true;
}
