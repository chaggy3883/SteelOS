// Every write the takeoffs and the Material Catalog admin page make to the
// material catalogs goes through here, so each one is role-checked before
// it's attempted (localData.js checks again at the write itself — see
// materialCatalogRoles.js checkCatalogWrite) and stamped with who/when.
// AuditLog rows are written automatically by localData.js for every
// create/update/delete on these entities.
import { db } from '@/api/apiClient';
import { getAuthState } from '@/api/localData';
import { catalogPermissions, hasStoredWeight } from '@/lib/materialCatalogRoles';
import { entryFamily, profileKey } from '@/lib/materialEntryMath';
import {
  findDuplicateSize, findDuplicateDesignation, mirrorForMasterSize, mirrorForDesignation, sizeKey,
  WEIGHT_FIELD_BY_FAMILY, linesUsingSize, linesUsingGrade,
} from '@/lib/catalogSizeRules';

const session = () => {
  const auth = getAuthState();
  return { user: auth?.user || null, impersonating: Boolean(auth?.impersonating_company_id) };
};

export const currentActor = () => {
  const { user } = session();
  return user?.email || user?.full_name || 'unknown';
};

const permissions = () => {
  const { user, impersonating } = session();
  return catalogPermissions(user?.roles || [], { impersonating, isAdminFlag: user?.is_admin === true });
};

const COMPANY_NOTICE = 'Pick a company to work as (Impersonate) before changing the material catalog.';

function requireAdd() {
  const p = permissions();
  if (!p.canAdd) throw new Error(p.needsCompany ? COMPANY_NOTICE : 'Only estimators, admins and super admins can add catalog sizes.');
}
function requireEdit() {
  const p = permissions();
  if (!p.canEdit) throw new Error(p.needsCompany ? COMPANY_NOTICE : 'Only an Admin or Super Admin can change the material catalog.');
}

// One write at a time per size, so two rows saving a weight for the same
// unknown size can't both see "no weight yet": the second waits for the
// first, re-reads the record, and finds the first one's weight.
const queues = new Map();
function serialized(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(key, next);
  const cleanup = () => { if (queues.get(key) === next) queues.delete(key); };
  next.then(cleanup, cleanup);
  return next;
}

const weightStamp = (source) => ({ weight_source: source, weight_set_by: currentActor(), weight_set_date: new Date().toISOString() });
const itemIdFor = (shapeClass, designation) => `STL-${String(shapeClass).replace(/\s+/g, '').toUpperCase()}-${String(designation).replace(/[^A-Z0-9]/gi, '').toUpperCase()}`;

// --------------------------------------------------------------- adding sizes

async function createMirrorSteelRow(shapeCode, sizeValue, from) {
  const mirror = mirrorForMasterSize(shapeCode, sizeValue);
  if (!mirror) return null;
  const rows = await db.entities.steel_catalog.filter({ shape_class: mirror.shape_class }, 'size_designation', 10000);
  const dup = findDuplicateDesignation(mirror.size_designation, rows.map((r) => r.size_designation));
  if (dup) return { existing: rows.find((r) => r.size_designation === dup) };
  const created = await db.entities.steel_catalog.create({
    item_id: itemIdFor(mirror.shape_class, mirror.size_designation),
    ...mirror,
    is_custom: true,
    created_by: currentActor(),
    created_from: from,
  });
  return { created };
}

async function createMirrorMasterSize(shapeClass, designation, from) {
  const mirror = mirrorForDesignation(shapeClass, designation);
  if (!mirror) return null;
  const [shapeType] = await db.entities.MaterialShapeType.filter({ shape_code: mirror.shapeCode }, 'shape_code', 1);
  if (!shapeType) return null;
  const sizes = await db.entities.MaterialSizeOption.filter({ shape_type_id: shapeType.id }, 'sort_order', 10000);
  const dup = findDuplicateSize(mirror.shapeCode, mirror.sizeValue, sizes.map((s) => s.size_value));
  if (dup) return { existing: sizes.find((s) => s.size_value === dup), shapeType };
  const created = await db.entities.MaterialSizeOption.create({
    shape_type_id: shapeType.id,
    size_value: mirror.sizeValue,
    sort_order: sizes.length ? Math.max(...sizes.map((s) => s.sort_order || 0)) + 1 : 0,
    is_active: true,
    created_by: currentActor(),
    created_from: from,
  });
  return { created, shapeType };
}

// Adds a size under a master-catalog shape. `weight` (optional) is in the
// shape's family unit (lb/ft, lb/sq ft, lb/ea) and is saved as the size's
// own weight. Returns { duplicate } when the shape already has the size
// (any spelling), else { record, mirror } — mirror is the steel_catalog row
// made for a standard AISC W / HSS / C / L size (or the one already there).
export async function addMasterSize({ shapeType, sizeValue, weight = null, from = 'takeoff' }) {
  requireAdd();
  const value = String(sizeValue || '').trim();
  if (!value) throw new Error('Type a size first.');
  if (!shapeType?.id) throw new Error('Pick a material first.');
  const sizes = await db.entities.MaterialSizeOption.filter({ shape_type_id: shapeType.id }, 'sort_order', 10000);
  const dup = findDuplicateSize(shapeType.shape_code, value, sizes.map((s) => s.size_value));
  if (dup) return { duplicate: sizes.find((s) => s.size_value === dup) };
  const family = entryFamily(shapeType.shape_code, shapeType.category);
  const w = Number(weight);
  const record = await db.entities.MaterialSizeOption.create({
    shape_type_id: shapeType.id,
    size_value: value,
    sort_order: sizes.length ? Math.max(...sizes.map((s) => s.sort_order || 0)) + 1 : 0,
    is_active: true,
    created_by: currentActor(),
    created_from: from,
    ...(w > 0 ? { [WEIGHT_FIELD_BY_FAMILY[family]]: w, ...weightStamp(from === 'admin' ? 'admin' : 'typed') } : {}),
  });
  let mirror = null;
  try { mirror = await createMirrorSteelRow(shapeType.shape_code, value, from); } catch (e) { mirror = { error: e?.message || String(e) }; }
  return { record, mirror };
}

// Adds a steel_catalog size (IRONSIGHT's 5-class picker). `dims` may carry
// dimension1 / dimension2 / wall_thickness_in. Returns { duplicate } or
// { record, mirror } (mirror = the master-catalog size for a standard AISC
// shape that maps).
export async function addSteelSize({ shapeClass, designation, weightPerFt = null, dims = {}, from = 'ironsight' }) {
  requireAdd();
  const value = String(designation || '').trim();
  if (!value) throw new Error('Type a size first.');
  const rows = await db.entities.steel_catalog.filter({ shape_class: shapeClass }, 'size_designation', 10000);
  const dup = findDuplicateDesignation(value, rows.map((r) => r.size_designation));
  if (dup) return { duplicate: rows.find((r) => r.size_designation === dup) };
  const w = Number(weightPerFt);
  const cleanDims = Object.fromEntries(Object.entries(dims || {}).filter(([, v]) => v != null && v !== '' && Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)]));
  const record = await db.entities.steel_catalog.create({
    item_id: itemIdFor(shapeClass, value),
    shape_class: shapeClass,
    size_designation: value,
    is_custom: true,
    created_by: currentActor(),
    created_from: from,
    ...cleanDims,
    ...(w > 0 ? { weight_per_ft: w, ...weightStamp(from === 'admin' ? 'admin' : 'typed') } : {}),
  });
  let mirror = null;
  try { mirror = await createMirrorMasterSize(shapeClass, value, from); } catch (e) { mirror = { error: e?.message || String(e) }; }
  return { record, mirror };
}

// --------------------------------------------------------------- typed weights

// First save of a weight typed on a takeoff for a "Weight needed" size.
// First save wins: if the size already has a weight by the time this runs
// (another row, another tab), nothing is written and { saved: false,
// existing } comes back — the caller keeps its value as a row override.
export function saveTypedSizeWeight({ sizeOptionId, family, value }) {
  return serialized(`MaterialSizeOption:${sizeOptionId}`, async () => {
    requireAdd();
    const field = WEIGHT_FIELD_BY_FAMILY[family];
    const v = Number(value);
    if (!field || !(v > 0)) throw new Error('Type a weight greater than 0.');
    const fresh = await db.entities.MaterialSizeOption.get(sizeOptionId);
    if (!fresh) throw new Error('That size is no longer in the catalog.');
    if (hasStoredWeight(fresh)) return { saved: false, existing: fresh };
    const record = await db.entities.MaterialSizeOption.update(sizeOptionId, { [field]: v, ...weightStamp('typed') });
    return { saved: true, record };
  });
}

// Same for an IRONSIGHT 5-class size: writes steel_catalog.weight_per_ft on
// the size's row (creating the row, is_custom, when the size only came from
// the Steel sizes workbook).
export function saveTypedSteelWeight({ shapeClass, designation, value }) {
  return serialized(`steel_catalog:${shapeClass}:${profileKey(designation)}`, async () => {
    requireAdd();
    const v = Number(value);
    if (!(v > 0)) throw new Error('Type a weight greater than 0.');
    const rows = await db.entities.steel_catalog.filter({ shape_class: shapeClass }, 'size_designation', 10000);
    const key = profileKey(designation);
    const row = rows.find((r) => profileKey(r.size_designation) === key);
    if (row && hasStoredWeight(row)) return { saved: false, existing: row };
    if (row) {
      const record = await db.entities.steel_catalog.update(row.id, { weight_per_ft: v, ...weightStamp('typed') });
      return { saved: true, record };
    }
    const record = await db.entities.steel_catalog.create({
      item_id: itemIdFor(shapeClass, designation),
      shape_class: shapeClass,
      size_designation: String(designation).trim(),
      is_custom: true,
      created_by: currentActor(),
      created_from: 'ironsight',
      weight_per_ft: v,
      ...weightStamp('typed'),
    });
    return { saved: true, record };
  });
}

// --------------------------------------------------------------- admin edits

export async function createCatalogRecord(entityName, data) {
  requireEdit();
  return db.entities[entityName].create({ ...data, created_by: data.created_by || currentActor(), created_from: data.created_from || 'admin' });
}

export async function createCatalogRecords(entityName, items) {
  requireEdit();
  return db.entities[entityName].bulkCreate(items.map((d) => ({ ...d, created_by: d.created_by || currentActor(), created_from: d.created_from || 'admin' })));
}

export async function updateCatalogRecord(entityName, id, patch) {
  requireEdit();
  return db.entities[entityName].update(id, patch);
}

export async function deleteCatalogRecord(entityName, id) {
  requireEdit();
  return db.entities[entityName].delete(id);
}

// An admin setting (or clearing, value '' / 0) a size's stored weight for
// its family — stamped weight_source 'admin' with who/when.
export async function setAdminSizeWeight(sizeOption, family, value) {
  requireEdit();
  const field = WEIGHT_FIELD_BY_FAMILY[family];
  const v = Number(value);
  const patch = v > 0
    ? { [field]: v, ...weightStamp('admin') }
    : { [field]: null, weight_source: null, weight_set_by: currentActor(), weight_set_date: new Date().toISOString() };
  return db.entities.MaterialSizeOption.update(sizeOption.id, patch);
}

export async function setAdminSteelWeight(row, value) {
  requireEdit();
  const v = Number(value);
  const patch = v > 0
    ? { weight_per_ft: v, ...weightStamp('admin') }
    : { weight_per_ft: null, weight_source: null, weight_set_by: currentActor(), weight_set_date: new Date().toISOString() };
  return db.entities.steel_catalog.update(row.id, patch);
}

// --------------------------------------------------------------- delete guard

async function loadUsageSources() {
  const [lines, sessions] = await Promise.all([
    db.entities.MaterialTakeoffLine.list('-created_date', 100000),
    db.entities.blueprint_takeoffs.list('-created_date', 10000),
  ]);
  return { lines, sessions };
}

// Takeoff lines (Full Takeoff / pushed MaterialTakeoffLine rows) and
// IRONSIGHT session rows that use this master size. A size in use can only
// be deactivated, never deleted.
export async function sizeUsage(shapeType, sizeValue) {
  const { lines, sessions } = await loadUsageSources();
  const code = String(shapeType?.shape_code || '').toUpperCase();
  const key = sizeKey(code, sizeValue);
  const usingLines = linesUsingSize(lines, code, sizeValue);
  const usingSessions = sessions.filter((s) => (s.accepted_items || []).some((r) => String(r.shape_code || '').toUpperCase() === code && sizeKey(code, r.size_designation) === key));
  return { lines: usingLines, sessions: usingSessions, count: usingLines.length + usingSessions.length };
}

export async function gradeUsage(shapeType, gradeValue) {
  const { lines, sessions } = await loadUsageSources();
  const code = String(shapeType?.shape_code || '').toUpperCase();
  const g = String(gradeValue || '').trim().toUpperCase();
  const usingLines = linesUsingGrade(lines, code, gradeValue);
  const usingSessions = sessions.filter((s) => (s.accepted_items || []).some((r) => String(r.shape_code || '').toUpperCase() === code && String(r.grade || '').trim().toUpperCase() === g));
  return { lines: usingLines, sessions: usingSessions, count: usingLines.length + usingSessions.length };
}
