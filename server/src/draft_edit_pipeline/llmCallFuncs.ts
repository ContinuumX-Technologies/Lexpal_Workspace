import openaiClient from "../infra/openai.client";


//------------------
//  TYPES
//------------------

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export interface ToolCall {
    id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
}



// --- Our LLMService interface (same as before) ---
export interface LLMService {
  complete(prompt: string): Promise<LLMResponse>;
  completeWithToolResults(
    messages: any[],
    tools?: ToolDefinition[]
  ): Promise<LLMResponse>;
}



// --- Convert our ToolDefinition to OpenAI's tool format ---
const toOpenAITools = (tools?: ToolDefinition[]) =>
  tools?.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  })) ?? undefined;




// --- Convert OpenAI message tool_calls to our format ---
const toToolCalls = (msg: any): ToolCall[] | undefined =>
  msg.tool_calls?.map((tc: any, idx: number) => ({
    // Required for feeding assistant tool_calls back into chat.completions.create.
    // Missing this causes: 400 Missing required parameter: messages[x].tool_calls[y].id
    id: tc.id ?? `tool_call_${idx}`,
    name: tc.function.name,
    arguments:
      typeof tc.function.arguments === 'string'
        ? JSON.parse(tc.function.arguments)
        : (tc.function.arguments ?? {}),
  }));





// --- Adapter class  ---
export const openaiLLM = (model: string = 'gpt-4o'): LLMService => ({

  // Simple prompt, no tools – used for intent clarification & content generation
  async complete(prompt) {
    const response = await openaiClient.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }]
      
    });
    const msg = response.choices[0].message;
    return {
      content: msg.content ?? ''
     
    };
  },



  // Used in edit planning loop – sends existing conversation and tools
  async completeWithToolResults(messages, tools) {
    const response = await openaiClient.chat.completions.create({
      model,
      messages,             // Already contains system, user, assistant, tool messages
      tools: toOpenAITools(tools),
    });
    const msg = response.choices[0].message;
    return {
      content: msg.content ?? '',
      toolCalls: toToolCalls(msg),
    };
  },

});
