import { db } from '@/api/apiClient';
import {
  FREE_TEXT_FIELDS, SCOPE_VENDOR_ROLES, normalizeTurnoverRecord, checklistFor, checklistItemText, scopeVendorFor, quoteName,
} from '@/components/projects/turnoverReviewShared';
import { loadImageAsDataUrl } from '@/lib/pdfImage';
import { downloadPdfBlob } from '@/lib/pdfDownload';
import { drawTurnoverReviewPdf } from '@/lib/turnoverReviewPdfLayout';
import { loadLetterheadImage } from '@/lib/letterheadPdf';

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
  const letterheadImage = await loadLetterheadImage('turnover_review');

  const rec = normalizeTurnoverRecord(record);
  const items = rec.checklist_items || {};
  const checklistRows = checklistFor(rec).map((item) => ({ label: checklistItemText(item, rec), value: !!items[item.key] }));
  const scopeVendors = SCOPE_VENDOR_ROLES.map(({ key, label }) => {
    const v = scopeVendorFor(rec, key);
    return { label, vendor: v.vendor_name, quotes: v.quotes.map(quoteName) };
  });

  const data = {
    project,
    logo,
    letterheadImage,
    checklistRows,
    scopeVendors,
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
