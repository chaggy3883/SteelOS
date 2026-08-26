import { db } from '@/api/apiClient';

// Single source of truth for rolling a project's Approved change orders up
// into its contract-value fields. Used by both ProjectManagement.jsx's
// per-project CO tab and the cross-project Change Order Hub
// (src/pages/ChangeOrders.jsx) — they must never compute this independently,
// or the two views could show different revised contract values for the
// same project depending on which one wrote last.
export async function syncProjectChangeOrderMetrics(project, changeOrders) {
  const approvedTotal = (changeOrders || [])
    .filter((item) => item.status === 'Approved')
    .reduce((sum, item) => sum + Number(item.cost_impact || 0), 0);
  const revisedValue = Number(project?.original_contract_value || 0) + approvedTotal;
  const remainingBalance = revisedValue - Number(project?.total_invoiced_to_date || 0);

  return db.entities.Project.update(project.id, {
    approved_change_orders_total: approvedTotal,
    current_revised_contract_value: revisedValue,
    remaining_project_balance: remainingBalance,
    execution_status: project?.execution_status || 'Prefabrication',
  });
}
