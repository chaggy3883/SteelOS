// Drawing revision compare for IRONSIGHT.
//
// Given two rendered page images (old revision, new revision) this builds a
// color overlay — ink only in the old sheet in red (removed), ink only in the
// new sheet in green (added), ink in both in light gray (unchanged) — and
// clusters the changed pixels into bounding boxes that can be drawn as
// revision clouds (see revisionCloudMarkups → takeoffMarkupPdfExport 'rect'
// markups with cloud: true, or BlueprintCanvas drawing).
//
// Images are anything shaped like ImageData: { width, height, data: RGBA }.
// Everything here is plain array math (no DOM) except renderPdfPageToImageData
// and toImageData, so it runs in node and in a Web Worker.
//
// Sheets that shifted/rescaled between revisions: pick the same two points
// on both (e.g. two grid-line intersections), call computeAlignmentTransform,
// and pass the result as `oldToNew`.

const DEFAULT_COLORS = {
  removed: [220, 38, 38],
  added: [22, 163, 74],
  same: [170, 170, 170],
  background: [255, 255, 255],
};

export const OVERLAY_CODES = { none: 0, same: 1, removed: 2, added: 3 };

// ----------------------------------------------------------- transforms
// Affine as { a, b, c, d, e, f }: x' = a·x + c·y + e,  y' = b·x + d·y + f.

export const IDENTITY = Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

export function applyTransform(t, p) {
  return { x: t.a * p.x + t.c * p.y + t.e, y: t.b * p.x + t.d * p.y + t.f };
}

export function invertTransform(t) {
  const det = t.a * t.d - t.b * t.c;
  if (!det) throw new Error('That alignment collapses the sheet to a line — pick two points farther apart.');
  return {
    a: t.d / det,
    b: -t.b / det,
    c: -t.c / det,
    d: t.a / det,
    e: (t.c * t.f - t.d * t.e) / det,
    f: (t.b * t.e - t.a * t.f) / det,
  };
}

/**
 * Similarity transform (uniform scale + optional rotation + translation)
 * mapping old-sheet points onto new-sheet points from two matched pairs.
 * @param {Array<{ from: {x,y}, to: {x,y} }>} pairs exactly two (extra pairs ignored)
 * @param {{ allowRotation?: boolean, allowScale?: boolean }} [opts]
 * @returns {{ transform, scale, rotationDeg, translate: {x,y} }}
 */
export function computeAlignmentTransform(pairs, { allowRotation = false, allowScale = true } = {}) {
  if (!Array.isArray(pairs) || pairs.length < 2) throw new Error('Pick the same two points on both sheets to line them up.');
  const [p1, p2] = pairs;
  const ax = p2.from.x - p1.from.x; const ay = p2.from.y - p1.from.y;
  const bx = p2.to.x - p1.to.x; const by = p2.to.y - p1.to.y;
  const la = Math.hypot(ax, ay); const lb = Math.hypot(bx, by);
  if (la < 1e-9 || lb < 1e-9) throw new Error('The two points are on top of each other — pick two points farther apart.');
  const s = allowScale ? lb / la : 1;
  const theta = allowRotation ? Math.atan2(by, bx) - Math.atan2(ay, ax) : 0;
  const cos = Math.cos(theta) * s; const sin = Math.sin(theta) * s;
  // Anchor on the midpoint of both pairs so error splits evenly when rotation/scale are locked.
  const mfx = (p1.from.x + p2.from.x) / 2; const mfy = (p1.from.y + p2.from.y) / 2;
  const mtx = (p1.to.x + p2.to.x) / 2; const mty = (p1.to.y + p2.to.y) / 2;
  const transform = { a: cos, b: sin, c: -sin, d: cos, e: mtx - (cos * mfx - sin * mfy), f: mty - (sin * mfx + cos * mfy) };
  return { transform, scale: s, rotationDeg: (theta * 180) / Math.PI, translate: { x: transform.e, y: transform.f } };
}

// -------------------------------------------------------------- overlay

const inkMask = (img, threshold) => {
  const { width, height, data } = img;
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const alpha = data[p + 3] / 255;
    // Transparent pixels count as white paper.
    const luma = (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) * alpha + 255 * (1 - alpha);
    out[i] = luma < threshold ? 1 : 0;
  }
  return out;
};

/** Square (Chebyshev) dilation by r pixels, separable: O(w·h) regardless of r. */
export function dilateMask(mask, width, height, r) {
  if (r <= 0) return mask;
  const tmp = new Uint8Array(mask.length);
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let run = -Infinity;
    // left→right: distance since last ink; right→left: distance to next ink
    for (let x = 0; x < width; x++) { if (mask[row + x]) run = x; if (x - run <= r) tmp[row + x] = 1; }
    run = Infinity;
    for (let x = width - 1; x >= 0; x--) { if (mask[row + x]) run = x; if (run - x <= r) tmp[row + x] = 1; }
  }
  for (let x = 0; x < width; x++) {
    let run = -Infinity;
    for (let y = 0; y < height; y++) { if (tmp[y * width + x]) run = y; if (y - run <= r) out[y * width + x] = 1; }
    run = Infinity;
    for (let y = height - 1; y >= 0; y--) { if (tmp[y * width + x]) run = y; if (run - y <= r) out[y * width + x] = 1; }
  }
  return out;
}

/** Old sheet's ink resampled into the new sheet's pixel grid (nearest neighbor). */
const resampleOldMask = (oldMask, oldW, oldH, newW, newH, newToOld) => {
  const out = new Uint8Array(newW * newH);
  const t = newToOld;
  for (let y = 0; y < newH; y++) {
    for (let x = 0; x < newW; x++) {
      const ox = Math.round(t.a * x + t.c * y + t.e);
      const oy = Math.round(t.b * x + t.d * y + t.f);
      if (ox >= 0 && oy >= 0 && ox < oldW && oy < oldH) out[y * newW + x] = oldMask[oy * oldW + ox];
    }
  }
  return out;
};

/**
 * Build the compare overlay in the NEW sheet's pixel space.
 * @param {{width,height,data}} oldImg
 * @param {{width,height,data}} newImg
 * @param {object} [opts]
 * @param {number} [opts.inkThreshold=200] luma below this counts as ink (0–255)
 * @param {number} [opts.tolerancePx=1] ink that moved by ≤ this many pixels is "unchanged" (absorbs anti-aliasing / 1px render jitter)
 * @param {object} [opts.oldToNew] affine from computeAlignmentTransform (old pixel → new pixel)
 * @param {object} [opts.colors] { removed, added, same, background } as [r,g,b]
 * @returns {{ width, height, data: Uint8ClampedArray, codes: Uint8Array, stats: { added, removed, same } }}
 */
export function buildRevisionOverlay(oldImg, newImg, opts = {}) {
  const { inkThreshold = 200, tolerancePx = 1, oldToNew } = opts;
  const colors = { ...DEFAULT_COLORS, ...(opts.colors || {}) };
  const { width, height } = newImg;
  const newMask = inkMask(newImg, inkThreshold);
  let oldMask = inkMask(oldImg, inkThreshold);
  const sameGrid = oldImg.width === width && oldImg.height === height;
  if (oldToNew || !sameGrid) oldMask = resampleOldMask(oldMask, oldImg.width, oldImg.height, width, height, oldToNew ? invertTransform(oldToNew) : IDENTITY);
  const oldNear = dilateMask(oldMask, width, height, tolerancePx);
  const newNear = dilateMask(newMask, width, height, tolerancePx);
  const codes = new Uint8Array(width * height);
  const data = new Uint8ClampedArray(width * height * 4);
  const stats = { added: 0, removed: 0, same: 0 };
  for (let i = 0, p = 0; i < codes.length; i++, p += 4) {
    let code = 0;
    if (newMask[i] && !oldNear[i]) { code = 3; stats.added += 1; } else if (oldMask[i] && !newNear[i]) { code = 2; stats.removed += 1; } else if (newMask[i] || oldMask[i]) { code = 1; stats.same += 1; }
    codes[i] = code;
    const c = code === 3 ? colors.added : code === 2 ? colors.removed : code === 1 ? colors.same : colors.background;
    data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = 255;
  }
  return { width, height, data, codes, stats };
}

/** Wrap an overlay result as a real ImageData (browser/worker only). */
export function toImageData(result) {
  if (typeof ImageData === 'undefined') throw new Error('ImageData is only available in a browser.');
  return new ImageData(result.data, result.width, result.height);
}

// ------------------------------------------------------------ clustering

/**
 * Cluster changed pixels into boxes (grid binning + connected components).
 * @param {{ width, height, codes }} overlay from buildRevisionOverlay
 * @param {object} [opts]
 * @param {number} [opts.cellSize=16] grid cell size in pixels
 * @param {number} [opts.minCellPixels=3] changed pixels for a cell to count (filters speckle)
 * @param {number} [opts.mergeGapCells=1] cells of empty gap still joined into one region
 * @param {number} [opts.padding=6] pixels added around each box
 * @param {number} [opts.minRegionPixels=12] drop regions with fewer changed pixels
 * @returns {Array<{ x, y, width, height, pixels, added, removed, kind: 'added'|'removed'|'mixed' }>} pixel space, largest first
 */
export function findChangedRegions(overlay, opts = {}) {
  const { cellSize = 16, minCellPixels = 3, mergeGapCells = 1, padding = 6, minRegionPixels = 12 } = opts;
  const { width, height, codes } = overlay;
  const gw = Math.ceil(width / cellSize); const gh = Math.ceil(height / cellSize);
  const n = gw * gh;
  const added = new Uint32Array(n); const removed = new Uint32Array(n);
  const minX = new Int32Array(n).fill(2147483647); const minY = new Int32Array(n).fill(2147483647);
  const maxX = new Int32Array(n).fill(-1); const maxY = new Int32Array(n).fill(-1);
  for (let y = 0; y < height; y++) {
    const gy = (y / cellSize) | 0;
    for (let x = 0; x < width; x++) {
      const code = codes[y * width + x];
      if (code < 2) continue;
      const g = gy * gw + ((x / cellSize) | 0);
      if (code === 3) added[g] += 1; else removed[g] += 1;
      if (x < minX[g]) minX[g] = x; if (x > maxX[g]) maxX[g] = x;
      if (y < minY[g]) minY[g] = y; if (y > maxY[g]) maxY[g] = y;
    }
  }
  const active = new Uint8Array(n);
  for (let g = 0; g < n; g++) if (added[g] + removed[g] >= minCellPixels) active[g] = 1;
  const seen = new Uint8Array(n);
  const reach = 1 + Math.max(0, mergeGapCells);
  let regions = [];
  const stack = [];
  for (let g0 = 0; g0 < n; g0++) {
    if (!active[g0] || seen[g0]) continue;
    const r = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, added: 0, removed: 0 };
    stack.push(g0); seen[g0] = 1;
    while (stack.length) {
      const g = stack.pop();
      r.added += added[g]; r.removed += removed[g];
      if (minX[g] < r.x0) r.x0 = minX[g]; if (maxX[g] > r.x1) r.x1 = maxX[g];
      if (minY[g] < r.y0) r.y0 = minY[g]; if (maxY[g] > r.y1) r.y1 = maxY[g];
      const cx = g % gw; const cy = (g / gw) | 0;
      for (let dy = -reach; dy <= reach; dy++) {
        const ny = cy + dy; if (ny < 0 || ny >= gh) continue;
        for (let dx = -reach; dx <= reach; dx++) {
          const nx = cx + dx; if (nx < 0 || nx >= gw) continue;
          const ng = ny * gw + nx;
          if (active[ng] && !seen[ng]) { seen[ng] = 1; stack.push(ng); }
        }
      }
    }
    if (r.added + r.removed >= minRegionPixels) regions.push(r);
  }
  // Pad, clip, then merge boxes that now overlap (padding can make neighbors touch).
  regions = regions.map((r) => ({
    x0: Math.max(0, r.x0 - padding), y0: Math.max(0, r.y0 - padding),
    x1: Math.min(width - 1, r.x1 + padding), y1: Math.min(height - 1, r.y1 + padding),
    added: r.added, removed: r.removed,
  }));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < regions.length; i++) {
      for (let j = i + 1; j < regions.length; j++) {
        const a = regions[i]; const b = regions[j];
        if (a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1) {
          regions[i] = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), added: a.added + b.added, removed: a.removed + b.removed };
          regions.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return regions.map((r) => {
    const pixels = r.added + r.removed;
    const kind = r.added >= pixels * 0.9 ? 'added' : r.removed >= pixels * 0.9 ? 'removed' : 'mixed';
    return { x: r.x0, y: r.y0, width: r.x1 - r.x0 + 1, height: r.y1 - r.y0 + 1, pixels, added: r.added, removed: r.removed, kind };
  }).sort((a, b) => b.pixels - a.pixels);
}

/** Pixel boxes from a page rendered at `renderScale` → IRONSIGHT pdf-space boxes. */
export function boxesToPdfSpace(boxes, renderScale = 1) {
  return boxes.map((b) => ({ ...b, x: b.x / renderScale, y: b.y / renderScale, width: b.width / renderScale, height: b.height / renderScale }));
}

/**
 * Changed regions as normalized markups for takeoffMarkupPdfExport (rect, cloud: true).
 * @param {Array} boxes pixel boxes from findChangedRegions
 * @param {{ page_number?, renderScale?, color?, label? }} [opts]
 */
export function revisionCloudMarkups(boxes, { page_number = 1, renderScale = 1, color = '#dc2626', label = 'Revision change' } = {}) {
  return boxesToPdfSpace(boxes, renderScale).map((b, i) => ({
    id: `rev-cloud-${page_number}-${i + 1}`,
    page_number,
    type: 'rect',
    cloud: true,
    cloud_arc: Math.max(6, Math.min(b.width, b.height) / 6),
    points: [{ pdfX: b.x, pdfY: b.y }, { pdfX: b.x + b.width, pdfY: b.y + b.height }],
    color,
    line_width: 1.5,
    label,
    subject: 'Revision',
    contents: `${label} (${b.kind})`,
  }));
}

/**
 * Render a pdf.js page to ImageData at `scale` (browser only). Use the same
 * scale for both revisions so their pixel grids line up.
 */
export async function renderPdfPageToImageData(pdfPage, scale = 1.5) {
  const viewport = pdfPage.getViewport({ scale });
  const w = Math.ceil(viewport.width); const h = Math.ceil(viewport.height);
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  await pdfPage.render({ canvasContext: ctx, canvas, viewport }).promise;
  return ctx.getImageData(0, 0, w, h);
}

// --------------------------------------------------------------- self-check

const makeImage = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) });
const fillRect = (img, x0, y0, w, h) => {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
    const p = (y * img.width + x) * 4; img.data[p] = 0; img.data[p + 1] = 0; img.data[p + 2] = 0;
  }
};

export function runOverlaySelfCheck() {
  const failures = [];
  let passed = 0;
  const check = (label, cond) => { if (cond) passed += 1; else failures.push(label); };

  // Shared border + a beam that stays; old has a detail at (20,20) that was
  // deleted; new adds a detail at (140,90).
  const oldImg = makeImage(200, 150); const newImg = makeImage(200, 150);
  [oldImg, newImg].forEach((im) => { fillRect(im, 0, 0, 200, 2); fillRect(im, 0, 148, 200, 2); fillRect(im, 50, 70, 100, 3); });
  fillRect(oldImg, 20, 20, 20, 10);
  fillRect(newImg, 140, 90, 30, 25);
  const ov = buildRevisionOverlay(oldImg, newImg, { tolerancePx: 1 });
  check('removed px 200', ov.stats.removed === 200);
  check('added px 750', ov.stats.added === 750);
  const regions = findChangedRegions(ov, { padding: 0 });
  check(`2 regions (got ${regions.length})`, regions.length === 2);
  const add = regions.find((r) => r.kind === 'added');
  const rem = regions.find((r) => r.kind === 'removed');
  check('added box', add && add.x === 140 && add.y === 90 && add.width === 30 && add.height === 25);
  check('removed box', rem && rem.x === 20 && rem.y === 20 && rem.width === 20 && rem.height === 10);
  check('overlay colors', ov.data[(25 * 200 + 25) * 4] === 220 && ov.data[(100 * 200 + 150) * 4 + 1] === 163 && ov.data[(71 * 200 + 60) * 4] === 170);

  // 1px jitter is absorbed by tolerance.
  const jit = makeImage(200, 150);
  fillRect(jit, 0, 1, 200, 2); fillRect(jit, 0, 148, 200, 2); fillRect(jit, 51, 70, 100, 3);
  const base = makeImage(200, 150);
  fillRect(base, 0, 0, 200, 2); fillRect(base, 0, 148, 200, 2); fillRect(base, 50, 70, 100, 3);
  check('jitter tolerated', buildRevisionOverlay(base, jit, { tolerancePx: 1 }).stats.added === 0);

  // Sheet shifted by (+12, +7): alignment from two matched points → no change.
  const shifted = makeImage(200, 150);
  fillRect(shifted, 62, 77, 100, 3); fillRect(shifted, 32, 27, 20, 10);
  const orig = makeImage(200, 150);
  fillRect(orig, 50, 70, 100, 3); fillRect(orig, 20, 20, 20, 10);
  const { transform, scale } = computeAlignmentTransform([{ from: { x: 50, y: 70 }, to: { x: 62, y: 77 } }, { from: { x: 20, y: 20 }, to: { x: 32, y: 27 } }]);
  check('alignment scale 1', Math.abs(scale - 1) < 1e-9 && Math.abs(transform.e - 12) < 1e-9 && Math.abs(transform.f - 7) < 1e-9);
  const aligned = buildRevisionOverlay(orig, shifted, { oldToNew: transform, tolerancePx: 0 });
  check(`aligned no change (a${aligned.stats.added}/r${aligned.stats.removed})`, aligned.stats.added === 0 && aligned.stats.removed === 0);
  check('unaligned has change', buildRevisionOverlay(orig, shifted, { tolerancePx: 1 }).stats.added > 0);

  // Scale ×2 + rotation 90°: (0,0)→(10,10), (10,0)→(10,30)
  const rot = computeAlignmentTransform([{ from: { x: 0, y: 0 }, to: { x: 10, y: 10 } }, { from: { x: 10, y: 0 }, to: { x: 10, y: 30 } }], { allowRotation: true });
  const q = applyTransform(rot.transform, { x: 0, y: 5 });
  check('rot/scale transform', Math.abs(rot.scale - 2) < 1e-9 && Math.abs(rot.rotationDeg - 90) < 1e-9 && Math.abs(q.x - 0) < 1e-9 && Math.abs(q.y - 10) < 1e-9);
  const inv = applyTransform(invertTransform(rot.transform), q);
  check('invert', Math.abs(inv.x) < 1e-9 && Math.abs(inv.y - 5) < 1e-9);

  const clouds = revisionCloudMarkups([add], { page_number: 3, renderScale: 2 });
  check('cloud markup pdf-space', clouds[0].points[0].pdfX === 70 && clouds[0].points[1].pdfY === 57.5 && clouds[0].cloud);
  return { passed, failed: failures.length, failures };
}
