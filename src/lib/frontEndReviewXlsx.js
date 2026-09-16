// Excel counterpart to frontEndReviewPdf.js — unlike aiFinancialFlagsXlsx.js
// (which deliberately drops narrative fields from its structured table), the
// Exception Matrix IS the working artifact estimators already hand off as a
// spreadsheet, so every column the on-screen table shows is included here,
// not a lightweight subset.
import * as XLSX from 'xlsx';
import { downloadWorkbook } from '@/lib/bidRecapXlsxExport';

const addressLine = (company) => [
  company?.address,
  [company?.city, company?.state, company?.zip].filter(Boolean).join(', '),
].filter(Boolean).join(' — ');

const HEADERS = [
  'Prior Bid Ask', 'Post Bid Ask', 'Source Doc', 'Page #', 'Location / Page Ref', 'Provision #',
  'Owner/GC/CM Comment', 'Owner/GC/CM Question', 'Comment to Estimator', 'Sub/Supplier/Detailer Comment',
  'Est. Additional Cost', 'Answer', 'If Awarded — Project Team Review',
];

const lineToRow = (line) => [
  line.prior_bid_ask ? 'Yes' : 'No',
  line.post_bid_ask ? 'Yes' : 'No',
  line.document_source_key || '—',
  line.page_number ?? '—',
  line.location_page_reference || '—',
  line.provision_number_tag || '—',
  line.owner_gc_cm_comment || '',
  line.owner_gc_cm_question || '',
  line.comment_to_estimator || '',
  line.sub_supplier_detailer_comment || '',
  (line.estimated_additional_cost_cents || 0) / 100,
  line.answer_text || '',
  line.if_awarded_project_team_review || '',
];

export function generateFrontEndReviewXlsx({ company, bid, lines }) {
  const today = new Date().toISOString().slice(0, 10);
  const aoa = [];
  aoa.push([company?.name || 'Company']);
  const address = addressLine(company);
  if (address) aoa.push([address]);
  if (company?.phone) aoa.push([`Phone: ${company.phone}`]);
  aoa.push([]);
  aoa.push(['FRONT-END SPEC REVIEW — EXCEPTION MATRIX']);
  if (bid) aoa.push([`Bid: ${bid.bid_number ? `${bid.bid_number} — ` : ''}${bid.job_name || 'Untitled Bid'}`]);
  aoa.push([`Generated ${today}`]);
  aoa.push([]);

  aoa.push(HEADERS);
  if (!lines || lines.length === 0) {
    aoa.push(['No exception lines yet — upload a spec document to seed the matrix.']);
  } else {
    lines.forEach((line) => aoa.push(lineToRow(line)));
  }

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Exception Matrix');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const filename = `Front-End-Review-${bid?.bid_number || 'bid'}-${today}.xlsx`;
  downloadWorkbook(bytes, filename);

  return { filename };
}
