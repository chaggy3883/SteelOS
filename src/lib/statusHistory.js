import { db } from '@/api/apiClient';

// Single write path for every status/workflow_status/field_status change in
// the app — call this alongside the entity's own update()/create() call,
// never in place of it. See StatusHistoryModal for the matching read side.
export async function logStatusChange({ entityType, entityId, fieldName, fromValue = null, toValue, changedBy, note = '' }) {
  if (!entityType || !entityId || !fieldName || !toValue) return null;
  return db.entities.StatusHistoryEntry.create({
    entity_type: entityType,
    entity_id: entityId,
    field_name: fieldName,
    from_value: fromValue,
    to_value: toValue,
    changed_by: changedBy || 'Unknown',
    changed_at: new Date().toISOString(),
    note,
  });
}

// Oldest to newest, matching StatusHistoryModal's expected display order.
export async function getStatusHistory(entityType, entityId, fieldName) {
  if (!entityType || !entityId || !fieldName) return [];
  return db.entities.StatusHistoryEntry.filter(
    { entity_type: entityType, entity_id: entityId, field_name: fieldName },
    'changed_at',
    500
  );
}
