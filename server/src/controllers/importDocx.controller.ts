import { Request, Response } from "express";
import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";

// Helper to convert half-points to pixels (approximate)
const halfPtToPx = (halfPt: number) => Math.round(halfPt * 0.666);

// Helper to determine mime type
const getMimeType = (filename: string) => {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png': return 'image/png';
    case 'jpeg':
    case 'jpg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'svg': return 'image/svg+xml';
    default: return 'image/png';
  }
};

const parseDocxToHtml = (buffer: Buffer): string => {
  const zip = new AdmZip(buffer);
  const documentXml = zip.readAsText("word/document.xml");
  const relsXml = zip.readAsText("word/_rels/document.xml.rels");

  if (!documentXml) {
    throw new Error("Invalid DOCX file: missing word/document.xml");
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false,
    isArray: (name) => {
      return ["w:p", "w:r", "w:t", "w:tbl", "w:tr", "w:tc", "Relationship", "w:drawing", "wp:inline", "a:graphic", "a:graphicData", "pic:pic", "pic:blipFill", "a:blip"].includes(name);
    }
  });

  // Parse Relationships
  const imageMap = new Map<string, string>(); // rId -> base64 string
  if (relsXml) {
    const relsObj = parser.parse(relsXml);
    const relationships = relsObj["Relationships"]?.["Relationship"] || [];
    for (const rel of relationships) {
      const id = rel["@_Id"];
      const target = rel["@_Target"];
      const type = rel["@_Type"];
      
      if (type && type.endsWith("image") && target) {
        // target is usually "media/image1.jpeg"
        const imagePath = target.startsWith("word/") ? target : `word/${target}`;
        const imageEntry = zip.getEntry(imagePath);
        if (imageEntry) {
          const imageBuffer = imageEntry.getData();
          const base64 = imageBuffer.toString("base64");
          const mime = getMimeType(target);
          imageMap.set(id, `data:${mime};base64,${base64}`);
        }
      }
    }
  }

  const jsonObj = parser.parse(documentXml);
  const body = jsonObj["w:document"]?.["w:body"];

  if (!body) return "";

  // The body contains a mix of w:p and w:tbl. We need to iterate over its keys sequentially if possible.
  // Unfortunately, fast-xml-parser groups by tag name, losing sequential order between paragraphs and tables unless we use preserveOrder: true.
  // Wait, without preserveOrder, it groups all w:p and w:tbl.
  // To preserve exact fidelity, we MUST use preserveOrder: true.
  // But wait, the existing parser didn't use preserveOrder. Let's rewrite it with preserveOrder: true to keep tables and paragraphs in order!

  // Re-parsing with preserveOrder
  const sequentialParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false,
    preserveOrder: true
  });

  const seqObj = sequentialParser.parse(documentXml);
  
  // Helper to find a specific tag inside a preserveOrder array
  const findTag = (arr: any[], tagName: string): any => {
    if (!Array.isArray(arr)) return null;
    return arr.find(item => item[tagName] !== undefined);
  };
  
  const findAllTags = (arr: any[], tagName: string): any[] => {
    if (!Array.isArray(arr)) return [];
    return arr.filter(item => item[tagName] !== undefined);
  };

  const getAttr = (node: any, attrName: string) => node?.[':@']?.[`@_${attrName}`];

  const extractRunStyles = (rPr: any) => {
    let rStyles = "";
    let isBold = false;
    let isItalic = false;
    let isUnderline = false;

    if (findTag(rPr, "w:b")) isBold = true;
    if (findTag(rPr, "w:i")) isItalic = true;
    if (findTag(rPr, "w:u")) isUnderline = true;

    const colorNode = findTag(rPr, "w:color");
    if (colorNode) {
      const colorVal = getAttr(colorNode, "w:val");
      if (colorVal && colorVal !== "auto") rStyles += `color: #${colorVal}; `;
    }

    const highlightNode = findTag(rPr, "w:highlight");
    if (highlightNode) {
      const highlightVal = getAttr(highlightNode, "w:val");
      if (highlightVal && highlightVal !== "none") rStyles += `background-color: ${highlightVal}; `;
    }

    const szNode = findTag(rPr, "w:sz");
    if (szNode) {
      const szVal = getAttr(szNode, "w:val");
      if (szVal) rStyles += `font-size: ${halfPtToPx(parseInt(szVal, 10))}px; `;
    }

    const rFontsNode = findTag(rPr, "w:rFonts");
    if (rFontsNode) {
      const ascii = getAttr(rFontsNode, "w:ascii");
      if (ascii) rStyles += `font-family: '${ascii}'; `;
    }

    return { rStyles, isBold, isItalic, isUnderline };
  };

  let htmlOutput = "";

  const processParagraph = (pObj: any): string => {
    let pStyles = "";
    let isList = false;
    
    const pPrNode = findTag(pObj, "w:pPr");
    if (pPrNode) {
      const pPr = pPrNode["w:pPr"];
      const jcNode = findTag(pPr, "w:jc");
      if (jcNode) {
        const align = getAttr(jcNode, "w:val");
        if (align === "both") {
          pStyles += `text-align: justify; `;
        } else if (align) {
          pStyles += `text-align: ${align}; `;
        }
      }
      if (findTag(pPr, "w:numPr")) {
        isList = true;
        pStyles += `margin-left: 24pt; `;
      }

      // Extract paragraph-level default run properties
      const pRPrNode = findTag(pPr, "w:rPr");
      if (pRPrNode) {
        pStyles += extractRunStyles(pRPrNode["w:rPr"]).rStyles;
      }
    }

    let pContent = isList ? `<strong>• </strong>` : "";
    const runs = findAllTags(pObj, "w:r");

    for (const rNode of runs) {
      const rObj = rNode["w:r"];
      let rStyles = "";
      let isBold = false;
      let isItalic = false;
      let isUnderline = false;

      const rPrNode = findTag(rObj, "w:rPr");
      if (rPrNode) {
        const extracted = extractRunStyles(rPrNode["w:rPr"]);
        rStyles += extracted.rStyles;
        isBold = extracted.isBold;
        isItalic = extracted.isItalic;
        isUnderline = extracted.isUnderline;
      }

      // Check for drawing (image) inside run
      const drawingNodes = findAllTags(rObj, "w:drawing");
      for (const dNode of drawingNodes) {
        const inlineNode = findTag(dNode["w:drawing"], "wp:inline");
        if (inlineNode) {
          const graphicNode = findTag(inlineNode["wp:inline"], "a:graphic");
          if (graphicNode) {
            const graphicDataNode = findTag(graphicNode["a:graphic"], "a:graphicData");
            if (graphicDataNode) {
              const picNode = findTag(graphicDataNode["a:graphicData"], "pic:pic");
              if (picNode) {
                const blipFillNode = findTag(picNode["pic:pic"], "pic:blipFill");
                if (blipFillNode) {
                  const blipNode = findTag(blipFillNode["pic:blipFill"], "a:blip");
                  if (blipNode) {
                    const rId = getAttr(blipNode, "r:embed");
                    if (rId && imageMap.has(rId)) {
                      pContent += `<img src="${imageMap.get(rId)}" />`;
                    }
                  }
                }
              }
            }
          }
        }
      }

      // Handle text
      const textNodes = findAllTags(rObj, "w:t");
      for (const tNode of textNodes) {
        let textVal = "";
        const tContent = tNode["w:t"];
        if (typeof tContent === "string") {
          textVal = tContent;
        } else if (Array.isArray(tContent)) {
           // Text might be inside #text with preserveOrder
           const textObj = tContent.find(i => i['#text'] !== undefined);
           if (textObj) textVal = textObj['#text'];
        }

        if (textVal) {
          textVal = String(textVal).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          let span = `<span style="${rStyles}">${textVal}</span>`;
          if (isBold) span = `<strong>${span}</strong>`;
          if (isItalic) span = `<em>${span}</em>`;
          if (isUnderline) span = `<u>${span}</u>`;
          pContent += span;
        }
      }
    }

    if (pContent.trim() === "") {
       return `<p>&nbsp;</p>`;
    } else {
       return `<p style="${pStyles}">${pContent}</p>`;
    }
  };

  const processTable = (tblObj: any): string => {
    let html = `<table style="width: 100%; border-collapse: collapse; border: 1px solid #ccc;"><tbody>`;
    const rows = findAllTags(tblObj, "w:tr");
    for (const rNode of rows) {
      html += `<tr>`;
      const cells = findAllTags(rNode["w:tr"], "w:tc");
      for (const cNode of cells) {
        html += `<td style="border: 1px solid #ccc; padding: 4px;">`;
        const cellContent = cNode["w:tc"];
        
        // A cell can contain paragraphs or even nested tables
        for (const element of cellContent) {
          if (element["w:p"]) {
            html += processParagraph(element["w:p"]);
          } else if (element["w:tbl"]) {
            html += processTable(element["w:tbl"]);
          }
        }
        
        html += `</td>`;
      }
      html += `</tr>`;
    }
    html += `</tbody></table>`;
    return html;
  };

  const docNode = findTag(seqObj, "w:document");
  if (docNode) {
    const bodyNode = findTag(docNode["w:document"], "w:body");
    if (bodyNode) {
      for (const element of bodyNode["w:body"]) {
        if (element["w:p"]) {
          htmlOutput += processParagraph(element["w:p"]);
        } else if (element["w:tbl"]) {
          htmlOutput += processTable(element["w:tbl"]);
        }
      }
    }
  }

  return `<div class="imported-docx">${htmlOutput}</div>`;
};

export const importDocxController = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const html = parseDocxToHtml(req.file.buffer);

    res.json({ 
      html, 
      warnings: [] 
    });
  } catch (error: any) {
    console.error("DOCX Import Error:", error);
    res.status(500).json({ error: "Failed to parse Word document: " + error.message });
  }
};
