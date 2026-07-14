// utils/parseFileToText.ts

import mammoth from "mammoth";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export default async function parseFileToText(
    file: File
): Promise<string> {

    const fileType = file.type;

    /* ----------------------------- */
    /* PDF Parsing                   */
    /* ----------------------------- */

    if (fileType === "application/pdf") {

        const arrayBuffer = await file.arrayBuffer();

        const pdf = await pdfjsLib.getDocument({
            data: arrayBuffer,
        }).promise;

        let text = "";

        for (let i = 1; i <= pdf.numPages; i++) {

            const page = await pdf.getPage(i);

            const content = await page.getTextContent();

            const strings = content.items.map(
                (item: any) => item.str
            );

            text += strings.join(" ") + "\n";
        }

        return text.trim();
    }

    /* ----------------------------- */
    /* DOCX Parsing                  */
    /* ----------------------------- */

    if (
        fileType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {

        const arrayBuffer = await file.arrayBuffer();

        const result = await mammoth.extractRawText({
            arrayBuffer,
        });

        return result.value.trim();
    }

    throw new Error("Unsupported file type");
}