import { db } from '@/api/apiClient';
import { computeBidTaxBreakdown } from '@/lib/financialAnalytics';
import { getTaxDisplayLabel } from '@/lib/taxRate';
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
//
// Shows only the bottom-line price (FOB, one combined tax line, total) —
// NOT a category-by-category cost breakdown. That breakdown is internal-only
// (see bidInternalBreakdownPdf.js), so this only needs each bid's tax
// numbers, not its per-category cost totals.
export async function generateBidProposalPdf(bid) {
  const lines = await db.entities.TakeoffLine.filter({ bid_id: bid.id }, '-created_date', 200).catch(() => []);
  // Must resolve the SELLING company that owns this bid, not "whichever
  // company row happens to be most recently created" — see
  // BidProposalPrintView.jsx's original comment (git history) for why.
  const company = bid.company_id ? await db.entities.Company.get(bid.company_id).catch(() => null) : null;
  const taxLabel = await getTaxDisplayLabel(bid).catch(() => 'Sales Tax');
  const logo = await loadImageAsDataUrl(company?.logo_url);

  const { structuralTaxAmount, joistDeckTaxAmount } = computeBidTaxBreakdown(bid, lines);
  const taxAmount = structuralTaxAmount + joistDeckTaxAmount;
  const grandTotal = Number(bid?.bid_total_cost || 0);
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
    company,
    logo,
    taxLabel,
    amounts: {
      fobPrice, structuralTaxAmount, joistDeckTaxAmount, grandTotal,
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
