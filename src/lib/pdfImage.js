// Shared browser-side image loader for jsPDF generators (bidProposalPdf.js,
// bidInternalBreakdownPdf.js, turnoverReviewPdf.js, scopeReviewPdf.js). Same
// load-then-rasterize-through-canvas idiom bolPdf.js uses for its own logo —
// jsPDF's addImage always needs a data URI plus explicit pixel dimensions,
// whether the source was already a data URI or an http(s)/blob URL.
// Cross-origin images without CORS headers taint the canvas and throw on
// toDataURL — caught so a bad/unreachable image just gets skipped rather
// than failing the whole PDF.
export function loadImageAsDataUrl(url) {
  return new Promise((resolve) => {
    if (!url) { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        resolve({ dataUrl: canvas.toDataURL('image/png'), width: img.naturalWidth, height: img.naturalHeight });
      } catch (e) {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// A rasterized terms-page PNG (see proposalTermsPdfMerge.js) is already a
// data URL — this just recovers its pixel dimensions so the PDF generator
// can scale it into the page without distorting its aspect ratio.
export function dataUrlImageSize(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}
