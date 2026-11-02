import * as XLSX from 'xlsx';
import { downloadWorkbook } from '@/lib/bidRecapXlsxExport';
import { loadBidInternalBreakdownInputs } from '@/lib/bidInternalBreakdownPdf';
import { buildBidInternalBreakdownAoa } from '@/lib/bidInternalBreakdownData';

// Internal-only Excel mirror of generateBidInternalBreakdownPdf: the same
// worksheet sections (bidInternalBreakdownData.js), as real numbers instead
// of PDF-formatted strings. Never wire this into the customer-facing
// proposal export — see bidProposalPdf.js.
export async function generateBidInternalBreakdownXlsx(bid) {
  const { sections, company } = await loadBidInternalBreakdownInputs(bid);
  const aoa = buildBidInternalBreakdownAoa({ bid, company, sections });

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet['!cols'] = [{ wch: 48 }, { wch: 30 }, { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 22 }, { wch: 40 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Internal Breakdown');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const filename = `Internal-Breakdown-${bid.bid_number || bid.id}.xlsx`;
  downloadWorkbook(bytes, filename);
  return { filename };
}
