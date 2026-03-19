import { z } from "zod";

export const SpanSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
//   font_size: z.number().optional()
});

export const BlockSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    id: z.string().optional(),

    // ✅ MATCH FRONTEND TYPES
    type: z.enum([
      "document",
      "section",
      "clause",
      "paragraph",
      "list"
    ]),

    number: z.string().optional(),
    title: z.string().optional(),

    // ✅ MATCH content (not spans)
    content: z.array(SpanSchema).optional(),

    // ✅ recursive children
    children: z.array(BlockSchema).optional()
  })
);

export const TemplateSchema = z.object({
  draft_name: z.string(),
  blocks: z.array(z.any()) // as you intended
});

export const IntentResponseSchema = z.object({
  intent: z.enum(["edit_document", "create_document", "clarify"]),
  draft_name: z.string().optional(),
  draft_choices: z.array(z.string()).optional(), // ✅ ADD THIS
  operations: z.array(z.any()).optional()
});



export type Template = z.infer<typeof TemplateSchema>;
export type Block = z.infer<typeof BlockSchema>;
export type IntentResponse = z.infer<typeof IntentResponseSchema>;