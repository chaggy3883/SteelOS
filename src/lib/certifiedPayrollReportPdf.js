import { jsPDF } from 'jspdf';
import { PDF_MARGIN_MM } from '@/lib/pdfLayout';

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;

// Standard WH-347-style certified payroll report, generated straight from a
// locked PayrollRun's real data (see certifiedPayrollReport.js for the row
// shaping) — same manual jsPDF layout + Blob-anchor download idiom as
// delayNoticePdf.js/bolPdf.js (no autotable dependency is installed in this
// project). Landscape, since a per-employee row carries a lot of columns.
//
// Deliberately stays on jsPDF's default A4 page (not PDF_PAGE_FORMAT/Letter)
// — the 11-column layout below is tuned to use every millimeter of A4
// landscape's extra width (297mm vs Letter's 279.4mm); switching to Letter
// would push the rightmost column (net_wages) off the page. Margin still
// follows the app-wide standard.
//
// Day-by-day hours are rendered as a compact "worked" list under each
// employee's summary row rather than a fixed calendar grid — a true
// biweekly/semimonthly/monthly PayrollRun period can span far more days than
// a rigid 7-column WH-347 grid can hold on one page without becoming
// illegible, so this keeps the real daily detail without a column explosion.
export function generateWH347Pdf({ project, period, run, company, rows }) {
  const doc = new jsPDF({ orientation: 'landscape' });
  const today = new Date().toISOString().slice(0, 10);
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = PDF_MARGIN_MM;

  doc.setFontSize(15);
  doc.text('STATEMENT OF COMPLIANCE — CERTIFIED PAYROLL (WH-347 FORMAT)', marginX, 15);

  doc.setFontSize(9);
  let y = 23;
  const companyLine = [company?.name, company?.address, company?.city, company?.state, company?.zip].filter(Boolean).join(', ');
  doc.text(`Contractor: ${companyLine || '—'}`, marginX, y); y += 6;
  doc.text(`Project: ${project?.project_number || ''} — ${project?.name || ''}`, marginX, y);
  doc.text(`Location: ${[project?.address, project?.city, project?.state].filter(Boolean).join(', ') || '—'}`, pageWidth / 2, y); y += 6;
  doc.text(`Wage Determination #: ${project?.wage_determination_number || '—'}`, marginX, y);
  doc.text(`Prevailing Wage Jurisdiction: ${project?.prevailing_wage_jurisdiction || '—'}`, pageWidth / 2, y); y += 6;
  doc.text(`Week Ending: ${period?.period_end || '—'}`, marginX, y);
  doc.text(`Payroll Run Date: ${run?.run_date || '—'}`, pageWidth / 2, y); y += 6;
  doc.text(`Report Generated: ${today}`, marginX, y);
  y += 10;

  const columns = [
    { key: 'full_name', label: 'Employee', x: marginX, w: 45 },
    { key: 'classification', label: 'Classification', x: marginX + 45, w: 40 },
    { key: 'ssn_last4', label: 'SSN (last 4)', x: marginX + 85, w: 22 },
    { key: 'rate_of_pay', label: 'Rate', x: marginX + 107, w: 18 },
    { key: 'regular_hours', label: 'Reg Hrs', x: marginX + 125, w: 18 },
    { key: 'ot_hours', label: 'OT Hrs', x: marginX + 143, w: 16 },
    { key: 'double_time_hours', label: 'DT Hrs', x: marginX + 159, w: 16 },
    { key: 'gross_this_project', label: 'Gross (This Project)', x: marginX + 175, w: 28 },
    { key: 'gross_all_projects', label: 'Gross (All Projects)', x: marginX + 203, w: 28 },
    { key: 'total_deductions', label: 'Deductions', x: marginX + 231, w: 22 },
    { key: 'net_wages', label: 'Net Wages', x: marginX + 253, w: 24 },
  ];

  doc.setFontSize(8);
  doc.setFont(undefined, 'bold');
  columns.forEach((c) => doc.text(c.label, c.x, y));
  doc.setFont(undefined, 'normal');
  y += 2;
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 5;

  const ensureRoom = (needed) => {
    if (y + needed > 195) {
      doc.addPage();
      y = 18;
    }
  };

  (rows || []).forEach((row) => {
    ensureRoom(12);
    doc.setFontSize(8);
    columns.forEach((c) => {
      let value = row[c.key];
      if (['rate_of_pay', 'gross_this_project', 'gross_all_projects', 'total_deductions', 'net_wages'].includes(c.key)) value = money(value);
      else if (['regular_hours', 'ot_hours', 'double_time_hours'].includes(c.key)) value = (Number(value) || 0).toFixed(2);
      doc.text(String(value ?? '—'), c.x, y);
    });
    y += 5;

    const workedDays = Object.entries(row.daily_hours || {})
      .filter(([, h]) => h.regular > 0 || h.ot > 0 || h.dt > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, h]) => `${day.slice(5)} (${(h.regular + h.ot + h.dt).toFixed(1)}h${h.ot > 0 ? ` +${h.ot.toFixed(1)}OT` : ''}${h.dt > 0 ? ` +${h.dt.toFixed(1)}DT` : ''})`)
      .join('  ');
    if (workedDays) {
      doc.setFontSize(7);
      doc.setTextColor(110);
      doc.text(`  Daily: ${workedDays}`, marginX, y);
      doc.setTextColor(0);
      y += 5;
    }
    y += 2;
  });

  ensureRoom(30);
  y += 4;
  doc.setFontSize(9);
  doc.setFont(undefined, 'bold');
  doc.text('STATEMENT OF COMPLIANCE', marginX, y);
  doc.setFont(undefined, 'normal');
  y += 6;
  doc.setFontSize(8);
  const compliance = 'I certify that the payroll information above is true and correct, that each laborer/mechanic listed has been paid not less than the applicable wage rate for the classification of work performed, and that fringe benefits have been paid or provided as required. No deductions have been made other than those permitted by law.';
  doc.text(doc.splitTextToSize(compliance, pageWidth - marginX * 2), marginX, y);
  y += 16;
  doc.text('Signature: _______________________________', marginX, y);
  doc.text('Title: _______________________________', pageWidth / 2, y);
  y += 8;
  doc.text('Date: _______________________________', marginX, y);

  const blob = doc.output('blob');
  const filename = `Certified-Payroll-WH347-${project?.project_number || project?.id}-${period?.period_end}.pdf`;

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return { blob, filename };
}
