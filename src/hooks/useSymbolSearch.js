import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cropImage, findSymbolMatchesInWorker, matchesToPdfSpace } from '@/lib/symbolTemplateMatch';

// Lowest score the matcher is asked for. The review slider can only filter
// down from what was found, so this is the bottom of the slider's range —
// moving the slider never re-runs the search.
export const MIN_SEARCH_THRESHOLD = 0.6;
export const DEFAULT_SEARCH_THRESHOLD = 0.8;
// Big sheets render at less than 2 px/pt so the image stays a sane size
// for the matcher (a 36"×24" sheet is 2592×1728 pt).
const MAX_RENDER_DIM = 5000;

// IRONSIGHT Visual Search (no AI): the estimator boxes one symbol, the page
// is rendered off-screen, and a normalized-cross-correlation matcher
// (symbolTemplateMatch.js, in a Web Worker) finds the others at 0/90/180/270°.
// Results are review-only candidates — nothing becomes a count mark until
// the estimator accepts them and picks which count they go to.
//
//   phase: 'idle' → start() → 'picking' → onBoxSelect(box) → 'searching'
//          → 'review' (accept/reject, threshold) → clear()
export function useSymbolSearch({ canvasRef, pageNum, pageSize }) {
  const [phase, setPhase] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [threshold, setThreshold] = useState(DEFAULT_SEARCH_THRESHOLD);
  const [searchPage, setSearchPage] = useState(null);
  const jobRef = useRef(null);

  const stopJob = useCallback(() => {
    jobRef.current?.cancel();
    jobRef.current = null;
  }, []);

  const clear = useCallback(() => {
    stopJob();
    setPhase('idle');
    setProgress(0);
    setError(null);
    setCandidates([]);
    setSearchPage(null);
  }, [stopJob]);

  // Candidates only mean something on the page they were found on.
  useEffect(() => { clear(); }, [pageNum, clear]);
  useEffect(() => () => stopJob(), [stopJob]);

  const start = useCallback(() => {
    stopJob();
    setCandidates([]);
    setError(null);
    setProgress(0);
    setPhase('picking');
  }, [stopJob]);

  const onBoxSelect = useCallback(async (box) => {
    if (!canvasRef.current?.renderPageImage) { setError('The drawing isn\'t ready yet.'); setPhase('idle'); return; }
    setPhase('searching');
    setProgress(0);
    setError(null);
    try {
      const longest = Math.max(pageSize?.width || 0, pageSize?.height || 0) || 1000;
      const renderScale = Math.min(2, MAX_RENDER_DIM / longest);
      const rendered = await canvasRef.current.renderPageImage(renderScale);
      if (!rendered) throw new Error('The drawing isn\'t ready yet.');
      const pxBox = { x: box.x * renderScale, y: box.y * renderScale, width: box.width * renderScale, height: box.height * renderScale };
      const template = cropImage(rendered.image, pxBox);
      if (template.width < 6 || template.height < 6) throw new Error('That box is too small — drag a box around the whole symbol.');
      const job = findSymbolMatchesInWorker(rendered.image, template, {
        threshold: MIN_SEARCH_THRESHOLD,
        rotations: [0, 90, 180, 270],
        excludeBox: pxBox,
        onProgress: (v) => setProgress(v),
      });
      jobRef.current = job;
      const result = await job.promise;
      if (jobRef.current !== job) return; // cancelled or superseded
      jobRef.current = null;
      const found = matchesToPdfSpace(result.matches || [], renderScale).map((m, i) => ({
        id: `match-${i + 1}`,
        pdfX: m.pdfX,
        pdfY: m.pdfY,
        pdfWidth: m.pdfWidth,
        pdfHeight: m.pdfHeight,
        centerPdfX: m.centerPdfX,
        centerPdfY: m.centerPdfY,
        score: m.score,
        rotation: m.rotation,
        status: 'pending',
      }));
      // The symbol the estimator boxed is one of them too — counted unless
      // they reject it.
      const picked = {
        id: 'picked', picked: true, pdfX: box.x, pdfY: box.y, pdfWidth: box.width, pdfHeight: box.height,
        centerPdfX: box.x + box.width / 2, centerPdfY: box.y + box.height / 2, score: 1, rotation: 0, status: 'accepted',
      };
      setCandidates([picked, ...found]);
      setSearchPage(rendered.pageNumber);
      setPhase('review');
    } catch (e) {
      if (jobRef.current) jobRef.current = null;
      console.error('Visual search failed', e);
      setError(e?.message || 'Visual search failed.');
      setPhase('idle');
    }
  }, [canvasRef, pageSize?.width, pageSize?.height]);

  const cancel = useCallback(() => clear(), [clear]);

  const visible = useMemo(() => candidates.filter((c) => c.picked || c.score >= threshold), [candidates, threshold]);
  const accepted = useMemo(() => visible.filter((c) => c.status === 'accepted'), [visible]);
  const pendingCount = visible.filter((c) => c.status === 'pending').length;

  const toggle = useCallback((id) => {
    setCandidates((prev) => prev.map((c) => (c.id === id ? { ...c, status: c.status === 'accepted' ? 'rejected' : 'accepted' } : c)));
  }, []);

  const acceptAll = useCallback(() => {
    setCandidates((prev) => prev.map((c) => (c.status === 'pending' && (c.picked || c.score >= threshold) ? { ...c, status: 'accepted' } : c)));
  }, [threshold]);

  const rejectAll = useCallback(() => {
    setCandidates((prev) => prev.map((c) => (c.status === 'pending' && (c.picked || c.score >= threshold) ? { ...c, status: 'rejected' } : c)));
  }, [threshold]);

  return {
    phase, progress, error, threshold, setThreshold, candidates, visible, accepted, pendingCount, searchPage,
    start, onBoxSelect, cancel, clear, toggle, acceptAll, rejectAll,
  };
}
