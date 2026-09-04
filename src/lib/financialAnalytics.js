import { db } from '@/api/apiClient';
import { getJoistDeckTaxRate } from '@/lib/taxRate';

const ERECTION_CATEGORIES = ['steel_erection', 'outsourced_misc_material_erection', 'erection_labor_hours', 'crane_rental', 'mobilization', 'field_rigging'];

// Shared with bidProposalPdf.js so the structural-vs-Joist & Deck tax
// split is computed identically everywhere it's shown, instead of drifting
// across separate copies of the same math. Reads bid.tax_rate directly
// (the value already snapshotted at calculation time by TakeoffEngine.jsx's
// handleSave / BidDetail.jsx's Base Info save) rather than recomputing via
// computeEffectiveTaxRate — recomputing here would defeat the whole point of
// snapshotting: a later jurisdiction rate change in Admin would silently
// change the tax shown on an already-calculated bid's proposal/analytics
// every time this function ran, instead of only on its next real recalculation.
export function computeBidTaxBreakdown(bid, lines) {
  const taxRate = Number(bid?.tax_rate || 0);
  const joistDeckTaxRate = getJoistDeckTaxRate(bid, taxRate);
  const structuralTaxAmount = bid?.tax_exempt ? 0 : lines.reduce((s, l) => {
    if (ERECTION_CATEGORIES.includes(l.cost_category) || l.cost_category === 'joist_deck') return s;
    return s + (l.total_cost || 0) * taxRate;
  }, 0);
  const joistDeckTaxAmount = bid?.tax_exempt ? 0 : lines
    .filter((l) => l.cost_category === 'joist_deck')
    .reduce((s, l) => s + (l.total_cost || 0), 0) * joistDeckTaxRate;
  return { taxRate, joistDeckTaxRate, structuralTaxAmount, joistDeckTaxAmount };
}

// Groups every bid's tax exposure into calendar quarters (by bid_due_date,
// falling back to created_date) — this fetches each bid's TakeoffLine rows,
// so it's only practical at this app's demo data volumes, not a paginated
// production query.
export async function computeQuarterlyTaxExposure(bids) {
  const rows = await Promise.all(bids.map(async (bid) => {
    const lines = await db.entities.TakeoffLine.filter({ bid_id: bid.id }, '-created_date', 200);
    const { structuralTaxAmount, joistDeckTaxAmount } = computeBidTaxBreakdown(bid, lines);
    const anchorDate = bid.bid_due_date || bid.created_date;
    const d = new Date(anchorDate);
    const quarter = Number.isNaN(d.getTime()) ? 'Unknown' : `${d.getFullYear()} Q${Math.floor(d.getMonth() / 3) + 1}`;
    return { quarter, structuralTaxAmount, joistDeckTaxAmount };
  }));

  const byQuarter = {};
  rows.forEach(({ quarter, structuralTaxAmount, joistDeckTaxAmount }) => {
    if (!byQuarter[quarter]) byQuarter[quarter] = { quarter, hancockCountyTax: 0, joistDeckTax: 0 };
    byQuarter[quarter].hancockCountyTax += structuralTaxAmount;
    byQuarter[quarter].joistDeckTax += joistDeckTaxAmount;
  });

  return Object.values(byQuarter).sort((a, b) => a.quarter.localeCompare(b.quarter));
}

const ACTIVE_STATUSES = ['draft', 'in_progress', 'submitted'];

// Won/Lost/Did-Not-Bid are parallel, mutually-exclusive terminal outcomes,
// not sequential funnel stages — so this returns plain counts + a win rate,
// meant to be rendered as a categorical bar comparison, not a funnel chart.
export function computeWinLossStats(bids) {
  const won = bids.filter((b) => b.status === 'won').length;
  const lost = bids.filter((b) => b.status === 'lost').length;
  const dnb = bids.filter((b) => b.status === 'Did_Not_Bid').length;
  const active = bids.filter((b) => ACTIVE_STATUSES.includes(b.status)).length;
  const decided = won + lost;
  const winRatePct = decided > 0 ? Math.round((won / decided) * 100) : null;

  const reasonCounts = (field) => {
    const counts = {};
    bids.forEach((b) => {
      const reason = b[field];
      if (!reason) return;
      counts[reason] = (counts[reason] || 0) + 1;
    });
    return Object.entries(counts).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
  };

  return {
    won, lost, dnb, active, winRatePct,
    topLossReasons: reasonCounts('loss_reason'),
    topDnbReasons: reasonCounts('dnb_reason'),
  };
}

// "Actual JTD cost recognized" comes from JobCostLedgerEntry (real incurred
// cost), not Project.total_invoiced_to_date (that's billed revenue, a
// different number) — contract value is the comparison baseline.
export function computeProjectWipRadar(projects, ledgerEntries) {
  return projects.map((project) => {
    const jtdCost = ledgerEntries
      .filter((entry) => entry.project_id === project.id)
      .reduce((sum, entry) => sum + (entry.amount || 0), 0);
    return {
      projectId: project.id,
      projectName: project.name,
      contractValue: project.contract_value || 0,
      jtdCost,
    };
  });
}
