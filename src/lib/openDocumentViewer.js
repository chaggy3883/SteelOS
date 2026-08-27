// Opens a document (PDF today, any BlueprintCanvas-renderable source later)
// in its own full-page tab via the /document-viewer route, replacing the old
// in-page PdfViewerModal now that every PDF view opens in a new tab. Source
// and file name travel as URL query params — a fresh tab has no access to
// the opener's React state, so nothing beyond a URL string can cross over.
export function openDocumentViewer(source, fileName) {
  if (!source) return;
  const params = new URLSearchParams({ source, name: fileName || 'document.pdf' });
  window.open(`/document-viewer?${params.toString()}`, '_blank', 'noopener,noreferrer');
}
