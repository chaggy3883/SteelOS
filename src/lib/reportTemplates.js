import { base44 } from '@/api/base44Client';

export function incrementVersion(versionString) {
  const [majorRaw, minorRaw] = String(versionString || '1.0').split('.');
  const major = parseInt(majorRaw, 10) || 1;
  const minor = parseInt(minorRaw, 10) || 0;
  return `${major}.${minor + 1}`;
}

// Fails OPEN when no active template exists for a doc type — every column
// shows by default rather than a missing config row silently blanking a
// proposal out.
export async function getActiveTemplate(documentTypeKey) {
  const rows = await base44.entities.report_templates.filter({ document_type_key: documentTypeKey, is_active: true }, '-created_date', 1);
  return rows[0] || null;
}

export function isColumnVisible(template, flagKey, defaultVisible = true) {
  if (!template?.column_visibility_flags_json) return defaultVisible;
  const value = template.column_visibility_flags_json[flagKey];
  return value === undefined ? defaultVisible : !!value;
}

// The Revision Engine: saving a template edit doesn't overwrite the old row —
// it deactivates it and creates a new one with the version bumped, so
// history stays browsable rather than silently lost.
export async function saveNewTemplateVersion(previousTemplate, updates) {
  if (previousTemplate?.id) {
    await base44.entities.report_templates.update(previousTemplate.id, { is_active: false });
  }
  return base44.entities.report_templates.create({
    document_type_key: previousTemplate?.document_type_key || updates.document_type_key,
    version_string: incrementVersion(previousTemplate?.version_string),
    header_footer_config_json: updates.header_footer_config_json || previousTemplate?.header_footer_config_json || {},
    column_visibility_flags_json: updates.column_visibility_flags_json || previousTemplate?.column_visibility_flags_json || {},
    is_active: true,
  });
}
