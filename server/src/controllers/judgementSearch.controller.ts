import { Request, Response } from "express";

interface Judgement {
  id: string;
  title: string;
  court: string;
  citation: string;
  date: string;
  excerpt: string;
  bench: string[];
}

const mockJudgements: Judgement[] = [
  {
    id: "1",
    title: "State of New York v. Marcus Thompson",
    court: "Supreme Court of New York",
    citation: "2026 INSC 4321",
    date: "26 January 2025",
    excerpt: "The court must balance the Fourth Amendment protections against the practical realities of modern digital forensics...",
    bench: ["Hon'ble Justice S. Roberts", "Hon'ble Justice A. Kagan"]
  },
  {
    id: "2",
    title: "Kesavananda Bharati v. State of Kerala",
    court: "Supreme Court of India",
    citation: "AIR 1973 SC 1461",
    date: "24 April 1973",
    excerpt: "The basic structure of the Constitution cannot be amended by the Parliament under Article 368...",
    bench: ["Hon'ble Justice S.M. Sikri", "Hon'ble Justice J.M. Shelat"]
  },
  {
    id: "3",
    title: "Maneka Gandhi v. Union of India",
    court: "Supreme Court of India",
    citation: "1978 AIR 597",
    date: "25 January 1978",
    excerpt: "Article 21 is not a mere restriction on the executive, but also on the legislature. Any law depriving a person of personal liberty must be just, fair and reasonable...",
    bench: ["Hon'ble Justice M.H. Beg", "Hon'ble Justice Y.V. Chandrachud"]
  },
  {
    id: "4",
    title: "Roe v. Wade",
    court: "US Supreme Court",
    citation: "410 U.S. 113",
    date: "22 January 1973",
    excerpt: "The Due Process Clause of the Fourteenth Amendment to the U.S. Constitution provides a fundamental right to privacy that protects a pregnant woman's liberty to choose to have an abortion...",
    bench: ["Justice Harry Blackmun"]
  }
];

export const judgementSearchController = async (req: Request, res: Response) => {
  try {
    const { query } = req.query;

    if (!query) {
      return res.json({ results: mockJudgements });
    }

    const filteredResults = mockJudgements.filter(j => 
      j.title.toLowerCase().includes((query as string).toLowerCase()) ||
      j.excerpt.toLowerCase().includes((query as string).toLowerCase())
    );

    return res.json({ results: filteredResults });
  } catch (error) {
    console.error("❌ Judgement Search Error:", error);
    return res.status(500).json({ error: "Search failed" });
  }
};
