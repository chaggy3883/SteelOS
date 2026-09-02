import { db } from '@/api/apiClient';
import { computeBidTaxBreakdown } from '@/lib/financialAnalytics';
import { getTaxDisplayLabel } from '@/lib/taxRate';
import { getActiveTemplate, isColumnVisible } from '@/lib/reportTemplates';
import { rasterizePdfPages, detectDocumentKind } from '@/lib/proposalTermsPdfMerge';
import { loadImageAsDataUrl, dataUrlImageSize } from '@/lib/pdfImage';
import { downloadPdfBlob } from '@/lib/pdfDownload';
import { drawBidProposalPdf } from '@/lib/bidProposalPdfLayout';

export { drawBidProposalPdf };

// Generates the customer-facing proposal as a real PDF file via jsPDF,
// replacing the earlier window.print()-of-a-hidden-React-view approach (see
// git history for BidProposalPrintView.jsx). That approach's margin was only
// ever a CSS @page rule — a *suggestion* the browser's own print dialog is
// free to override (confirmed: "Margins: None" in the dialog silently wins
// over the page CSS). A margin baked into the drawn PDF itself, with no
// print dialog in the flow at all, has no such override path. See
// bidProposalPdfLayout.js for the actual page-drawing logic.
const ERECTION_CATEGORIES = ['steel_erection', 'outsourced_misc_material_erection', 'erection_labor_hours', 'crane_rental', 'mobilization', 'field_rigging'];

export async function generateBidProposalPdf(bid) {
  const lines = await db.entities.TakeoffLine.filter({ bid_id: bid.id }, '-created_date', 200).catch(() => []);
  // Must resolve the SELLING company that owns this bid, not "whichever
  // company row happens to be most recently created" — see
  // BidProposalPrintView.jsx's original comment (git history) for why.
  const company = bid.company_id ? await db.entities.Company.get(bid.company_id).catch(() => null) : null;
  const template = await getActiveTemplate('proposal').catch(() => null);
  const taxLabel = await getTaxDisplayLabel(bid).catch(() => 'Sales Tax');
  const logo = await loadImageAsDataUrl(company?.logo_url);

  const sum = (keys) => lines.filter((l) => keys.includes(l.cost_category)).reduce((s, l) => s + (l.total_cost || 0), 0);
  const detailingTotal = sum(['detailing']);
  const engineeringTotal = sum(['engineering']);
  const erectionTotal = sum(ERECTION_CATEGORIES);
  const subtotal = lines.reduce((s, l) => s + (l.total_cost || 0), 0);
  const fabricationTotal = Math.max(0, subtotal - detailingTotal - engineeringTotal - erectionTotal);

  const { taxRate, joistDeckTaxRate, structuralTaxAmount, joistDeckTaxAmount } = computeBidTaxBreakdown(bid, lines);
  const taxAmount = structuralTaxAmount + joistDeckTaxAmount;
  const grandTotal = Number(bid?.bid_total_cost || 0);
  const adminAllocation = Math.max(0, grandTotal - fabricationTotal - detailingTotal - engineeringTotal - erectionTotal - taxAmount);
  const fobPrice = grandTotal - taxAmount;

  let termsDocs = [];
  if (bid.company_id) {
    try {
      termsDocs = await db.entities.CompanyProposalTerms.filter({ company_id: bid.company_id, is_active: true }, 'sort_order', 100);
    } catch {
      termsDocs = [];
    }
  }
  const termsPages = (await Promise.all(termsDocs.map(async (termsDoc) => {
    try {
      const kind = await detectDocumentKind(termsDoc.file_url);
      if (kind === 'pdf') {
        const rawImages = await rasterizePdfPages(termsDoc.file_url);
        const images = await Promise.all(rawImages.map(async (dataUrl) => ({ dataUrl, ...(await dataUrlImageSize(dataUrl)) })));
        return { id: termsDoc.id, name: termsDoc.document_name, kind, images };
      }
      if (kind === 'image') {
        const size = await dataUrlImageSize(termsDoc.file_url);
        return { id: termsDoc.id, name: termsDoc.document_name, kind, image: { dataUrl: termsDoc.file_url, ...(size || {}) } };
      }
      return { id: termsDoc.id, name: termsDoc.document_name, kind: 'other' };
    } catch {
      return null;
    }
  }))).filter(Boolean);

  const data = {
    bid,
    companyName: company?.name || '',
    logo,
    taxLabel,
    visibleColumns: {
      fabrication: isColumnVisible(template, 'show_fabrication'),
      detailing: isColumnVisible(template, 'show_detailing'),
      engineering: isColumnVisible(template, 'show_engineering'),
      erection: isColumnVisible(template, 'show_erection'),
      adminAllocation: isColumnVisible(template, 'show_admin_allocation'),
      taxBreakdown: isColumnVisible(template, 'show_tax_breakdown'),
    },
    amounts: {
      fabricationTotal, detailingTotal, engineeringTotal, erectionTotal, adminAllocation, fobPrice,
      taxRate, structuralTaxAmount, joistDeckTaxRate, joistDeckTaxAmount, grandTotal,
      taxExempt: !!bid.tax_exempt,
    },
    termsPages,
  };

  const doc = drawBidProposalPdf(data);
  const blob = doc.output('blob');
  const filename = `Proposal-${bid.bid_number || bid.id}.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}
