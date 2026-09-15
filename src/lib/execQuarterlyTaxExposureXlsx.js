// Excel counterpart to execQuarterlyTaxExposurePdf.js — Hancock County
// structural tax vs. Joist & Deck jobsite tax overrides, by billing quarter,
// across all bids (computeQuarterlyTaxExposure), as passed from
// ExecutiveAnalytics.jsx's Quarterly Tax Exposure Grid card.
import * as XLSX from 'xlsx';
import { downloadWorkbook } from '@/lib/bidRecapXlsxExport';

const addressLine = (company) => [
  company?.address,
  [company?.city, company?.state, company?.zip].filter(Boolean).join(', '),
].filter(Boolean).join(' — ');

export function generateExecQuarterlyTaxExposureXlsx({ company, taxRows }) {
  const aoa = [];
  aoa.push([company?.name || 'Company']);
  const address = addressLine(company);
  if (address) aoa.push([address]);
  if (company?.phone) aoa.push([`Phone: ${company.phone}`]);
  aoa.push([]);
  aoa.push(['Quarterly Tax Exposure Grid']);
  aoa.push([`Report generated: ${new Date().toLocaleDateString()}`]);
  aoa.push([]);
  aoa.push(['Quarter', 'Hancock County Tax', 'Joist & Deck Tax', 'Total']);
  if (!taxRows || taxRows.length === 0) {
    aoa.push(['No bid tax data available yet.']);
  } else {
    taxRows.forEach((row) => {
      const hancock = Number(row.hancockCountyTax) || 0;
      const joistDeck = Number(row.joistDeckTax) || 0;
      aoa.push([row.quarter, hancock, joistDeck, hancock + joistDeck]);
    });
  }

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Tax Exposure');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const today = new Date().toISOString().slice(0, 10);
  const filename = `Quarterly-Tax-Exposure-${today}.xlsx`;
  downloadWorkbook(bytes, filename);

  return { filename };
}
