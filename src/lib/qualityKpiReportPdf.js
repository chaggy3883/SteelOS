import { jsPDF } from 'jspdf';
import { PDF_MARGIN_MM, PDF_PAGE_FORMAT } from '@/lib/pdfLayout';
import { downloadPdfBlob } from '@/lib/pdfDownload';
import { drawLetterheadIfActive } from '@/lib/letterheadPdf';
import { formatMetricValue } from '@/lib/kpiMetrics';

// KPI Builder's built chart, as a data table (the same rows/columns
// chartModel already computed for the on-screen table) plus the legend &
// metric definitions block — no chart image, since the underlying series
// values are already fully represented in the table.
export async function generateQualityKpiReportPdf({ company, currentUser, title, dateRangeLabel, chartModel, sortedRows }) {
  const doc = new jsPDF({ format: PDF_PAGE_FORMAT, orientation: 'landscape' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = PDF_MARGIN_MM;
  const today = new Date().toISOString().slice(0, 10);
  const columns = chartModel?.columns || [];

  const drawTableHeader = (y) => {
    doc.setFont(undefined, 'bold');
    doc.setFontSize(8);
    const colWidth = Math.min(45, (pageWidth - marginX * 2) / Math.max(1, columns.length));
    let x = marginX;
    columns.forEach((col) => {
      doc.text(String(col.label).slice(0, 24), x, y);
      x += colWidth;
    });
    doc.setFont(undefined, 'normal');
    doc.setLineWidth(0.1);
    doc.line(marginX, y + 1.5, x, y + 1.5);
    return { y: y + 5, colWidth };
  };

  const ensureRoom = (y, needed = 8) => {
    if (y + needed > pageHeight - marginX) {
      doc.addPage();
      return drawTableHeader(18).y;
    }
    return y;
  };

  const letterheadY = await drawLetterheadIfActive(doc, 'quality_kpi_report', { x: marginX, y: 10, maxWidth: pageWidth - marginX * 2, maxHeight: 22 });
  doc.setFontSize(16);
  doc.text((title || 'KPI Report').toUpperCase(), marginX, letterheadY != null ? letterheadY + 6 : 18);
  doc.setFontSize(9);
  let y = letterheadY != null ? letterheadY + 14 : 26;
  if (letterheadY == null) { doc.text(company?.name || '—', marginX, y); y += 5; }
  doc.text(`${dateRangeLabel || ''} · Generated ${today} by ${currentUser?.full_name || currentUser?.email || 'Unknown'}`, marginX, y); y += 9;

  const { y: tableY, colWidth } = drawTableHeader(y);
  y = tableY;
  doc.setFontSize(8);
  (sortedRows || []).forEach((row) => {
    y = ensureRoom(y);
    let x = marginX;
    columns.forEach((col) => {
      const value = col.key === 'xLabel' ? row.xLabel : formatMetricValue(col.unit, row[col.key] ?? 0);
      doc.text(String(value ?? '—').slice(0, 20), x, y);
      x += colWidth;
    });
    y += 5;
  });

  if (!sortedRows || sortedRows.length === 0) {
    doc.text('No data for the selected configuration.', marginX, y);
    y += 6;
  }
  y += 5;

  y = ensureRoom(y, 12);
  doc.setFontSize(10);
  doc.setFont(undefined, 'bold');
  doc.text('Legend & Metric Definitions', marginX, y);
  doc.setFont(undefined, 'normal');
  y += 6;
  doc.setFontSize(8);
  (chartModel?.metrics || []).forEach((m) => {
    y = ensureRoom(y, 10);
    doc.setFont(undefined, 'bold');
    doc.text(m.label, marginX, y);
    doc.setFont(undefined, 'normal');
    y += 4;
    doc.text(doc.splitTextToSize(m.definition || '', pageWidth - marginX * 2), marginX, y);
    y += 6;
  });

  const blob = doc.output('blob');
  const dateStr = today;
  const name = (title || 'kpi_report').replace(/[^a-z0-9_-]+/gi, '_');
  const filename = `${name}_${dateStr}.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}
