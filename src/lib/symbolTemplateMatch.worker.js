// Module Web Worker for IRONSIGHT visual search — keeps a full-sheet
// normalized-cross-correlation scan off the main thread. Started by
// findSymbolMatchesInWorker() in symbolTemplateMatch.js; one job per worker.
import { findSymbolMatches } from './symbolTemplateMatch.js';

self.onmessage = (e) => {
  const { page, template, opts } = e.data || {};
  try {
    const result = findSymbolMatches(page, template, {
      ...(opts || {}),
      onProgress: (value) => self.postMessage({ type: 'progress', value }),
    });
    self.postMessage({ type: 'result', result });
  } catch (err) {
    self.postMessage({ type: 'error', error: err?.message || String(err) });
  }
};
