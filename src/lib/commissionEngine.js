import { db } from '@/api/apiClient';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const todayISO = () => new Date().toISOString().slice(0, 10);

// Sums every JobCostLedgerEntry posted against a project — the actual-cost
// input calculateProjectCommission needs for the 'profit_percent' method.
// Same source of truth ProjectJobCostSummary rolls up from.
export async function getActualCostForProject(projectId) {
  const entries = await db.entities.JobCostLedgerEntry.filter({ project_id: projectId }, '-created_date', 5000);
  return entries.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
}

// Resolves the salesman-specific rate override in effect on asOfDate, or
// null if none applies (caller then falls back to
// SalesCommissionConfig.default_commission_rate / flat_rate_amount).
// Percent for 'profit_percent'/'bid_amount_percent'; a flat dollar override
// for 'flat_rate'. Returns null outright when per_salesman_override is off.
export function resolveSalesmanCommissionRate(salesmanRates, salesmanId, config, asOfDate = todayISO()) {
  if (!config?.per_salesman_override) return null;
  const candidates = (salesmanRates || [])
    .filter((r) => r.salesman_id === salesmanId && r.effective_date <= asOfDate && (!r.end_date || r.end_date > asOfDate))
    .sort((a, b) => b.effective_date.localeCompare(a.effective_date));
  const match = candidates[0];
  return match && match.rate != null ? Number(match.rate) : null;
}

// Pure calculation, scoped to company via the caller's already-scoped
// project/config — no db access here so this can be traced by hand.
// costData = { actualCost, effectiveRate } — effectiveRate is the result of
// resolveSalesmanCommissionRate (or null to use the config's own default).
//
// Trace by hand: bid $100k, actual cost $60k, method='profit_percent',
// rate=5% -> (100000 - 60000) * 5 / 100 = $2,000.
export function calculateProjectCommission(project, salesmanId, config, costData = {}) {
  if (!config || config.commission_enabled === false) return 0;
  const contractValue = Number(project?.contract_value) || 0;
  const method = config.commission_calc_method || 'profit_percent';
  const { effectiveRate, actualCost } = costData;

  if (method === 'flat_rate') {
    const amount = effectiveRate != null ? Number(effectiveRate) : Number(config.flat_rate_amount) || 0;
    return round2(amount);
  }

  const rate = effectiveRate != null ? Number(effectiveRate) : Number(config.default_commission_rate) || 0;
  if (method === 'bid_amount_percent') {
    return round2(contractValue * rate / 100);
  }

  // profit_percent (default)
  return round2((contractValue - (Number(actualCost) || 0)) * rate / 100);
}

async function getCompanyCommissionConfig() {
  const configs = await db.entities.SalesCommissionConfig.list('-created_date', 1);
  return configs[0] || null;
}

// Finds the next PayPeriod pay date on/after afterDate — the "next payroll
// cycle" a freshly-triggered commission payment queues for. Returns null if
// no upcoming period exists yet (payroll admin hasn't created one) — the
// payment then just waits with a blank payroll_cycle_date until one does.
export async function nextPayrollDateAfter(afterDate) {
  const periods = await db.entities.PayPeriod.list('period_start', 500);
  const upcoming = periods
    .filter((p) => p.pay_date && p.pay_date >= afterDate)
    .sort((a, b) => a.pay_date.localeCompare(b.pay_date));
  return upcoming[0]?.pay_date || null;
}

// Finds this project+salesman's ProjectCommission, creating it on first use
// (the "admin sets config once, math runs itself" flow) rather than
// requiring a separate manual setup step per project.
async function getOrCreateProjectCommission(project, asOfDate) {
  if (!project?.salesman_id) return null;

  const existing = await db.entities.ProjectCommission.filter({ project_id: project.id, salesman_id: project.salesman_id }, '-created_date', 1);
  if (existing[0]) return existing[0];

  const config = await getCompanyCommissionConfig();
  if (!config || config.commission_enabled === false) return null;

  const [actualCost, salesmanRates] = await Promise.all([
    getActualCostForProject(project.id),
    db.entities.SalesmanCommissionRate.filter({ salesman_id: project.salesman_id }, '-effective_date', 200),
  ]);
  const effectiveRate = resolveSalesmanCommissionRate(salesmanRates, project.salesman_id, config, asOfDate);
  const totalCommissionValue = calculateProjectCommission(project, project.salesman_id, config, { actualCost, effectiveRate });
  if (totalCommissionValue <= 0) return null;

  return db.entities.ProjectCommission.create({
    project_id: project.id,
    salesman_id: project.salesman_id,
    calc_method_snapshot: config.commission_calc_method,
    rate_snapshot: effectiveRate != null ? effectiveRate : (config.commission_calc_method === 'flat_rate' ? Number(config.flat_rate_amount) || 0 : Number(config.default_commission_rate) || 0),
    total_contract_value_snapshot: Number(project.contract_value) || 0,
    total_commission_value: totalCommissionValue,
    status: 'pending_payment',
  });
}

// Called after an invoice payment is recorded (Accounting.jsx). Prorates the
// project's total commission by how much of the contract this payment
// represents, creates the ProjectCommissionPayment record, and queues it for
// the next payroll cycle. Returns null (no-op, nothing to toast) when the
// project has no salesman, commissions are disabled, or the math nets to
// zero/negative.
//
// Trace by hand (continuing the $2,000 example above): customer pays $25k of
// a $100k contract -> (25000 / 100000) * 2000 = $500.
export async function triggerCommissionOnPayment(invoiceId, paymentAmount, paymentDate) {
  const invoice = await db.entities.InvoiceReceivable.get(invoiceId);
  if (!invoice?.project_id) return null;

  const project = await db.entities.Project.get(invoice.project_id);
  if (!project?.salesman_id) return null;

  const asOfDate = paymentDate || todayISO();
  const projectCommission = await getOrCreateProjectCommission(project, asOfDate);
  if (!projectCommission || !(Number(projectCommission.total_commission_value) > 0)) return null;

  const totalContractValue = Number(projectCommission.total_contract_value_snapshot) || 0;
  if (totalContractValue <= 0) return null;

  const commissionForThisPayment = round2((Number(paymentAmount) || 0) / totalContractValue * projectCommission.total_commission_value);
  if (commissionForThisPayment <= 0) return null;

  const config = await getCompanyCommissionConfig();
  const payrollCycleDate = config?.next_payroll_cycle === false ? null : await nextPayrollDateAfter(asOfDate);

  return db.entities.ProjectCommissionPayment.create({
    project_commission_id: projectCommission.id,
    invoice_id: invoiceId,
    payment_milestone: invoice.billing_period || '',
    payment_received_date: asOfDate,
    payment_amount: Number(paymentAmount) || 0,
    commission_for_this_payment: commissionForThisPayment,
    payroll_cycle_date: payrollCycleDate,
    status: 'pending_payroll',
  });
}

// Rolls every due ProjectCommissionPayment into one SalesCommissionPayout
// per salesman for this cycle. Idempotent in practice: a payment already
// queued into a payout is no longer 'pending_payroll' (see
// finalizeCommissionPayoutsForRun), so re-running for the same date can't
// double-pay it, but a payment left pending_payroll from a prior missed
// cycle is picked up here too (payroll_cycle_date <= payrollCycleDate, not
// ===), by design.
export async function queueCommissionsForPayroll(payrollCycleDate) {
  const pending = await db.entities.ProjectCommissionPayment.filter({ status: 'pending_payroll' }, '-created_date', 2000);
  const due = pending.filter((p) => p.payroll_cycle_date && p.payroll_cycle_date <= payrollCycleDate);
  if (due.length === 0) return [];

  const projectCommissionIds = [...new Set(due.map((p) => p.project_commission_id))];
  const projectCommissions = await Promise.all(projectCommissionIds.map((id) => db.entities.ProjectCommission.get(id)));
  const salesmanByCommissionId = new Map(projectCommissions.filter(Boolean).map((pc) => [pc.id, pc.salesman_id]));

  const bySalesman = new Map();
  due.forEach((payment) => {
    const salesmanId = salesmanByCommissionId.get(payment.project_commission_id);
    if (!salesmanId) return;
    const list = bySalesman.get(salesmanId) || [];
    list.push(payment);
    bySalesman.set(salesmanId, list);
  });

  const payouts = [];
  for (const [salesmanId, payments] of bySalesman.entries()) {
    const commissionAmount = round2(payments.reduce((sum, p) => sum + (Number(p.commission_for_this_payment) || 0), 0));
    const payout = await db.entities.SalesCommissionPayout.create({
      salesman_id: salesmanId,
      commission_amount: commissionAmount,
      project_commissions_included: payments.map((p) => p.id),
      payout_date: payrollCycleDate,
      status: 'pending_payroll_approval',
    });
    payouts.push(payout);
  }
  return payouts;
}

// Additive PayrollRunPanel hook: called right after a new PayrollRun is
// created, this attaches any queued-but-unattached SalesCommissionPayout
// whose payout_date has arrived, posting each as a PayrollAdjustment
// (adjustment_type 'commission') on the run and bumping its gross/net
// totals — same pattern processTerminationSettlement uses for one-off
// adjustments (see src/lib/ptoEngine.js).
export async function attachPendingCommissionPayoutsToRun(run) {
  if (!run?.id || !run?.run_date) return [];

  const queued = await db.entities.SalesCommissionPayout.filter({ status: 'pending_payroll_approval' }, '-created_date', 500);
  const due = queued.filter((p) => !p.payroll_run_id && p.payout_date <= run.run_date);
  if (due.length === 0) return [];

  let additionalGross = 0;
  for (const payout of due) {
    await db.entities.SalesCommissionPayout.update(payout.id, { payroll_run_id: run.id });
    await db.entities.PayrollAdjustment.create({
      payroll_run_id: run.id,
      employee_id: payout.salesman_id,
      adjustment_type: 'commission',
      amount: payout.commission_amount,
      reason: `Sales commission payout — ${(payout.project_commissions_included || []).length} payment(s)`,
    });
    additionalGross += Number(payout.commission_amount) || 0;
  }

  if (additionalGross > 0) {
    await db.entities.PayrollRun.update(run.id, {
      total_gross: round2((Number(run.total_gross) || 0) + additionalGross),
      total_net: round2((Number(run.total_net) || 0) + additionalGross),
    });
  }

  return due;
}

// Called when a PayrollRun locks: every SalesCommissionPayout attached to it
// flips to 'paid_out', along with the ProjectCommissionPayment rows it rolled
// up. A ProjectCommission itself flips to 'paid_out' once every payment
// against it has cleared payroll and the amounts paid cover the total owed.
export async function finalizeCommissionPayoutsForRun(payrollRunId) {
  const payouts = await db.entities.SalesCommissionPayout.filter({ payroll_run_id: payrollRunId }, '-created_date', 500);
  const pending = payouts.filter((p) => p.status !== 'paid_out');
  if (pending.length === 0) return [];

  const touchedCommissionIds = new Set();

  for (const payout of pending) {
    await db.entities.SalesCommissionPayout.update(payout.id, { status: 'paid_out' });
    for (const paymentId of payout.project_commissions_included || []) {
      const payment = await db.entities.ProjectCommissionPayment.get(paymentId);
      if (!payment || payment.status === 'paid_out') continue;
      await db.entities.ProjectCommissionPayment.update(paymentId, { status: 'paid_out' });
      touchedCommissionIds.add(payment.project_commission_id);
    }
  }

  for (const commissionId of touchedCommissionIds) {
    const pc = await db.entities.ProjectCommission.get(commissionId);
    if (!pc || pc.status === 'paid_out') continue;
    const allPayments = await db.entities.ProjectCommissionPayment.filter({ project_commission_id: commissionId }, '-created_date', 500);
    const fullyCleared = allPayments.every((p) => p.status === 'paid_out');
    const amountCovered = allPayments.reduce((sum, p) => sum + (Number(p.commission_for_this_payment) || 0), 0);
    if (fullyCleared && amountCovered >= Number(pc.total_commission_value) - 0.01) {
      await db.entities.ProjectCommission.update(commissionId, { status: 'paid_out' });
    }
  }

  return pending;
}

const monthKey = (dateStr) => (dateStr || '').slice(0, 7);
const yearKey = (dateStr) => (dateStr || '').slice(0, 4);

// Powers the Commission widget on the Salesman Dashboard. "Pending" and
// "This Month's Commission" are mutually exclusive by ProjectCommissionPayment
// status, matching the real lifecycle: a payment sits in 'pending_payroll'
// (counted as Pending, no month filter — matches every payment still owed
// regardless of which cycle it's queued for) until the payroll run it's
// swept into locks, at which point finalizeCommissionPayoutsForRun flips it
// to 'paid_out' and — if its payroll_cycle_date falls in the current
// calendar month — it now counts as "earned this month" instead.
export async function getSalesmanCommissionSummary(salesmanId, { asOfDate = todayISO() } = {}) {
  const thisMonth = monthKey(asOfDate);
  const thisYear = yearKey(asOfDate);

  const [projectCommissions, payouts] = await Promise.all([
    db.entities.ProjectCommission.filter({ salesman_id: salesmanId }, '-created_date', 500),
    db.entities.SalesCommissionPayout.filter({ salesman_id: salesmanId }, '-created_date', 500),
  ]);

  const paymentsByCommission = new Map();
  await Promise.all(projectCommissions.map(async (pc) => {
    const payments = await db.entities.ProjectCommissionPayment.filter({ project_commission_id: pc.id }, '-created_date', 500);
    paymentsByCommission.set(pc.id, payments);
  }));

  let thisMonthEarned = 0;
  let thisMonthPending = 0;
  paymentsByCommission.forEach((payments) => {
    payments.forEach((p) => {
      const amount = Number(p.commission_for_this_payment) || 0;
      if (p.status === 'pending_payroll') thisMonthPending += amount;
      else if (p.status === 'paid_out' && monthKey(p.payroll_cycle_date) === thisMonth) thisMonthEarned += amount;
    });
  });

  const ytdPaid = payouts
    .filter((p) => p.status === 'paid_out' && yearKey(p.payout_date) === thisYear)
    .reduce((sum, p) => sum + (Number(p.commission_amount) || 0), 0);

  const projects = await Promise.all([...new Set(projectCommissions.map((pc) => pc.project_id))].map((id) => db.entities.Project.get(id)));
  const projectById = new Map(projects.filter(Boolean).map((p) => [p.id, p]));

  const byProject = projectCommissions.map((pc) => {
    const payments = paymentsByCommission.get(pc.id) || [];
    return {
      projectId: pc.project_id,
      projectName: projectById.get(pc.project_id)?.name || pc.project_id,
      bidAmount: pc.total_contract_value_snapshot,
      rate: pc.rate_snapshot,
      calcMethod: pc.calc_method_snapshot,
      totalCommission: pc.total_commission_value,
      paymentsReceived: round2(payments.reduce((s, p) => s + (Number(p.payment_amount) || 0), 0)),
      commissionPaid: round2(payments.filter((p) => p.status === 'paid_out').reduce((s, p) => s + (Number(p.commission_for_this_payment) || 0), 0)),
      commissionPending: round2(payments.filter((p) => p.status === 'pending_payroll').reduce((s, p) => s + (Number(p.commission_for_this_payment) || 0), 0)),
    };
  });

  return { thisMonthEarned: round2(thisMonthEarned), thisMonthPending: round2(thisMonthPending), ytdPaid: round2(ytdPaid), byProject };
}
