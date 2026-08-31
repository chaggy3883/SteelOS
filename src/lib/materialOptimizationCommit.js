// Promotes a previewed cut plan (materialOptimizer.js's optimizeCutPlan
// output) into: one MaterialOptimizationRun, one StockMaterialUnit per
// physical stock bar, and — when the matching StockLengthOption has a
// preferred vendor configured — a purchase_order_lines row ordering the
// stock. Reuses the exact purchase_orders/purchase_order_lines shape
// Purchasing.jsx's handleSaveNewPo already establishes (an "Open" PO for the
// same vendor+project gets a new line; otherwise a new PO is created) rather
// than inventing a second PO data shape or UI. No rollback on partial
// failure, same posture as this app's other staging->real-entity promotions
// (detailerImportCommit.js, hireCandidate, createProjectFromWonBid) — there
// are no transactions anywhere in this app.
import { db } from '@/api/apiClient';
import { getEffectiveCompanyId } from '@/lib/tenantContext';
import { toPiecesAssigned } from '@/lib/materialOptimizer';
import { propagateHeatNumberToPieces } from '@/lib/heatPropagation';

// Stage 10: remnant bins (src/lib/materialOptimizer.js's packPiecesIntoRemnants)
// into pieces_assigned entries — remnant_inventory_id fills the role
// stock_material_unit_id plays for new stock; position_in_stock is left null
// since there's no StockMaterialUnit numbering to match (see
// MaterialOptimizationRun.pieces_assigned).
const toRemnantPiecesAssigned = (remnantBins) => {
  const assigned = [];
  (remnantBins || []).forEach((bin) => {
    bin.cuts.forEach((cut) => {
      assigned.push({ piece_id: cut.piece_id, position_in_stock: null, cut_order: cut.cut_order, stock_material_unit_id: null, remnant_inventory_id: bin.remnant_id });
    });
  });
  return assigned;
};

async function findOrCreateOpenPurchaseOrder(projectId, vendor) {
  const existing = await db.entities.purchase_orders.filter({ vendor_id: vendor.id, project_id: projectId, status: 'Open' }, '-created_date', 1);
  if (existing.length > 0) return existing[0];

  return db.entities.purchase_orders.create({
    vendor_id: vendor.id,
    vendor_name: vendor.name || '',
    project_id: projectId,
    po_number: `PO-${Date.now().toString().slice(-6)}`,
    description: 'Material Optimization stock buyout',
    total_estimated_cost: 0,
    budgeted_cost: 0,
    approval_status: 'Auto_Approved',
    status: 'Open',
    requires_signature: false,
  });
}

async function createPurchaseOrderLine({ projectId, group, run, vendor, unitCost }) {
  const po = await findOrCreateOpenPurchaseOrder(projectId, vendor);
  const existingLines = await db.entities.purchase_order_lines.filter({ po_id: po.id }, 'line_number', 500);
  const nextLineNumber = existingLines.length > 0 ? Math.max(...existingLines.map((l) => l.line_number || 0)) + 1 : 1;

  const quantity = run.quantity_of_stock_required;
  const cost = Number(unitCost) || 0;
  const description = `${group.material_profile || 'Unknown profile'} ${group.material_grade || ''} — ${run.stock_length_used}" stock (Material Optimization)`.replace(/\s+/g, ' ').trim();

  const line = await db.entities.purchase_order_lines.create({
    po_id: po.id,
    line_number: nextLineNumber,
    description,
    material_category: 'Structural Shapes',
    quantity_ordered: quantity,
    unit_of_measure: 'ea',
    unit_cost: cost,
    line_total: quantity * cost,
    quantity_received: 0,
    quantity_remaining: quantity,
    is_fully_received: false,
    material_optimization_run_id: run.id,
  });

  // Recompute the PO's totals from ALL its lines (it may already carry
  // others) rather than assuming this is the only line — same total-of-lines
  // approach handleSaveNewPo uses when a PO is first created.
  const totalEstimatedCost = [...existingLines, line].reduce((sum, l) => sum + (Number(l.line_total) || 0), 0);
  await db.entities.purchase_orders.update(po.id, { total_estimated_cost: totalEstimatedCost, budgeted_cost: totalEstimatedCost });

  return line;
}

// catalogItem: the steel_catalog row already matched by the caller (or null
// if none) — this function doesn't re-derive the match, it only looks up
// that item's StockLengthOption for the chosen selectedLength. remnantPlan
// (Stage 10, optional): packPiecesIntoRemnants's result for whatever this
// group's own available remnants covered before `plan` was even built —
// plan.totals here already reflects only the new-stock pieces that remained
// after remnant packing (see MaterialOptimizationGroupPanel.jsx), so
// quantity_of_stock_required/waste_in/utilization_pct stay accurate to
// "material actually purchased," not inflated by remnant-covered pieces.
export async function commitMaterialOptimizationRun({ projectId, group, catalogItem, plan, selectedLength, kerf, remnantPlan }) {
  const companyId = getEffectiveCompanyId();
  const remnantEntries = toRemnantPiecesAssigned(remnantPlan?.bins);

  const run = await db.entities.MaterialOptimizationRun.create({
    company_id: companyId,
    project_id: projectId,
    material_group_key: group.group_key,
    material_profile: group.material_profile || '',
    material_grade: group.material_grade || '',
    stock_length_used: selectedLength,
    quantity_of_stock_required: plan.totals.quantity_of_stock_required,
    pieces_assigned: [...remnantEntries, ...toPiecesAssigned(plan.bins)],
    remnant_length_in: plan.totals.remnant_length_in,
    waste_in: plan.totals.waste_in,
    utilization_pct: plan.totals.utilization_pct,
    kerf_allowance_used: kerf,
  });

  // PO generation is skipped (not blocked) when no preferred vendor is
  // configured on the matching StockLengthOption — the run still commits
  // either way; StockMaterialUnit rows just stay 'planned' instead of
  // 'ordered' until a vendor is set up and this is re-run.
  let purchaseOrderLine = null;
  if (catalogItem) {
    const stockOptions = await db.entities.StockLengthOption.filter({ steel_catalog_item_id: catalogItem.id, stock_length_in: selectedLength }, '-created_date', 10);
    const option = stockOptions[0];
    if (option?.vendor_id) {
      const vendor = await db.entities.Vendor.get(option.vendor_id);
      if (vendor) {
        purchaseOrderLine = await createPurchaseOrderLine({ projectId, group, run, vendor, unitCost: option.cost_per_length });
      }
    }
  }

  const units = await db.entities.StockMaterialUnit.bulkCreate(plan.bins.map((bin, index) => ({
    company_id: companyId,
    material_optimization_run_id: run.id,
    unit_number: `Stock #${index + 1}`,
    purchase_order_line_id: purchaseOrderLine?.id || null,
    received_date: null,
    heat_number: null,
    status: purchaseOrderLine ? 'ordered' : 'planned',
    remnant_length_in: Math.max(0, Math.round((bin.stock_length_in - bin.used_in) * 100) / 100),
  })));

  // Queryable both directions: a piece walks pieces_assigned ->
  // stock_material_unit_id; a unit walks material_optimization_run_id back
  // to this run and filters pieces_assigned by its own id. Remnant entries
  // (position_in_stock null) fall through to stock_material_unit_id: null,
  // same as they already were — their link is remnant_inventory_id instead.
  const piecesAssignedWithUnits = run.pieces_assigned.map((entry) => ({
    ...entry,
    stock_material_unit_id: units[entry.position_in_stock - 1]?.id || null,
  }));
  const updatedRun = await db.entities.MaterialOptimizationRun.update(run.id, { pieces_assigned: piecesAssignedWithUnits });

  // Stage 10: mark every consumed remnant and immediately propagate its
  // already-known heat number onto the piece(s) cut from it — unlike a
  // freshly purchased StockMaterialUnit (heat unknown until received), a
  // remnant's heat is already on file from when it was logged.
  if (remnantPlan?.bins?.length) {
    await Promise.all(remnantPlan.bins.map(async (bin) => {
      await db.entities.remnant_inventory.update(bin.remnant_id, {
        status: 'consumed',
        consumed_by_material_optimization_run_id: run.id,
        consumed_date: new Date().toISOString(),
      });
      if (bin.heat_number) {
        const pieceMarkIds = bin.cuts.map((cut) => cut.piece_id);
        await propagateHeatNumberToPieces(pieceMarkIds, bin.heat_number, { source: { label: `remnant ${bin.remnant_id}` } });
      }
    }));
  }

  return { run: updatedRun, units, purchaseOrderLine, remnantsConsumed: remnantPlan?.bins?.length || 0 };
}
