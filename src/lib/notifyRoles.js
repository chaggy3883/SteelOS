import { db } from '@/api/apiClient';
import { getEffectiveCompanyId } from '@/lib/tenantContext';

// Broadcasts a Notification to every User holding one of the given roles,
// company-scoped. TopBar.jsx's bell only shows notifications with a real
// user_id (it filters Notification.list by { user_id: currentUser.id }), so
// this creates one row per recipient rather than a single unaddressed row —
// same pattern as achEngine.js's notifyArUnmatchedAch and
// salesNotifications.js's createNotifications.
export async function notifyUsersByRole(roles, { title, message, type = 'info', link, entityType, entityId }) {
  const companyId = getEffectiveCompanyId();
  const allUsers = await db.entities.User.list('-created_date', 2000);
  const companyUsers = companyId ? allUsers.filter((u) => u.company_id === companyId) : allUsers;
  const recipients = companyUsers.filter((u) => (u.roles || []).some((r) => roles.includes(String(r).toLowerCase())));

  return Promise.all(recipients.map((u) => db.entities.Notification.create({
    user_id: u.id,
    title,
    message,
    type,
    link,
    entity_type: entityType,
    entity_id: entityId,
    is_read: false,
  })));
}
