import { db } from '@/api/apiClient';
import { getJoistDeckTaxRate } from '@/lib/taxRate';
import { COST_CATEGORIES } from '@/components/estimating/TakeoffEngine';
import { calculateBondAmount, calculateLeedSurcharge, calculatePaymentPlatformFee } from '@/lib/bidWorksheetCalc';
import * as XLSX from 'xlsx';
import { downloadWorkbook } from '@/lib/bidRecapXlsxExport';

// Internal-only Excel mirror of generateBidInternalBreakdownPdf's data
// (bidInternalBreakdownPdf.js): the same per-category Line Total/Markup
// %/Quoted Price rows and the full financial rollup, as real numbers instead
// of PDF-formatted strings. Never wire this into the customer-facing
// proposal export — see bidProposalPdf.js.
const addressLine = (company) => [
  company?.address,
  [company?.city, company?.state, company?.zip].filter(Boolean).join(', '),
].filter(Boolean).join(' — ');

export async function generateBidInternalBreakdownXlsx(bid) {
  const allLines = await db.entities.TakeoffLine.filter({ bid_id: bid.id }, '-created_date', 200).catch(() => []);
  const lines = allLines.filter((l) => COST_CATEGORIES.some((c) => c.key === l.cost_category));
  const companies = await db.entities.Company.list('-created_date', 1).catch(() => []);
  const company = companies[0] || null;

  const bidMarkupPct = parseFloat(bid?.markup_percentage) || 0;
  const resolveMarkupPct = (line, cat) => {
    const pct = line?.markup_percentage;
    return (pct === null || pct === undefined) ? (cat?.default_markup_pct ?? bidMarkupPct) : (parseFloat(pct) || 0);
  };
  const lineMarkupMultiplier = (line, cat) => 1 + (resolveMarkupPct(line, cat) / 100);
  const rows = COST_CATEGORIES
    .map((cat) => ({ cat, line: lines.find((l) => l.cost_category === cat.key) }))
    .filter(({ line }) => line && (line.total_cost || 0) !== 0)
    .map(({ cat, line }) => ({
      label: cat.label,
      qty: Number(line.quantity) || 0,
      unitCost: Number(line.unit_cost) || 0,
      lineTotal: Number(line.total_cost) || 0,
      markupPct: resolveMarkupPct(line, cat),
      quotedPrice: (line.total_cost || 0) * lineMarkupMultiplier(line, cat),
    }));

  const catForLine = (line) => COST_CATEGORIES.find((c) => c.key === line.cost_category);
  const subtotal = lines.reduce((s, l) => s + (l.total_cost || 0), 0);
  const subtotalWithMarkup = lines.reduce((s, l) => s + (l.total_cost || 0) * lineMarkupMultiplier(l, catForLine(l)), 0);
  const markupAmount = subtotalWithMarkup - subtotal;
  const averageMarkupPct = subtotal > 0 ? (markupAmount / subtotal) * 100 : 0;

  const taxRate = Number(bid?.tax_rate || 0);
  const joistDeckTaxRate = getJoistDeckTaxRate(bid, taxRate);
  const structuralTaxAmount = bid?.tax_exempt ? 0 : lines.reduce((sum, line) => {
    const cat = catForLine(line);
    if (cat?.is_taxable === false) return sum;
    return sum + (line.total_cost || 0) * lineMarkupMultiplier(line, cat) * taxRate;
  }, 0);
  const joistDeckLine = lines.find((l) => l.cost_category === 'joist_deck');
  const joistDeckCat = COST_CATEGORIES.find((c) => c.key === 'joist_deck');
  const joistDeckTaxAmount = bid?.tax_exempt ? 0 : (joistDeckLine?.total_cost || 0) * lineMarkupMultiplier(joistDeckLine, joistDeckCat) * joistDeckTaxRate;

  const insuranceAllocation = bid?.insurance_enabled
    ? (parseFloat(bid?.insurance_general_liability) || 0) + (parseFloat(bid?.insurance_umbrella) || 0) + (parseFloat(bid?.insurance_professional_liability) || 0)
    : 0;
  const overrideTotal = parseFloat(bid?.insurance_override) || 0;
  const includedInsuranceAllocation = bid?.insurance_enabled ? insuranceAllocation : 0;
  const leedSurchargeAmount = calculateLeedSurcharge(bid?.leed_level_override);
  const preBondTotal = subtotalWithMarkup + overrideTotal + structuralTaxAmount + joistDeckTaxAmount + includedInsuranceAllocation + leedSurchargeAmount;
  const computedBondAmount = calculateBondAmount(preBondTotal);
  const bondAmount = bid?.bond_override != null ? Number(bid.bond_override) : computedBondAmount;
  const includedBondAmount = bid?.bond_enabled ? bondAmount : 0;
  const preFeeTotal = preBondTotal + includedBondAmount;
  const procorePlatformFee = bid?.procore_pay_enabled ? calculatePaymentPlatformFee(preFeeTotal, taxRate) : null;
  const texturaPlatformFee = bid?.textura_enabled ? calculatePaymentPlatformFee(preFeeTotal, taxRate) : null;
  const grandTotal = Number(bid?.bid_total_cost || 0);

  const aoa = [];
  aoa.push([company?.name || 'Company']);
  const address = addressLine(company);
  if (address) aoa.push([address]);
  if (company?.phone) aoa.push([`Phone: ${company.phone}`]);
  aoa.push([]);
  aoa.push(['Internal Breakdown (Internal Only)']);
  aoa.push([`Bid: ${bid?.bid_number || '—'} — ${bid?.job_name || '—'}`]);
  aoa.push([`Generated ${new Date().toLocaleDateString()}`]);
  aoa.push([]);
  aoa.push(['Category', 'Qty', 'Unit Cost', 'Line Total', 'Markup %', 'Quoted Price']);
  rows.forEach((r) => aoa.push([r.label, r.qty, r.unitCost, r.lineTotal, r.markupPct, r.quotedPrice]));

  aoa.push([]);
  aoa.push(['Summary']);
  aoa.push(['Subtotal', subtotal]);
  aoa.push(['Average Markup %', averageMarkupPct]);
  aoa.push(['Markup Amount', markupAmount]);
  aoa.push(['Subtotal With Markup', subtotalWithMarkup]);
  aoa.push(['Insurance/Override Total', overrideTotal]);
  aoa.push(['Insurance Enabled', bid?.insurance_enabled ? 'Yes' : 'No']);
  aoa.push(['Insurance Allocation', insuranceAllocation]);
  aoa.push(['LEED Level', bid?.leed_level_override || '—']);
  aoa.push(['LEED Surcharge', leedSurchargeAmount]);
  aoa.push(['Tax Exempt', bid?.tax_exempt ? 'Yes' : 'No']);
  aoa.push(['Tax Rate %', taxRate * 100]);
  aoa.push(['Structural Tax Amount', structuralTaxAmount]);
  aoa.push(['Joist & Deck Tax Rate %', joistDeckTaxRate * 100]);
  aoa.push(['Joist & Deck Tax Amount', joistDeckTaxAmount]);
  aoa.push(['Bond Enabled', bid?.bond_enabled ? 'Yes' : 'No']);
  aoa.push(['Bond Amount', bondAmount]);
  if (procorePlatformFee) {
    aoa.push(['Procore Pay Fee', procorePlatformFee.fee]);
    aoa.push(['Procore Pay Fee Tax', procorePlatformFee.tax]);
  }
  if (texturaPlatformFee) {
    aoa.push(['Textura Fee', texturaPlatformFee.fee]);
    aoa.push(['Textura Fee Tax', texturaPlatformFee.tax]);
  }
  aoa.push(['Grand Total', grandTotal]);

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Internal Breakdown');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

  const filename = `Internal-Breakdown-${bid.bid_number || bid.id}.xlsx`;
  downloadWorkbook(bytes, filename);
  return { filename };
}
