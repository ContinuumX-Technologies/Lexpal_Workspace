export type Span = {
    text: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    color?: string;
    fontFamily?: string;
    fontSize?: string;
    highlight?: string;
};

export type BlockNodeType = "document" | "section" | "clause" | "paragraph" | "list" | "table" | "tableRow" | "tableCell" | "image";

export type BlockNode = {
    id: string;
    type: BlockNodeType;
    number?: string;
    title?: string;
    content?: Span[];
    children?: BlockNode[];
    meta?: {
        align?: string;
        [key: string]: any;
    };
};
