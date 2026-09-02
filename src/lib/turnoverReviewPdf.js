import { db } from '@/api/apiClient';
import { SIMPLE_CHECKLIST_ITEMS, FREE_TEXT_FIELDS } from '@/components/projects/turnoverReviewShared';
import { loadImageAsDataUrl } from '@/lib/pdfImage';
import { downloadPdfBlob } from '@/lib/pdfDownload';
import { drawTurnoverReviewPdf } from '@/lib/turnoverReviewPdfLayout';

export { drawTurnoverReviewPdf };

// Internal operational/logistics handoff document — deliberately carries no
// pricing/cost data from the Bid Worksheet (see TakeoffEngine.jsx), matching
// TurnoverReviewPanel.jsx's own scope. Replaces the earlier
// window.print()-of-a-hidden-React-view approach (see git history for
// TurnoverReviewPrintView.jsx) for the same reason as bidProposalPdf.js. See
// turnoverReviewPdfLayout.js for the actual page-drawing logic.
export async function generateTurnoverReviewPdf({ project, record }) {
  const companies = await db.entities.Company.list('-created_date', 1).catch(() => []);
  const logo = await loadImageAsDataUrl(companies[0]?.logo_url);

  const items = record.checklist_items || {};
  const checklistRows = [
    ...SIMPLE_CHECKLIST_ITEMS.map(({ key, label }) => ({ label, value: !!items[key] })),
    { label: `Detailing${items.detailing_required && record.detailing_company ? ` — ${record.detailing_company}` : ''}`, value: !!items.detailing_required },
    { label: `Galvanizing${items.galvanizing_required && record.galvanizing_tons ? ` — ${record.galvanizing_tons} tons` : ''}`, value: !!items.galvanizing_required },
  ];

  const pricingBasisLabel = record.pricing_basis === 'fob' ? 'FOB' : record.pricing_basis === 'erected' ? 'Erected' : '—';

  const data = {
    project,
    logo,
    checklistRows,
    pricingBasis: record.pricing_basis,
    pricingBasisLabel,
    erectorName: record.erector_name,
    subQuotes: record.sub_quotes || [],
    freeTextFields: FREE_TEXT_FIELDS.map(({ key, label }) => ({ label, value: record[key] })),
    requiredAttendees: record.required_attendees || [],
    actualAttendees: record.actual_attendees || [],
    completedBy: record.completed_by,
    completedDate: record.completed_date,
  };

  const doc = drawTurnoverReviewPdf(data);
  const blob = doc.output('blob');
  const filename = `Turnover-Review-${project.project_number || project.id}.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}
