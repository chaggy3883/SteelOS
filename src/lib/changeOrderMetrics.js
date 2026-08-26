import { db } from '@/api/apiClient';
import { logStatusChange } from '@/lib/statusHistory';

// Single source of truth for rolling a project's Approved change orders up
// into its contract-value fields. Used by both ProjectManagement.jsx's
// per-project CO tab and the cross-project Change Order Hub
// (src/pages/ChangeOrders.jsx) — they must never compute this independently,
// or the two views could show different revised contract values for the
// same project depending on which one wrote last.
//
// approvedTotal is always recomputed from scratch (not incrementally
// added/subtracted), so calling this again after a previously-Approved CO
// is Rejected/Voided naturally reverses the earlier bump — no separate
// "undo" path needed, as long as this runs after every change_orders
// create/update, which is why every write site below passes through it.
export async function syncProjectChangeOrderMetrics(project, changeOrders, options = {}) {
  const { changedBy = 'System', triggeringChangeOrder = null } = options;

  const approvedTotal = (changeOrders || [])
    .filter((item) => item.status === 'Approved')
    .reduce((sum, item) => sum + Number(item.cost_impact || 0), 0);
  const originalContract = Number(project?.original_contract || 0);
  const revisedValue = originalContract + approvedTotal;
  const remainingBalance = revisedValue - Number(project?.total_invoiced_to_date || 0);
  const previousContractValue = Number(project?.contract_value ?? (originalContract + Number(project?.change_orders_to_date || 0)));

  const updatedProject = await db.entities.Project.update(project.id, {
    change_orders_to_date: approvedTotal,
    contract_value: revisedValue,
    remaining_project_balance: remainingBalance,
    execution_status: project?.execution_status || 'Prefabrication',
  });

  if (revisedValue !== previousContractValue) {
    const coLabel = triggeringChangeOrder?.change_order_id || triggeringChangeOrder?.id;
    const direction = revisedValue > previousContractValue ? 'increased' : 'decreased';
    await logStatusChange({
      entityType: 'Project',
      entityId: project.id,
      fieldName: 'contract_value',
      fromValue: String(previousContractValue),
      toValue: String(revisedValue),
      changedBy,
      note: coLabel
        ? `${coLabel} (${triggeringChangeOrder.status}, $${Number(triggeringChangeOrder.cost_impact || 0).toLocaleString()}) — contract value ${direction} from $${previousContractValue.toLocaleString()} to $${revisedValue.toLocaleString()}.`
        : `Contract value ${direction} from $${previousContractValue.toLocaleString()} to $${revisedValue.toLocaleString()}.`,
    });
  }

  return updatedProject;
}
