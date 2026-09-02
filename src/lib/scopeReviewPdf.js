import { downloadPdfBlob } from '@/lib/pdfDownload';
import { drawScopeReviewPdf } from '@/lib/scopeReviewPdfLayout';

export { drawScopeReviewPdf };

// Scope Review has no "completed" status — it's an always-open running list —
// so unlike turnoverReviewPdf.js's completed_by, the signature line here is
// "Prepared By", stamped with whoever is signed in at export time. Replaces
// the earlier window.print()-of-a-hidden-React-view approach (see git
// history for ScopeReviewPrintView.jsx) for the same reason as
// bidProposalPdf.js. See scopeReviewPdfLayout.js for the actual
// page-drawing logic.
export async function generateScopeReviewPdf({ project, preparedBy, questions, generalNotes }) {
  const data = {
    project,
    questions: questions || [],
    generalNotes,
    preparedBy,
    printedDate: new Date().toLocaleDateString(),
  };

  const doc = drawScopeReviewPdf(data);
  const blob = doc.output('blob');
  const filename = `Scope-Review-${project.project_number || project.id}.pdf`;
  downloadPdfBlob(blob, filename);
  return { blob, filename };
}
