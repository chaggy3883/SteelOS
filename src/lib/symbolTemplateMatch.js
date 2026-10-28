// Non-AI visual search for IRONSIGHT: find every place a symbol (template
// crop) appears on a rendered sheet, by normalized cross-correlation (NCC).
//
//   score(x, y) = Σ (T - mean T)(P - mean P) / (|T - mean T| · |P - mean P|)   ∈ [-1, 1]
//
// Speed on large sheets (a 36x24 sheet rendered at 2x is ~18M pixels):
//   1. coarse pass on a box-downscaled copy (template ≥ ~8px on its short side);
//   2. window mean/variance from sliding column sums — O(1) per position,
//      memory O(width) — so blank paper and near-empty windows are skipped
//      before any correlation work;
//   3. the correlation sum only visits the template's ink pixels:
//      Σ T'·P = (255 - mean T)·ΣP - Σ D·P, where D = 255 - T is zero on paper;
//   4. coarse peaks are non-max-suppressed, then refined at full resolution in
//      a small neighborhood, then suppressed again across rotations.
// Pure array math — runs in node, on the main thread, or in the companion
// Web Worker (symbolTemplateMatch.worker.js via findSymbolMatchesInWorker).

const luma = (data, p) => {
  const a = data[p + 3] / 255;
  return (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) * a + 255 * (1 - a);
};

/** ImageData-like → { width, height, gray: Uint8Array } (transparent = white paper). */
export function toGray(img) {
  if (img.gray) return img;
  const { width, height, data } = img;
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) gray[i] = luma(data, p);
  return { width, height, gray };
}

/** Box-average downscale by an integer factor. */
export function downscaleGray(src, factor) {
  if (factor <= 1) return src;
  const w = Math.floor(src.width / factor); const h = Math.floor(src.height / factor);
  const out = new Uint8Array(w * h);
  const area = factor * factor;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < factor; dy++) {
        const row = (y * factor + dy) * src.width + x * factor;
        for (let dx = 0; dx < factor; dx++) s += src.gray[row + dx];
      }
      out[y * w + x] = Math.round(s / area);
    }
  }
  return { width: w, height: h, gray: out };
}

/**
 * Coarse template that doesn't care where the symbol sits relative to the
 * page's downscale grid: the average of the template downscaled at every
 * (px, py) sub-cell offset. A single fixed-phase template scores thin
 * linework poorly whenever the real symbol lands off-grid.
 */
export function phaseAveragedDownscale(src, factor) {
  if (factor <= 1) return src;
  const pw = src.width + factor - 1; const ph = src.height + factor - 1;
  const w = Math.floor(pw / factor); const h = Math.floor(ph / factor);
  const acc = new Float64Array(w * h);
  const padded = { width: pw, height: ph, gray: new Uint8Array(pw * ph) };
  for (let py = 0; py < factor; py++) {
    for (let px = 0; px < factor; px++) {
      padded.gray.fill(255);
      for (let y = 0; y < src.height; y++) padded.gray.set(src.gray.subarray(y * src.width, (y + 1) * src.width), (y + py) * pw + px);
      const d = downscaleGray(padded, factor);
      for (let i = 0; i < acc.length; i++) acc[i] += d.gray[i];
    }
  }
  const out = new Uint8Array(w * h);
  const n = factor * factor;
  for (let i = 0; i < out.length; i++) out[i] = Math.round(acc[i] / n);
  return { width: w, height: h, gray: out };
}

/** Rotate a gray image clockwise by 0/90/180/270. */
export function rotateGray(src, deg) {
  const r = ((deg % 360) + 360) % 360;
  if (!r) return src;
  const { width: w, height: h, gray } = src;
  const nw = r === 180 ? w : h; const nh = r === 180 ? h : w;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx; let ny;
      if (r === 90) { nx = h - 1 - y; ny = x; } else if (r === 180) { nx = w - 1 - x; ny = h - 1 - y; } else { nx = y; ny = w - 1 - x; }
      out[ny * nw + nx] = gray[y * w + x];
    }
  }
  return { width: nw, height: nh, gray: out };
}

const prepTemplate = (t) => {
  const n = t.width * t.height;
  let sum = 0; let sum2 = 0;
  const idx = []; const dark = [];
  for (let i = 0; i < n; i++) {
    const v = t.gray[i];
    sum += v; sum2 += v * v;
    if (v < 255) { idx.push(i); dark.push(255 - v); }
  }
  const mean = sum / n;
  const norm = Math.sqrt(Math.max(0, sum2 - (sum * sum) / n));
  // Sparse ink offsets as (dy, dx) pairs for any page width.
  const dy = new Int32Array(idx.length); const dx = new Int32Array(idx.length);
  idx.forEach((i, k) => { dy[k] = (i / t.width) | 0; dx[k] = i % t.width; });
  return { width: t.width, height: t.height, n, sum, mean, norm, dy, dx, dark: Float64Array.from(dark), darkness: n * 255 - sum };
};

/** NCC at one position, computing window stats directly (used for refinement). */
const nccAt = (page, tp, x, y) => {
  const { width: W, gray } = page;
  let s = 0; let s2 = 0;
  for (let ty = 0; ty < tp.height; ty++) {
    const row = (y + ty) * W + x;
    for (let tx = 0; tx < tp.width; tx++) { const v = gray[row + tx]; s += v; s2 += v * v; }
  }
  const varP = s2 - (s * s) / tp.n;
  if (varP <= 1e-6 || tp.norm <= 1e-6) return -1;
  let dp = 0;
  for (let k = 0; k < tp.dark.length; k++) dp += tp.dark[k] * gray[(y + tp.dy[k]) * W + x + tp.dx[k]];
  const corr = (255 - tp.mean) * s - dp;
  return corr / (tp.norm * Math.sqrt(varP));
};

/**
 * Scan every position of `page` (already gray) for `tp`, returning positions
 * with score ≥ minScore. Window sums come from sliding column sums.
 */
const scan = (page, tp, minScore, region, shouldStop) => {
  const { width: W, height: H, gray } = page;
  const w = tp.width; const h = tp.height;
  const x0 = Math.max(0, region?.x0 ?? 0); const y0 = Math.max(0, region?.y0 ?? 0);
  const x1 = Math.min(W - w, region?.x1 ?? W - w); const y1 = Math.min(H - h, region?.y1 ?? H - h);
  const hits = [];
  if (x1 < x0 || y1 < y0) return hits;
  const colSum = new Float64Array(W); const colSum2 = new Float64Array(W);
  for (let k = 0; k < h; k++) {
    const row = (y0 + k) * W;
    for (let x = 0; x < W; x++) { const v = gray[row + x]; colSum[x] += v; colSum2[x] += v * v; }
  }
  const minDark = tp.darkness * 0.35; const maxDark = tp.darkness * 3 + 255 * 2;
  const n = tp.n;
  const k255 = 255 - tp.mean;
  for (let y = y0; y <= y1; y++) {
    if (y > y0) {
      const add = (y + h - 1) * W; const sub = (y - 1) * W;
      for (let x = 0; x < W; x++) {
        const a = gray[add + x]; const s = gray[sub + x];
        colSum[x] += a - s; colSum2[x] += a * a - s * s;
      }
    }
    if (shouldStop && (y & 31) === 0 && shouldStop()) return hits;
    let s = 0; let s2 = 0;
    for (let x = x0; x < x0 + w; x++) { s += colSum[x]; s2 += colSum2[x]; }
    for (let x = x0; x <= x1; x++) {
      if (x > x0) { s += colSum[x + w - 1] - colSum[x - 1]; s2 += colSum2[x + w - 1] - colSum2[x - 1]; }
      const darkness = n * 255 - s;
      if (darkness < minDark || darkness > maxDark) continue;
      const varP = s2 - (s * s) / n;
      if (varP <= 1e-6) continue;
      let dp = 0;
      const base = y * W + x;
      for (let k = 0; k < tp.dark.length; k++) dp += tp.dark[k] * gray[base + tp.dy[k] * W + tp.dx[k]];
      const score = (k255 * s - dp) / (tp.norm * Math.sqrt(varP));
      if (score >= minScore) hits.push({ x, y, score });
    }
  }
  return hits;
};

const iou = (a, b) => {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const inter = ix * iy;
  return inter / (a.width * a.height + b.width * b.height - inter || 1);
};

/** Greedy non-max suppression by IoU; boxes need x,y,width,height,score. */
export function nonMaxSuppression(boxes, iouThreshold = 0.3, limit = Infinity) {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  const keep = [];
  for (const b of sorted) {
    if (keep.length >= limit) break;
    if (keep.every((k) => iou(k, b) < iouThreshold)) keep.push(b);
  }
  return keep;
}

/**
 * Find a symbol on a sheet.
 * @param {{width,height,data}|{width,height,gray}} pageImage rendered sheet
 * @param {{width,height,data}|{width,height,gray}} templateImage cropped symbol (from the same render scale)
 * @param {object} [opts]
 * @param {number} [opts.threshold=0.8] minimum NCC score (0–1) for a match
 * @param {number[]} [opts.rotations=[0]] any of 0/90/180/270
 * @param {number} [opts.maxResults=1000]
 * @param {number} [opts.iou=0.3] overlap above which weaker boxes are dropped
 * @param {{x,y,width,height}} [opts.region] only search inside this page box
 * @param {{x,y,width,height}} [opts.excludeBox] drop matches overlapping this box (e.g. where the template was cropped)
 * @param {(fraction:number)=>void} [opts.onProgress]
 * @param {()=>boolean} [opts.shouldStop] return true to abandon early
 * @param {number} [opts.coarseMargin=0.25] how far below `threshold` a coarse peak may score and still be refined (higher = better recall, slower)
 * @param {number} [opts.coarseMinSide=8] template short side, in coarse pixels, that picks the downscale factor
 * @returns {{ matches: Array<{x,y,width,height,score,rotation}>, coarseFactor, candidates, ms }}
 */
export function findSymbolMatches(pageImage, templateImage, opts = {}) {
  const started = Date.now();
  const { threshold = 0.8, rotations = [0], maxResults = 1000, iou: iouThr = 0.3, region, excludeBox, onProgress, shouldStop } = opts;
  const page = toGray(pageImage);
  const tmpl0 = toGray(templateImage);
  if (tmpl0.width < 4 || tmpl0.height < 4) throw new Error('The symbol crop is too small — drag a box at least a few pixels around it.');
  if (tmpl0.width > page.width || tmpl0.height > page.height) throw new Error('The symbol crop is bigger than the sheet.');
  const probe = prepTemplate(tmpl0);
  if (probe.norm < 1e-3 || probe.darkness < 255) throw new Error('The symbol crop is blank — drag the box around the symbol\'s linework.');

  const minSide = Math.min(tmpl0.width, tmpl0.height);
  const factor = Math.max(1, Math.min(8, Math.floor(minSide / (opts.coarseMinSide ?? 8))));
  const coarsePage = downscaleGray(page, factor);
  // Downscaling blurs thin linework and shifts phase, so the coarse pass
  // accepts much weaker peaks; the full-resolution refine applies `threshold`.
  const coarseThreshold = Math.max(0.25, threshold - (factor > 1 ? (opts.coarseMargin ?? 0.25) : 0.05));
  const rots = [...new Set(rotations.map((r) => ((Math.round(r / 90) * 90) % 360 + 360) % 360))];
  const reg = region ? { x0: Math.floor(region.x / factor), y0: Math.floor(region.y / factor), x1: Math.ceil((region.x + region.width) / factor), y1: Math.ceil((region.y + region.height) / factor) } : null;

  const candidates = [];
  const stop = () => Boolean(shouldStop && shouldStop());
  rots.forEach((rot, ri) => {
    if (stop()) return;
    const tFull = rotateGray(tmpl0, rot);
    const tCoarse = prepTemplate(phaseAveragedDownscale(tFull, factor));
    const tpFull = prepTemplate(tFull);
    if (tCoarse.norm < 1e-3) return;
    const hits = scan(coarsePage, tCoarse, coarseThreshold, reg, shouldStop);
    // Light coarse NMS (IoU 0.5): only collapses near-duplicate peaks, so a
    // false peak next to a real symbol cannot hide it before refinement.
    const peaks = nonMaxSuppression(hits.map((p) => ({ ...p, width: tCoarse.width, height: tCoarse.height })), 0.5, 20000);
    peaks.forEach((p, pi) => {
      if ((pi & 63) === 0 && stop()) return;
      // Refine at full resolution around the coarse peak.
      let best = { score: -1, x: 0, y: 0 };
      const cx = p.x * factor; const cy = p.y * factor;
      const r = factor + 1;
      for (let y = Math.max(0, cy - r); y <= Math.min(page.height - tpFull.height, cy + r); y++) {
        for (let x = Math.max(0, cx - r); x <= Math.min(page.width - tpFull.width, cx + r); x++) {
          const s = nccAt(page, tpFull, x, y);
          if (s > best.score) best = { score: s, x, y };
        }
      }
      if (best.score >= threshold) candidates.push({ x: best.x, y: best.y, width: tpFull.width, height: tpFull.height, score: Math.round(best.score * 1000) / 1000, rotation: rot });
    });
    onProgress?.((ri + 1) / rots.length);
  });
  let matches = nonMaxSuppression(candidates, iouThr, maxResults);
  if (excludeBox) matches = matches.filter((m) => iou(m, excludeBox) < 0.3);
  return { matches, coarseFactor: factor, candidates: candidates.length, ms: Date.now() - started };
}

/** Crop a box out of an ImageData-like image (returns a new { width, height, data }). */
export function cropImage(img, box) {
  const x0 = Math.max(0, Math.round(box.x)); const y0 = Math.max(0, Math.round(box.y));
  const w = Math.max(1, Math.min(img.width - x0, Math.round(box.width)));
  const h = Math.max(1, Math.min(img.height - y0, Math.round(box.height)));
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = ((y0 + y) * img.width + x0) * 4;
    data.set(img.data.subarray(src, src + w * 4), y * w * 4);
  }
  return { width: w, height: h, data };
}

/** Page-image pixel boxes → IRONSIGHT pdf-space (divide by the render scale). */
export function matchesToPdfSpace(matches, renderScale = 1) {
  return matches.map((m) => ({ ...m, pdfX: m.x / renderScale, pdfY: m.y / renderScale, pdfWidth: m.width / renderScale, pdfHeight: m.height / renderScale, centerPdfX: (m.x + m.width / 2) / renderScale, centerPdfY: (m.y + m.height / 2) / renderScale }));
}

/**
 * Run findSymbolMatches in a module Web Worker so a large sheet doesn't freeze
 * the page. Returns { promise, cancel }. Functions in opts are not sent;
 * opts.onProgress is called from worker progress messages.
 */
export function findSymbolMatchesInWorker(pageImage, templateImage, opts = {}) {
  const { onProgress, shouldStop: _ignored, ...rest } = opts;
  const worker = new Worker(new URL('./symbolTemplateMatch.worker.js', import.meta.url), { type: 'module' });
  let settled = false;
  const plain = (img) => (img.gray ? { width: img.width, height: img.height, gray: img.gray } : { width: img.width, height: img.height, data: img.data });
  const promise = new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      const msg = e.data || {};
      if (msg.type === 'progress') { onProgress?.(msg.value); return; }
      settled = true;
      worker.terminate();
      if (msg.type === 'result') resolve(msg.result); else reject(new Error(msg.error || 'Visual search failed.'));
    };
    worker.onerror = (e) => { if (!settled) { settled = true; worker.terminate(); reject(new Error(e.message || 'Visual search worker crashed.')); } };
    worker.postMessage({ page: plain(pageImage), template: plain(templateImage), opts: rest });
  });
  const cancel = () => { if (!settled) { settled = true; worker.terminate(); } };
  return { promise, cancel };
}

// --------------------------------------------------------------- self-check

const blank = (w, h) => ({ width: w, height: h, gray: new Uint8Array(w * h).fill(255) });
const ink = (img, x, y, v = 0) => { if (x >= 0 && y >= 0 && x < img.width && y < img.height) img.gray[y * img.width + x] = v; };
// An asymmetric "column tag": ring + flag line to the right, so rotations differ.
const stampSymbol = (img, ox, oy, rot = 0) => {
  const s = blank(32, 32);
  for (let a = 0; a < 360; a += 1) { const t = (a * Math.PI) / 180; ink(s, Math.round(12 + 9 * Math.cos(t)), Math.round(12 + 9 * Math.sin(t))); ink(s, Math.round(12 + 8 * Math.cos(t)), Math.round(12 + 8 * Math.sin(t))); }
  for (let x = 21; x < 31; x++) { ink(s, x, 12); ink(s, x, 13); }
  for (let y = 4; y < 12; y++) { ink(s, 29, y); ink(s, 30, y); }
  const r = rotateGray(s, rot);
  for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) if (r.gray[y * r.width + x] < 255) ink(img, ox + x, oy + y, r.gray[y * r.width + x]);
  return s;
};

export function runTemplateMatchSelfCheck() {
  const failures = [];
  let passed = 0;
  const check = (label, cond) => { if (cond) passed += 1; else failures.push(label); };
  const page = blank(1600, 1100);
  // Grid lines (distractors) + square distractors.
  for (let x = 0; x < 1600; x++) { ink(page, x, 300); ink(page, x, 800); }
  for (let y = 0; y < 1100; y++) { ink(page, 400, y); ink(page, 1200, y); }
  for (let i = 0; i < 6; i++) for (let d = 0; d < 20; d++) { ink(page, 600 + i * 90 + d, 950); ink(page, 600 + i * 90 + d, 970); ink(page, 600 + i * 90, 950 + d); ink(page, 620 + i * 90, 950 + d); }
  const upright = [[100, 100], [700, 120], [1300, 500], [900, 600]];
  const turned = [[200, 900], [1450, 150]];
  let tmpl;
  upright.forEach(([x, y]) => { tmpl = stampSymbol(page, x, y, 0); });
  turned.forEach(([x, y]) => stampSymbol(page, x, y, 90));
  const t0 = Date.now();
  const r0 = findSymbolMatches(page, tmpl, { threshold: 0.8, rotations: [0] });
  check(`upright only finds 4 (got ${r0.matches.length})`, r0.matches.length === 4);
  check('positions exact', upright.every(([x, y]) => r0.matches.some((m) => m.x === x && m.y === y && m.score > 0.99)));
  const r1 = findSymbolMatches(page, tmpl, { threshold: 0.8, rotations: [0, 90, 180, 270] });
  check(`with rotations finds 6 (got ${r1.matches.length})`, r1.matches.length === 6);
  check('rotated tagged 90', turned.every(([x, y]) => r1.matches.some((m) => m.x === x && m.y === y && m.rotation === 90)));
  const r2 = findSymbolMatches(page, tmpl, { threshold: 0.8, excludeBox: { x: 900, y: 600, width: 32, height: 32 } });
  check('excludeBox', r2.matches.length === 3);
  const pdf = matchesToPdfSpace(r0.matches, 2);
  check('pdf space', pdf.some((m) => m.pdfX === 50 && m.pdfY === 50 && m.centerPdfX === 58));
  let threw = false;
  try { findSymbolMatches(page, blank(20, 20)); } catch { threw = true; }
  check('blank template error', threw);
  return { passed, failed: failures.length, failures, ms: Date.now() - t0 };
}
