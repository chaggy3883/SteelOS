import { jsPDF } from 'jspdf';
import { PDF_MARGIN_MM, PDF_PAGE_FORMAT } from '@/lib/pdfLayout';
import { downloadPdfBlob } from '@/lib/pdfDownload';
import { drawLetterheadIfActive } from '@/lib/letterheadPdf';

// HR → Candidate Application dialog — the same label/value rows the dialog
// shows, as a real two-column document rather than a screenshot.
export async function generateCandidateApplicationPdf({ company, candidate }) {
  const doc = new jsPDF({ format: PDF_PAGE_FORMAT });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = PDF_MARGIN_MM;
  const today = new Date().toISOString().slice(0, 10);
  const labelX = marginX;
  const valueX = marginX + 45;
  const valueWidth = pageWidth - valueX - marginX;

  const rows = [
    ['Candidate Name', candidate?.candidate_name],
    ['Email', candidate?.email],
    ['Phone', candidate?.phone],
    ['Position Applied', candidate?.position_applied],
    ['Status', candidate?.status ? candidate.status.replace(/_/g, ' ') : ''],
    ['Applied Date', candidate?.applied_date],
    ...(candidate?.status === 'Hired' ? [['Hire Date', candidate?.hire_date]] : []),
    ...(candidate?.status === 'Rejected' ? [['Rejected Date', candidate?.rejection_date], ['Rejection Reason', candidate?.rejection_reason]] : []),
    ['Notes', candidate?.notes],
  ];

  const letterheadY = await drawLetterheadIfActive(doc, 'hr_candidate_application', { x: marginX, y: 10, maxWidth: pageWidth - marginX * 2, maxHeight: 22 });
  doc.setFontSize(16);
  doc.text('CANDIDATE APPLICATION', marginX, letterheadY != null ? letterheadY + 6 : 18);
  doc.setFontSize(9);
  let y = letterheadY != null ? letterheadY + 14 : 26;
  if (letterheadY == null) { doc.text(company?.name || '—', marginX, y); y += 5; }
  doc.text(`Generated ${today}`, marginX, y); y += 9;

  doc.setFontSize(9);
  rows.forEach(([label, value]) => {
    const lines = doc.splitTextToSize(String(value || '—'), valueWidth);
    const needed = lines.length * 4.5 + 2;
    if (y + needed > pageHeight - marginX) { doc.addPage(); y = 18; }
    doc.setFont(undefined, 'bold');
    doc.text(label, labelX, y);
    doc.setFont(undefined, 'normal');
    doc.text(lines, valueX, y);
    y += needed;
  });

  const blob = doc.output('blob');
  const filename = `${candidate?.candidate_name || 'candidate'}-application.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}
