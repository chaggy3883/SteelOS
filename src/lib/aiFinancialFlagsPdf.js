import { jsPDF } from 'jspdf';
import { PDF_MARGIN_MM, PDF_PAGE_FORMAT } from '@/lib/pdfLayout';
import { downloadPdfBlob } from '@/lib/pdfDownload';

// AI Financial Flags tab — same findings list Accounting.jsx's "ai" tab
// renders (optionally already filtered to one project), as stacked blocks
// rather than a table since each finding carries a variable-length
// explanation, matching the card layout on screen.
export function generateAiFinancialFlagsPdf({ company, findings, projectFilterLabel }) {
  const doc = new jsPDF({ format: PDF_PAGE_FORMAT });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = PDF_MARGIN_MM;
  const maxWidth = pageWidth - marginX * 2;
  const today = new Date().toISOString().slice(0, 10);

  const ensureRoom = (y, needed = 8) => (y + needed > pageHeight - marginX ? (doc.addPage(), 20) : y);

  doc.setFontSize(16);
  doc.text('AI FINANCIAL FLAGS', marginX, 18);
  doc.setFontSize(9);
  let y = 26;
  doc.text(company?.name || '—', marginX, y); y += 5;
  if (projectFilterLabel) { doc.text(`Showing flags for ${projectFilterLabel}.`, marginX, y); y += 5; }
  doc.text(`Generated ${today}`, marginX, y); y += 9;

  if (!findings || findings.length === 0) {
    doc.text('No AI financial findings yet. Upload project contracts to generate analysis.', marginX, y);
    y += 6;
  } else {
    findings.forEach((f) => {
      y = ensureRoom(y, 20);
      doc.setFont(undefined, 'bold');
      doc.setFontSize(10);
      doc.text(f.title || 'Untitled Finding', marginX, y);
      y += 5;
      doc.setFont(undefined, 'normal');
      doc.setFontSize(8);
      doc.text(`Status: ${f.status || '—'}${f.risk_level ? `   Risk: ${f.risk_level}` : ''}`, marginX, y);
      y += 5;
      if (f.ai_explanation) {
        const lines = doc.splitTextToSize(f.ai_explanation, maxWidth);
        lines.forEach((line) => { y = ensureRoom(y); doc.text(line, marginX, y); y += 4.5; });
      }
      if (f.estimated_financial_impact) {
        y = ensureRoom(y);
        doc.text(`Est. Impact: ${f.estimated_financial_impact}`, marginX, y);
        y += 5;
      }
      y += 3;
      doc.setLineWidth(0.1);
      doc.line(marginX, y - 2, pageWidth - marginX, y - 2);
      y += 3;
    });
  }

  const blob = doc.output('blob');
  const filename = `AI-Financial-Flags-${today}.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}
