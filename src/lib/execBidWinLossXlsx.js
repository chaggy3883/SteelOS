// Excel counterpart to execBidWinLossPdf.js — won/lost/did-not-bid/active
// pipeline counts (computeWinLossStats) plus top loss/did-not-bid reasons, as
// passed from ExecutiveAnalytics.jsx's Commercial Bid Win/Loss card. Reason
// rows arrive already label-mapped ({ label, count }), same as the PDF.
import * as XLSX from 'xlsx';
import { downloadWorkbook } from '@/lib/bidRecapXlsxExport';

const addressLine = (company) => [
  company?.address,
  [company?.city, company?.state, company?.zip].filter(Boolean).join(', '),
].filter(Boolean).join(' — ');

export function generateExecBidWinLossXlsx({ company, winLoss, topLossReasons, topDnbReasons }) {
  const aoa = [];
  aoa.push([company?.name || 'Company']);
  const address = addressLine(company);
  if (address) aoa.push([address]);
  if (company?.phone) aoa.push([`Phone: ${company.phone}`]);
  aoa.push([]);
  aoa.push(['Commercial Bid Win/Loss']);
  aoa.push([`Report generated: ${new Date().toLocaleDateString()}`]);
  aoa.push([]);
  aoa.push(['Category', 'Count']);
  aoa.push(['Won', Number(winLoss?.won) || 0]);
  aoa.push(['Lost', Number(winLoss?.lost) || 0]);
  aoa.push(['Did Not Bid', Number(winLoss?.dnb) || 0]);
  aoa.push(['Active Pipeline', Number(winLoss?.active) || 0]);
  aoa.push(['Win Rate', winLoss?.winRatePct === null || winLoss?.winRatePct === undefined ? '—' : `${winLoss.winRatePct}%`]);
  aoa.push([]);
  aoa.push(['Top Loss Reasons']);
  aoa.push(['Reason', 'Count']);
  if (!topLossReasons || topLossReasons.length === 0) aoa.push(['None logged.']);
  else topLossReasons.forEach((r) => aoa.push([r.label, Number(r.count) || 0]));
  aoa.push([]);
  aoa.push(['Top Did-Not-Bid Reasons']);
  aoa.push(['Reason', 'Count']);
  if (!topDnbReasons || topDnbReasons.length === 0) aoa.push(['None logged.']);
  else topDnbReasons.forEach((r) => aoa.push([r.label, Number(r.count) || 0]));

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Bid Win-Loss');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const today = new Date().toISOString().slice(0, 10);
  const filename = `Bid-Win-Loss-${today}.xlsx`;
  downloadWorkbook(bytes, filename);

  return { filename };
}
