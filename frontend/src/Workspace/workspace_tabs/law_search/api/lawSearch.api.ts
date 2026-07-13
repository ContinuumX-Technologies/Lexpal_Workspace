export type ConversationListItem = {
  id: string;
  title: string;
};

export type AttachmentMetadata = {
  id: string;
  file_name: string;
  size: number;
  mime_type: string;
};

export type DiscoveredLaw = {
  act_name: string;
  section_no: string;
  chapter_name: string | null;
  chapter_code: string | null;
  act_year: string | null;
  chunk_id: string | null;
  law_text: string;
  reasoning: string;
  relevance_score: number;
};

export type HistoricMessage = {
  id: string;
  convo_id: string;
  sender: "AI" | "User";
  content: string;
  createdAt: string;
  attachments: string[];
  attachment_metadata: AttachmentMetadata[];
  discovered_laws: DiscoveredLaw[];
  client_message_id: string | null;
};

export type LawLookupResponse = {
  act_name: string;
  section_no: string;
  chapter_name: string | null;
  chapter_code: string | null;
  act_year: string | null;
  chunk_id: string | null;
  law_text: string;
  metadata: Record<string, unknown>;
};

const throwHttpError = async (res: Response): Promise<never> => {
  let message = `Request failed with status ${res.status}`;

  try {
    const body = (await res.json()) as { message?: string };
    if (body?.message) {
      message = body.message;
    }
  } catch {
    // ignore JSON parse failures and keep generic message
  }

  throw new Error(message);
};

export const fetchHistoricConversations = async (
  signal?: AbortSignal
): Promise<ConversationListItem[]> => {
  const res = await fetch("/api/ai-counsel/conversations", {
    method: "GET",
    credentials: "include",
    signal,
  });

  if (!res.ok) {
    await throwHttpError(res);
  }

  const body = (await res.json()) as {
    conversations?: ConversationListItem[];
  };

  return Array.isArray(body.conversations) ? body.conversations : [];
};

export const fetchConversationMessages = async (
  conversationId: string,
  signal?: AbortSignal
): Promise<HistoricMessage[]> => {
  const encodedId = encodeURIComponent(conversationId);

  const res = await fetch(`/api/ai-counsel/conversations/${encodedId}/messages`, {
    method: "GET",
    credentials: "include",
    signal,
  });

  if (!res.ok) {
    await throwHttpError(res);
  }

  const body = (await res.json()) as {
    messages?: HistoricMessage[];
  };

  return Array.isArray(body.messages) ? body.messages : [];
};

export const fetchLawSection = async (
  actName: string,
  sectionNo: string,
  signal?: AbortSignal
): Promise<LawLookupResponse> => {
  const params = new URLSearchParams({
    act_name: actName,
    section_no: sectionNo,
  });

  const res = await fetch(`/api/ai-counsel/laws/section?${params.toString()}`, {
    method: "GET",
    credentials: "include",
    signal,
  });

  if (!res.ok) {
    await throwHttpError(res);
  }

  const body = (await res.json()) as {
    law?: LawLookupResponse;
  };

  if (!body.law) {
    throw new Error("Law lookup returned an empty result");
  }

  return body.law;
};

