// Pure letterhead drawing math — deliberately has NO app-specific imports
// (no @/api/apiClient, no React), so it can be imported from the
// "app-import-free, Node-testable" pure PDF layout modules
// (bidProposalPdfLayout.js, bidInternalBreakdownPdfLayout.js,
// turnoverReviewPdfLayout.js, scopeReviewPdfLayout.js) without breaking
// their own documented invariant. The DB-backed lookup half of the
// letterhead feature (getActiveLetterhead/loadLetterheadImage, which do
// need @/api/apiClient) lives in letterheadPdf.js instead, which imports
// drawLetterheadImage from here rather than duplicating it.

// Scales (naturalWidth x naturalHeight) to fit inside (maxWidth x maxHeight)
// preserving aspect ratio — so a very wide-and-short or narrow-and-tall
// letterhead image is never distorted.
export function fitDimensions(naturalWidth, naturalHeight, maxWidth, maxHeight) {
  const aspect = naturalWidth / naturalHeight;
  let width = maxWidth;
  let height = width / aspect;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * aspect;
  }
  return { width, height };
}

// Synchronous draw step — image is an already-resolved {dataUrl,width,height}
// (from letterheadPdf.js's loadLetterheadImage) or null/undefined.
// x/y/maxWidth/maxHeight are in whatever unit the calling doc was
// constructed with ('in', 'mm', or 'pt'); this never assumes a unit, it only
// does proportional arithmetic and hands the numbers to doc.addImage.
// Returns null when there's no image to draw (nothing was added to the
// page) — callers should treat that exactly like "no active letterhead" and
// fall back to their normal header; returns the y position to resume
// drawing at otherwise.
export function drawLetterheadImage(doc, image, { x, y, maxWidth, maxHeight, gap }) {
  if (!image?.dataUrl) return null;
  const { width, height } = fitDimensions(image.width, image.height, maxWidth, maxHeight);
  doc.addImage(image.dataUrl, 'PNG', x + (maxWidth - width) / 2, y, width, height);
  return y + height + (gap ?? maxHeight * 0.15);
}
