import { jsPDF } from 'jspdf';
import { PDF_MARGIN_MM, PDF_PAGE_FORMAT } from '@/lib/pdfLayout';
import { downloadPdfBlob } from '@/lib/pdfDownload';
import { drawLetterheadIfActive } from '@/lib/letterheadPdf';

const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString()}`;

function drawSectionTable(doc, x0, y, pageHeight, marginX, title, rows) {
  const ensureRoom = (yy, needed = 8) => {
    if (yy + needed > pageHeight - marginX) { doc.addPage(); return 18; }
    return yy;
  };

  y = ensureRoom(y, 14);
  doc.setFontSize(10);
  doc.setFont(undefined, 'bold');
  doc.text(title, x0, y);
  doc.setFont(undefined, 'normal');
  y += 6;

  doc.setFontSize(8);
  doc.setFont(undefined, 'bold');
  doc.text('Project', x0, y);
  doc.text('Amount', x0 + 130, y, { align: 'right' });
  doc.setFont(undefined, 'normal');
  doc.setLineWidth(0.1);
  doc.line(x0, y + 1.5, x0 + 130, y + 1.5);
  y += 5;

  if (!rows || rows.length === 0) {
    y = ensureRoom(y);
    doc.text('None.', x0, y);
    y += 5;
    return y;
  }

  rows.forEach(({ project, amount }) => {
    y = ensureRoom(y);
    doc.text(String(project?.name || '—').slice(0, 60), x0, y);
    doc.text(money(amount), x0 + 130, y, { align: 'right' });
    y += 5;
  });
  return y;
}

// Executive Analytics → WIP Overbilling/Underbilling Summary card —
// company-wide totals plus the same Top 5 Overbilled/Underbilled project
// lists shown on screen (calculateWIPSchedule run per active project).
export async function generateWipOverUnderBillingPdf({ company, wipSummary }) {
  const doc = new jsPDF({ format: PDF_PAGE_FORMAT });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = PDF_MARGIN_MM;
  const today = new Date().toISOString().slice(0, 10);

  const letterheadY = await drawLetterheadIfActive(doc, 'exec_wip_overbilling_underbilling', { x: marginX, y: 10, maxWidth: pageWidth - marginX * 2, maxHeight: 22 });
  doc.setFontSize(16);
  doc.text('WIP OVERBILLING / UNDERBILLING SUMMARY', marginX, letterheadY != null ? letterheadY + 6 : 18);
  doc.setFontSize(9);
  let y = letterheadY != null ? letterheadY + 14 : 26;
  if (letterheadY == null) { doc.text(company?.name || '—', marginX, y); y += 5; }
  doc.text(`Total Overbilled: ${money(wipSummary?.totalOverbilled)}`, marginX, y); y += 5;
  doc.text(`Total Underbilled: ${money(wipSummary?.totalUnderbilled)}`, marginX, y); y += 5;
  doc.text(`Generated ${today}`, marginX, y); y += 9;

  const overRows = (wipSummary?.topOverbilled || []).map(({ project, wip }) => ({ project, amount: wip.overUnderBilling }));
  const underRows = (wipSummary?.topUnderbilled || []).map(({ project, wip }) => ({ project, amount: -wip.overUnderBilling }));

  y = drawSectionTable(doc, marginX, y, pageHeight, marginX, 'Top Overbilled Projects', overRows);
  y += 4;
  y = drawSectionTable(doc, marginX, y, pageHeight, marginX, 'Top Underbilled Projects', underRows);

  const blob = doc.output('blob');
  const filename = `WIP-Overbilling-Underbilling-${today}.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}
