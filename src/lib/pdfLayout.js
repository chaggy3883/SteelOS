// Shared PDF layout constants — every PDF export in the app should use one
// of these rather than its own ad-hoc margin number, so a page from one
// export doesn't look different from a page from another. Two constants
// because this app has two independent PDF mechanisms with different units:
//
// 1. Browser print (window.print() + a print-only React view, e.g.
//    BidProposalPrintView.jsx, TurnoverReviewPrintView.jsx) — margin is set
//    once, globally, via the `@page { margin: 0.5in }` rule in index.css.
//    Nothing in JS needs to reference PDF_MARGIN_MM/PT for that mechanism;
//    it's listed here only so the standard is documented in one place.
//
// 2. Manually-drawn jsPDF documents (bolPdf.js, certifiedPayrollReportPdf.js,
//    delayNoticePdf.js, customerStatementPdf.js, exportNodeToPdf.js) — each
//    draws its own layout in either 'mm' or 'pt' units and needs a numeric
//    margin constant to match. PDF_MARGIN_MM/PDF_MARGIN_PT are both the same
//    physical distance (~0.47in) — chosen to match bolPdf.js's and
//    certifiedPayrollReportPdf.js's existing 12mm, which was already tuned
//    so a full load fits on one BOL page and the 11-column WH-347 table fits
//    on one landscape page. Standardizing everything else UP to exactly
//    0.5in (12.7mm) would only gain an imperceptible 0.7mm while risking
//    pushing those two tight, already-working layouts onto a second page for
//    no visible benefit — not worth it.
export const PDF_MARGIN_MM = 12;
export const PDF_MARGIN_PT = 34; // 12mm ≈ 34pt (1mm ≈ 2.8346pt)
export const PDF_PAGE_FORMAT = 'letter';
