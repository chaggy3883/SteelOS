// Which piece(s) a drawing file belongs to, from its file name — shared by
// every place drawings are uploaded (Detailer Imports, Project → Pieces,
// Parts & Hardware) and by the "waiting for a piece" list that re-checks
// held drawings when new pieces arrive (drawingIntake.js). Pure: no storage,
// so it's testable on its own.
//
// Real file names aren't tidy. All of these find assembly 2B9:
//   2B9.pdf · 2b9.pdf · 2B9 Rev 1.pdf · 2B9_R1.pdf · 2B9-REV.A.pdf ·
//   25-101 2B9.pdf · Muskingum 2B9 (1).pdf
// A name can also be the detailer's drawing (sheet) number from the KSS
// ("S-201.pdf"), a single-part drawing ("p185.pdf" — shown on every
// assembly that uses that part), or name several marks on one sheet
// ("2B9 & 2B10.pdf" — attached to both). A name that finds nothing is held
// until a piece with that mark is added, or until someone assigns it.

import { documentsKeyForPiece, partDocumentsKey, piecePartMarks } from '@/lib/pieceMarkDocumentStore';

const norm = (s) => String(s ?? '').trim().toUpperCase();
const hasLetterAndDigit = (s) => /[A-Z]/.test(s) && /\d/.test(s);

export const stripFileExtension = (filename) => String(filename || '').replace(/\.[^./\\]+$/, '');

// "Rev 1", "REV.A", "_R2", "-R0" (needs a separator before it, so a mark
// like "3R2" isn't read as a revision).
const REVISION = /(?:^|[\s_.-])(?:REV(?:ISION)?|R)[\s_.-]*([0-9]{1,3}|[A-Z])(?=$|[\s_.)-])/i;

// -> { stem, base, revision, candidates: [upper-case strings, most specific first] }
export function parseDrawingFileName(fileName) {
  const stem = stripFileExtension(fileName).trim().replace(/\s*\(\d+\)$/, ''); // "2B9 (1)" = a re-downloaded copy
  const rev = stem.match(REVISION);
  const revision = rev ? rev[1].toUpperCase() : '';
  const base = rev ? `${stem.slice(0, rev.index)} ${stem.slice(rev.index + rev[0].length)}`.replace(/\s+/g, ' ').trim().replace(/[\s_.-]+$/, '') : stem;
  // whole: the full name / the name without its revision. words: each word,
  // plus the halves of a hyphenated word that look like marks ("S-2B9" ->
  // "2B9"; but "25-101" never yields a bare "101").
  const whole = [...new Set([norm(stem), norm(base)].filter(Boolean))];
  const words = [];
  const add = (c) => { const v = norm(c); if (v && !whole.includes(v) && !words.includes(v)) words.push(v); };
  base.split(/[\s_,;+&()[\]]+/).filter(Boolean).forEach((tok) => {
    add(tok);
    if (tok.includes('-')) tok.split('-').filter((h) => hasLetterAndDigit(norm(h))).forEach(add);
  });
  return { stem, base, revision, whole, words, candidates: [...whole, ...words] };
}

// Lookup tables over one project's pieces, built once per upload.
export function buildDrawingIndex(pieces, projectId) {
  const push = (map, k, v) => { const key = norm(k); if (!key) return; if (!map.has(key)) map.set(key, []); map.get(key).push(v); };
  const byMark = new Map();
  const byAssembly = new Map();
  const byDrawing = new Map();
  const byPart = new Map();
  (pieces || []).forEach((p) => {
    push(byMark, p.piece_mark, p);
    if (p.assembly_mark) push(byAssembly, p.assembly_mark, p);
    if (p.drawing_number) push(byDrawing, p.drawing_number, p);
    piecePartMarks(p).forEach((m) => push(byPart, m, p));
  });
  return { projectId: projectId || pieces?.[0]?.project_id, byMark, byAssembly, byDrawing, byPart, pieceCount: (pieces || []).length };
}

// One target per storage key: copies of an assembly share one key.
function targetsForPieces(pieces, via, mark) {
  const byKey = new Map();
  pieces.forEach((p) => {
    const key = documentsKeyForPiece(p);
    if (!byKey.has(key)) byKey.set(key, { key, via, mark, pieces: [] });
    byKey.get(key).pieces.push(p);
  });
  return [...byKey.values()].map((t) => {
    const first = t.pieces[0];
    // Copies share one drawing list, so "2B9-2.pdf" is on all of 2B9.
    const copies = Math.max(t.pieces.length, Number(first.copy_count) || 1);
    const label = first.assembly_mark
      ? `${first.assembly_mark}${copies > 1 ? ` (all ${copies} copies)` : ''}`
      : first.piece_mark;
    return { ...t, label };
  });
}

function lookup(index, c) {
  if (index.byMark.has(c)) return targetsForPieces(index.byMark.get(c), 'mark', c);
  if (index.byAssembly.has(c)) return targetsForPieces(index.byAssembly.get(c), 'assembly', c);
  if (index.byDrawing.has(c)) return targetsForPieces(index.byDrawing.get(c), 'drawing', c);
  if (index.byPart.has(c)) {
    const users = index.byPart.get(c);
    const assemblies = new Set(users.map((p) => norm(p.assembly_mark || p.piece_mark)));
    return [{
      key: partDocumentsKey(index.projectId || users[0].project_id, c),
      via: 'part',
      mark: c,
      partMark: c,
      pieces: users,
      label: `part ${c} (used in ${assemblies.size} assembl${assemblies.size === 1 ? 'y' : 'ies'})`,
    }];
  }
  return null;
}

// fileName: the file's name. markOverride: what a person typed instead
// ("2B9", or several: "2B9, 2B10") — only those are tried.
// -> { targets: [{ key, via, mark, label, pieces, partMark? }], revision, base, tried: [...] }
export function matchDrawing(index, fileName, markOverride) {
  const parsed = parseDrawingFileName(fileName);
  const result = { targets: [], revision: parsed.revision, base: parsed.base, tried: [] };
  if (!index) return result;

  if (markOverride && String(markOverride).trim()) {
    const marks = String(markOverride).split(/[,;&+]|\s{2,}/).map(norm).filter(Boolean);
    result.tried = marks;
    const seen = new Set();
    marks.forEach((m) => (lookup(index, m) || []).forEach((t) => { if (!seen.has(t.key)) { seen.add(t.key); result.targets.push(t); } }));
    return result;
  }

  result.tried = parsed.candidates;
  // The whole name (or the name without its revision) wins outright.
  for (const c of parsed.whole) {
    const hit = lookup(index, c);
    if (hit) { result.targets = hit; return result; }
  }
  // Otherwise every word in the name that is a mark. Bare numbers ("25",
  // "101" from a job number) only count when nothing better is found.
  const hits = parsed.words.map((c) => ({ c, t: lookup(index, c) })).filter((h) => h.t);
  const strong = hits.filter((h) => hasLetterAndDigit(h.c));
  const use = strong.length ? strong : hits;
  const seen = new Set();
  use.forEach((h) => h.t.forEach((t) => { if (!seen.has(t.key)) { seen.add(t.key); result.targets.push(t); } }));
  return result;
}

// Revision order: numbers by value, letters alphabetically. A number vs a
// letter can't be ordered (0) — then the later upload counts as current.
export function compareRevisions(a, b) {
  const A = norm(a);
  const B = norm(b);
  if (!A || !B || A === B) return 0;
  const na = /^\d+$/.test(A);
  const nb = /^\d+$/.test(B);
  if (na && nb) return Number(A) - Number(B);
  if (!na && !nb) return A.localeCompare(B);
  return 0;
}
