// Guards against the exact bug fixed on 2026-09-11: TENANT_SCOPED_ENTITIES
// (src/api/localData.js) is a hand-maintained array, and 63 entities had
// silently drifted out of sync with it — each one declared a `company_id`
// property in its schema/entities/*.jsonc file (meaning it holds one
// company's data) but received zero tenant filtering because nobody
// remembered to also add its name to the array when the field was added.
//
// This script re-derives "which registered entities should be tenant-scoped"
// straight from the schema docs and the entity registry, and fails loudly
// (non-zero exit, printed list) if TENANT_SCOPED_ENTITIES is missing any of
// them. It is wired in as `prebuild` (see package.json) so `npm run build`
// cannot succeed while this list is out of date.
//
// Deliberately NOT a runtime check: schema/entities/*.jsonc files are
// documentation only, never read by the running app (see AGENTS.md) — adding
// a jsonc-parsing step to the browser bundle just to re-derive one boolean
// per entity would be a meaningful architecture change for no real benefit
// over catching the same drift at build time, before it ever ships.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const schemaDir = path.join(rootDir, 'schema', 'entities');
const entitiesWithCompanyId = new Set();
for (const file of readdirSync(schemaDir)) {
  if (!file.endsWith('.jsonc')) continue;
  const text = readFileSync(path.join(schemaDir, file), 'utf-8');
  if (text.includes('"company_id"')) {
    entitiesWithCompanyId.add(file.replace(/\.jsonc$/, ''));
  }
}

const apiClientText = readFileSync(path.join(rootDir, 'src', 'api', 'apiClient.js'), 'utf-8');
const registeredEntities = new Set(
  [...apiClientText.matchAll(/createEntityApi\('([^']+)'\)/g)].map((m) => m[1])
);

const localDataText = readFileSync(path.join(rootDir, 'src', 'api', 'localData.js'), 'utf-8');
const arrayMatch = localDataText.match(/const TENANT_SCOPED_ENTITIES = \[([\s\S]*?)\];/);
if (!arrayMatch) {
  console.error('check-tenant-scoping: could not find TENANT_SCOPED_ENTITIES in src/api/localData.js — has it been renamed?');
  process.exit(1);
}
const scopedEntities = new Set([...arrayMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));

const missing = [...entitiesWithCompanyId]
  .filter((name) => registeredEntities.has(name) && !scopedEntities.has(name))
  .sort();

if (missing.length > 0) {
  console.error('');
  console.error('check-tenant-scoping: TENANT_SCOPED_ENTITIES is out of date.');
  console.error('');
  console.error(`  ${missing.length} entit${missing.length === 1 ? 'y declares' : 'ies declare'} company_id in its schema/entities/*.jsonc file,`);
  console.error('  is registered in src/api/apiClient.js, but is MISSING from TENANT_SCOPED_ENTITIES');
  console.error('  in src/api/localData.js — meaning it currently receives ZERO tenant filtering:');
  console.error('');
  for (const name of missing) console.error(`    - ${name}`);
  console.error('');
  console.error('  Add each name to TENANT_SCOPED_ENTITIES, or if this entity is deliberately');
  console.error('  global/shared across all tenants, remove its company_id property from');
  console.error(`  schema/entities/${missing[0]}.jsonc instead and document why.`);
  console.error('');
  process.exit(1);
}

console.log(`check-tenant-scoping: OK — ${scopedEntities.size} entities scoped, all ${entitiesWithCompanyId.size} company_id-bearing registered entities accounted for.`);
