import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

/**
 * Exports the content of the draft space to a PDF.
 * This captures the .pageWrapper element and converts it to a high-quality PDF.
 */
export async function exportToPDF(elementId: string = 'draft-page-wrapper', filename: string = 'Document.pdf') {
  const element = document.getElementById(elementId);
  if (!element) {
    console.error(`Element with id ${elementId} not found.`);
    return;
  }

  try {
    const canvas = await html2canvas(element, {
      scale: 2, // Higher scale for better quality
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
    });

    const imgData = canvas.toDataURL('image/png');
    
    // A4 dimensions in points (72 dpi)
    // 210mm x 297mm => 595.28pt x 841.89pt
    const pdf = new jsPDF('p', 'pt', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    
    const imgWidth = canvas.width;
    const imgHeight = canvas.height;
    
    // Ratio to fit the image to the PDF width
    const ratio = pdfWidth / imgWidth;
    const totalPdfHeight = imgHeight * ratio;

    let heightLeft = totalPdfHeight;
    let position = 0;

    // Add first page
    pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, totalPdfHeight);
    heightLeft -= pdfHeight;

    // Add more pages if content is longer than one A4 page
    while (heightLeft >= 0) {
      position = heightLeft - totalPdfHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, totalPdfHeight);
      heightLeft -= pdfHeight;
    }

    pdf.save(filename);
  } catch (error) {
    console.error('Error generating PDF:', error);
  }
}

/**
 * Exports HTML content to a docx file.
 */
export async function exportToDocx(htmlContent: string, filename: string = 'Document.docx') {
  try {
    const htmlToDocx = (await import('html-to-docx')).default;
    const saveAs = (await import('file-saver')).saveAs;

    // Word documents often use specific font settings. 
    // We can wrap the content in a container with a font-family if needed.
    const fullHtml = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <title>Exported Document</title>
          <style>
            body { font-family: 'Times New Roman', Times, serif; }
          </style>
      </head>
      <body>
          ${htmlContent}
      </body>
      </html>
    `;

    const docxBlob = await htmlToDocx(fullHtml, null, {
      margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 }, // 1 inch margins
      font: 'Times New Roman',
      fontSize: 24, // 12pt (docx uses half-points or similar units sometimes, but html-to-docx handles pt/px)
    });

    saveAs(docxBlob, filename);
  } catch (error) {
    console.error('Error generating DOCX:', error);
    alert('Failed to export Word document. Please try again.');
  }
}

/**
 * Exports plain text to a .txt file.
 */
export async function exportToTxt(textContent: string, filename: string = 'Document.txt') {
  try {
    const { saveAs } = await import('file-saver');
    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
    saveAs(blob, filename);
  } catch (error) {
    console.error('Error generating TXT:', error);
    alert('Failed to export Text document. Please try again.');
  }
}

/**
 * Exports HTML content to an .html file.
 */
export async function exportToHtml(htmlContent: string, filename: string = 'Document.html') {
  try {
    const { saveAs } = await import('file-saver');
    const fullHtml = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Exported Document</title>
          <style>
            body { 
              font-family: 'Times New Roman', Times, serif; 
              line-height: 1.6; 
              max-width: 800px; 
              margin: 40px auto; 
              padding: 20px; 
              color: #1a1a1a;
            }
            h1, h2, h3, h4, h5, h6 { margin-top: 1.5em; margin-bottom: 0.5em; }
            p { margin-bottom: 1em; }
            table { border-collapse: collapse; width: 100%; margin: 20px 0; }
            th, td { border: 1px solid #ccc; padding: 8px 12px; text-align: left; }
            th { background-color: #f5f5f5; font-weight: 600; }
          </style>
      </head>
      <body>
          ${htmlContent}
      </body>
      </html>
    `;
    const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
    saveAs(blob, filename);
  } catch (error) {
    console.error('Error generating HTML:', error);
    alert('Failed to export HTML document. Please try again.');
  }
}
