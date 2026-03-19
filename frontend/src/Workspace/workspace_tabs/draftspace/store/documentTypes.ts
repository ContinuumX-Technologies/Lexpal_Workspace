export type Span = {
    text: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
};

export type BlockNodeType = "document" | "section" | "clause" | "paragraph" | "list";

export type BlockNode = {
    id: string;
    type: BlockNodeType;
    number?: string;
    title?: string;
    content?: Span[];
    children?: BlockNode[];
};
