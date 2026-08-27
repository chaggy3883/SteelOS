// The one display-label map for pieces.workflow_status. The stored enum
// values (In_Fabrication, Received, Inspector_Queue, Weld_Unlocked,
// Paint_Unlocked, Rejected) stay as-is — too much filtering/gating logic
// (LoadBuilder, ShopFabrication's QA gateway, enforcePaintStationLock)
// depends on the raw values — this only controls what the user reads. Every
// screen that shows workflow_status as text must go through this instead of
// hardcoding its own humanized copy.
export const WORKFLOW_STATUS_LABELS = {
  In_Fabrication: 'In Fabrication',
  Received: 'Received',
  Inspector_Queue: 'Awaiting Inspection',
  Weld_Unlocked: 'Ready for Welding',
  Paint_Unlocked: 'Ready for Paint',
  Rejected: 'Failed — Awaiting Rework',
};

export function workflowStatusLabel(status) {
  if (!status) return status;
  return WORKFLOW_STATUS_LABELS[status] || String(status).replace(/_/g, ' ');
}
