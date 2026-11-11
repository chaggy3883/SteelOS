// A project's Files: a folder tree (ProjectFolder records) holding the
// project's documents (Document records, folder_id). Every project starts
// with the company's standard job folders below; anyone working the job can
// add folders (and folders inside folders) as needed. Each file is stored
// once — in the folder it was put in — and found from the Files tab, the
// folder dropdown, and global search.

import { db } from '@/api/apiClient';

// The standard job folders, in order, with the document type a file
// dropped there is given (used by search / older document screens).
export const BASE_PROJECT_FOLDERS = [
  { name: 'Billings', document_type: 'accounting' },
  { name: 'Certified Payroll', document_type: 'accounting' },
  { name: 'Change Orders - Customer', document_type: 'other' },
  { name: 'Change Orders - Sub-Suppliers', document_type: 'other' },
  { name: 'Close Out (O&M)', document_type: 'close_out' },
  { name: 'Contract Documents', document_type: 'contract' },
  { name: 'Contract Review Record (AISC)', document_type: 'contract_review_aisc' },
  { name: 'Drawings for Fabrication', document_type: 'structural_drawing' },
  { name: 'LEED', document_type: 'leed' },
  { name: 'Lien Waivers - Sub & Supplier', document_type: 'legal_general' },
  { name: 'Notice of Commencement; Notice of Furnishings', document_type: 'notice_of_commencement' },
  { name: 'Plans & Specifications', document_type: 'specification' },
  { name: 'Purchase Orders', document_type: 'other' },
  { name: 'Request for Change', document_type: 'request_for_change' },
  { name: 'RFI', document_type: 'rfi' },
  { name: 'Sales Tax Exemption', document_type: 'legal_general' },
  { name: 'Subcontracts (Erector & Sub-Fabricator)', document_type: 'contract' },
  { name: 'Submittals', document_type: 'submittal' },
];

const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|heic|heif|tiff?|svg)$/i;
export const isImageName = (name) => IMAGE_RE.test(String(name || ''));

// Document type for a file put in a folder: pictures are photos; otherwise
// the type of the base folder it sits in (any depth), else "other".
export function documentTypeFor(fileName, folder, foldersById) {
  if (isImageName(fileName)) return 'photo';
  let f = folder;
  for (let i = 0; f && i < 20; i += 1) {
    const base = BASE_PROJECT_FOLDERS.find((b) => b.name === f.name && f.is_base);
    if (base) return base.document_type;
    f = f.parent_id ? foldersById.get(f.parent_id) : null;
  }
  return 'other';
}

// Ordered tree: [{ folder, depth, children }] — base folders first in their
// standard order, added folders after them alphabetically.
export function folderTree(folders) {
  const byParent = new Map();
  folders.forEach((f) => {
    const k = f.parent_id || '';
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(f);
  });
  const order = (a, b) => {
    const ai = a.is_base ? BASE_PROJECT_FOLDERS.findIndex((x) => x.name === a.name) : -1;
    const bi = b.is_base ? BASE_PROJECT_FOLDERS.findIndex((x) => x.name === b.name) : -1;
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return String(a.name).localeCompare(String(b.name), undefined, { numeric: true });
  };
  const build = (parentId, depth, seen) => (byParent.get(parentId) || [])
    .filter((f) => !seen.has(f.id))
    .sort(order)
    .map((f) => {
      const next = new Set(seen).add(f.id);
      return { folder: f, depth, children: build(f.id, depth + 1, next) };
    });
  return build('', 0, new Set());
}

export const flattenTree = (tree) => tree.flatMap((n) => [n, ...flattenTree(n.children)]);

// "Drawings for Fabrication / Seq 1" for a folder.
export function folderPath(folder, foldersById) {
  const parts = [];
  let f = folder;
  for (let i = 0; f && i < 20; i += 1) {
    parts.unshift(f.name);
    f = f.parent_id ? foldersById.get(f.parent_id) : null;
  }
  return parts.join(' / ');
}

// Make sure a project has the standard folders (any that are missing are
// added — e.g. a project made before Files existed). One check at a time per
// project, so two quick opens don't create them twice.
const ensuring = new Map();
export function ensureBaseFolders(projectId) {
  if (!projectId) return Promise.resolve([]);
  if (ensuring.has(projectId)) return ensuring.get(projectId);
  const run = (async () => {
    const existing = await db.entities.ProjectFolder.filter({ project_id: projectId }, 'name', 10000);
    const haveBase = new Set(existing.filter((f) => !f.parent_id).map((f) => f.name));
    const missing = BASE_PROJECT_FOLDERS.filter((b) => !haveBase.has(b.name));
    if (!missing.length) return existing;
    const made = await db.entities.ProjectFolder.bulkCreate(
      missing.map((b) => ({ project_id: projectId, name: b.name, parent_id: null, is_base: true })),
      { auditSummary: 'standard project folders' },
    );
    return [...existing, ...made];
  })().finally(() => ensuring.delete(projectId));
  ensuring.set(projectId, run);
  return run;
}

// A folder name that's usable and not already taken next to it.
export function checkFolderName(name, parentId, folders, exceptId = null) {
  const clean = String(name || '').trim().replace(/[\\/]+/g, '-');
  if (!clean) return { ok: false, message: 'Type a folder name.' };
  if (clean.length > 120) return { ok: false, message: 'That name is too long.' };
  const clash = folders.some((f) => f.id !== exceptId && (f.parent_id || null) === (parentId || null) && f.name.toLowerCase() === clean.toLowerCase());
  if (clash) return { ok: false, message: 'There is already a folder with that name here.' };
  return { ok: true, name: clean };
}
