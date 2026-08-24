import { db } from '@/api/apiClient';
import { getEffectiveCompanyId } from '@/lib/tenantContext';

// Maps a session's roles array down to the single role this routing system
// cares about. Priority matters for a multi-role account (e.g. admin also
// holding 'salesman') — salesman wins since that's the role the whole
// RFI/CO/Bulletin routing table keys off of.
const ROLE_PRIORITY = [
  { match: 'salesman', role: 'salesman' },
  { match: 'project_manager', role: 'project_manager' },
  { match: 'inspector', role: 'inspector' },
  { match: 'estimator', role: 'estimator' },
];

export function resolveActorRole(roles) {
  const normalized = (roles || []).map((r) => String(r).toLowerCase());
  const found = ROLE_PRIORITY.find((p) => normalized.includes(p.match));
  return found ? found.role : 'other';
}

// Who gets notified, keyed by who created/changed the record. 'pm' and
// 'estimating' resolve to the project's direct assignee
// (project_manager_id / estimator_id) below; 'qa' and 'shop' broadcast to
// every User holding that role company-wide, since no per-project QA/Shop
// assignment field exists anywhere in this codebase.
const RFI_ROUTES = {
  salesman: ['pm', 'qa', 'shop', 'estimating'],
  project_manager: ['salesman'],
  inspector: ['salesman'],
  estimator: ['salesman'],
  other: ['salesman'],
};

const CHANGE_ORDER_ROUTES = ['pm', 'estimating'];
const BULLETIN_ROUTES = ['pm', 'shop', 'salesman'];

const TARGET_TO_PROJECT_FIELD = { pm: 'project_manager_id', estimating: 'estimator_id', salesman: 'salesman_id' };
const TARGET_TO_BROADCAST_ROLE = { qa: 'inspector', shop: 'shop_manager' };

// Resolves a set of routing targets (pm/estimating/salesman/qa/shop) to
// actual User ids to notify. Never notifies the acting employee themself
// (a target resolving back to excludeEmployeeId is dropped), so creating an
// RFI/CO/bulletin never notifies its own creator.
async function resolveRecipientUserIds(project, targets, excludeEmployeeId) {
  const companyId = getEffectiveCompanyId();
  const directEmployeeIds = targets
    .map((t) => TARGET_TO_PROJECT_FIELD[t] && project?.[TARGET_TO_PROJECT_FIELD[t]])
    .filter((id) => id && id !== excludeEmployeeId);
  const broadcastRoles = targets.map((t) => TARGET_TO_BROADCAST_ROLE[t]).filter(Boolean);

  const allUsers = await db.entities.User.list('-created_date', 2000);
  const companyUsers = companyId ? allUsers.filter((u) => u.company_id === companyId) : allUsers;

  const userIds = new Set();
  companyUsers.forEach((u) => {
    if (u.employee_id === excludeEmployeeId) return;
    if (directEmployeeIds.includes(u.employee_id)) userIds.add(u.id);
    else if ((u.roles || []).some((r) => broadcastRoles.includes(String(r).toLowerCase()))) userIds.add(u.id);
  });
  return [...userIds];
}

async function createNotifications(userIds, { title, message, type, projectId, link, entityType, entityId, creatorId }) {
  if (userIds.length === 0) return [];
  return Promise.all(userIds.map((user_id) => db.entities.Notification.create({
    user_id, title, message, type, project_id: projectId, link, entity_type: entityType, entity_id: entityId, creator_id: creatorId, is_read: false,
  })));
}

// Called right after a new RFI is created (src/pages/RFIs.jsx). actorRole
// comes from resolveActorRole(currentUser.roles); creatorEmployeeId/Name
// identify who created it for the notification text and self-exclusion.
export async function dispatchRfiNotification(rfi, project, actorRole, creatorEmployeeId, creatorName) {
  const targets = RFI_ROUTES[actorRole] || RFI_ROUTES.other;
  const userIds = await resolveRecipientUserIds(project, targets, creatorEmployeeId);
  await createNotifications(userIds, {
    title: `New RFI on ${project?.name || 'a project'}`,
    message: `${creatorName || 'Someone'} created RFI #${rfi.rfi_number || rfi.id}: ${rfi.subject}`,
    type: 'rfi_update',
    projectId: rfi.project_id,
    link: `/rfis?open=${rfi.id}`,
    entityType: 'RFI',
    entityId: rfi.id,
    creatorId: creatorEmployeeId,
  });
  return userIds.length;
}

// Called when a change order flips received_from_customer to true
// (src/pages/ChangeOrders.jsx's Change Order Intake).
export async function dispatchChangeOrderNotification(co, project, creatorEmployeeId, creatorName) {
  const userIds = await resolveRecipientUserIds(project, CHANGE_ORDER_ROUTES, creatorEmployeeId);
  await createNotifications(userIds, {
    title: `New CO on ${project?.name || 'a project'}`,
    message: `${creatorName || 'Someone'} recorded ${co.change_order_id} received from the customer: ${co.description || 'no description'}, revenue impact $${Number(co.cost_impact || 0).toLocaleString()}`,
    type: 'co_update',
    projectId: co.project_id,
    link: `/projects/change-orders?open=${co.id}`,
    entityType: 'ChangeOrder',
    entityId: co.id,
    creatorId: creatorEmployeeId,
  });
  return userIds.length;
}

// Called when a new ProjectBulletin is logged (currently only from the
// Salesman Dashboard's Addenda/Bulletins widget).
export async function dispatchBulletinNotification(bulletin, project, creatorEmployeeId, creatorName) {
  const userIds = await resolveRecipientUserIds(project, BULLETIN_ROUTES, creatorEmployeeId);
  await createNotifications(userIds, {
    title: `New bulletin on ${project?.name || 'a project'}`,
    message: `${creatorName || 'Someone'} logged a ${bulletin.bulletin_type} on ${project?.name || 'a project'}: ${bulletin.summary}`,
    type: 'bulletin_issued',
    projectId: bulletin.project_id,
    link: `/sales/dashboard`,
    entityType: 'ProjectBulletin',
    entityId: bulletin.id,
    creatorId: creatorEmployeeId,
  });
  return userIds.length;
}
