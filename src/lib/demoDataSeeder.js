import { db } from '@/api/apiClient';
import { getEffectiveCompany } from '@/lib/tenantContext';

// Same 10 standard close tasks MonthEndClosePanel.jsx seeds a new period
// with — kept in lockstep with that list so demo closes look identical to
// ones a real user starts from the panel.
const STANDARD_CLOSE_TASKS = [
  { category: 'AP', task_name: 'Review and approve all pending vendor bills' },
  { category: 'AP', task_name: 'Confirm all vendor bills for the period are entered' },
  { category: 'AR', task_name: 'Send all progress billings for the period' },
  { category: 'AR', task_name: 'Review AR aging and follow up on overdue accounts' },
  { category: 'Cash', task_name: 'Reconcile all bank accounts for the period' },
  { category: 'Job Cost', task_name: 'Run/update the WIP schedule' },
  { category: 'Job Cost', task_name: 'Review estimated vs actual variances on active jobs' },
  { category: 'Payroll', task_name: 'Confirm labor hours are allocated to correct job numbers' },
  { category: 'Reporting', task_name: 'Export period ledger entries to QuickBooks/Sage' },
  { category: 'Reporting', task_name: 'Final review and sign-off' },
];

const BUDGET_CATEGORIES = [
  { category: 'Revenue', monthly: 220000 },
  { category: 'LAB', monthly: 45000 },
  { category: 'MAT', monthly: 70000 },
  { category: 'SUB', monthly: 30000 },
  { category: 'EQP', monthly: 12000 },
];

// Base64-encodes text containing non-Latin1 characters (em dashes, etc.) —
// plain btoa() throws on those. All generated images are data URIs so they
// survive a fresh browser session; this app has a known bug elsewhere where
// blob: URLs don't, and this must not repeat it.
function toBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function svgDataUri(svg) {
  return `data:image/svg+xml;base64,${toBase64(svg)}`;
}

function logoSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100" viewBox="0 0 400 100">
    <rect width="400" height="100" fill="#0f2444"/>
    <text x="200" y="60" font-family="Arial, Helvetica, sans-serif" font-size="32" font-weight="700" fill="#ffffff" text-anchor="middle" letter-spacing="2">HANCOCK STEEL</text>
  </svg>`;
}

function slideshowSvg(text, bgColor) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
    <rect width="1600" height="900" fill="${bgColor}"/>
    <text x="800" y="470" font-family="Arial, Helvetica, sans-serif" font-size="58" font-weight="700" fill="#ffffff" text-anchor="middle">${text}</text>
  </svg>`;
}

function daysFromNow(delta) {
  const d = new Date();
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

function periodFor(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function isoDaysFromNow(delta) {
  const d = new Date();
  d.setDate(d.getDate() + delta);
  return d.toISOString();
}

// Offsets (0 or negative "days ago") for the most recent N weekdays
// (Mon-Fri), most recent first — used to spread attendance punches across
// the last few real work-weeks without landing any on a weekend.
function lastNWeekdayOffsets(n) {
  const offsets = [];
  let i = 0;
  while (offsets.length < n) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) offsets.push(-i);
    i += 1;
  }
  return offsets;
}

export async function seedDemoData() {
  const existingBids = await db.entities.Bid.list('-created_date', 1);
  if (existingBids.length > 0) {
    const proceed = confirm(
      'Demo data (or real data) already exists — running this again will add duplicates, not replace anything. Continue?'
    );
    if (!proceed) return { skipped: true };
  }

  // 1. Company branding
  const company = await getEffectiveCompany();
  if (company) {
    await db.entities.Company.update(company.id, {
      logo_url: svgDataUri(logoSvg()),
      logo_scale_pct: 100,
    });
  }

  // 2. Login slideshow images
  await db.entities.login_slideshow_images.bulkCreate([
    { image_data_uri: svgDataUri(slideshowSvg('Structural Steel Fabrication', '#0f2444')), display_order: 0 },
    { image_data_uri: svgDataUri(slideshowSvg('Precision Estimating and Takeoff', '#b45309')), display_order: 1 },
    { image_data_uri: svgDataUri(slideshowSvg('From Bid to Erection', '#374151')), display_order: 2 },
  ]);

  // 3. Employees — 2 Estimating, 1 PM, 2 Shop/Fab, 2 Field/Erection, 1 Accounting, 1 HR, 1 Shop Mgmt
  const employeeSeeds = [
    { employee_number: 'EMP-001', full_name: 'Sarah Mitchell', classification: 'Senior Estimator', department: 'Estimating', hire_date: daysFromNow(-1460) },
    { employee_number: 'EMP-002', full_name: 'David Chen', classification: 'Estimator', department: 'Estimating', hire_date: daysFromNow(-680) },
    { employee_number: 'EMP-003', full_name: 'Michael Torres', classification: 'Project Manager', department: 'Project Management', hire_date: daysFromNow(-1200) },
    { employee_number: 'EMP-004', full_name: 'James Anderson', classification: 'Fabricator', department: 'Shop/Fabrication', hire_date: daysFromNow(-540) },
    { employee_number: 'EMP-005', full_name: 'Robert Kim', classification: 'Welder', department: 'Shop/Fabrication', hire_date: daysFromNow(-980) },
    { employee_number: 'EMP-006', full_name: 'Carlos Ramirez', classification: 'Ironworker', department: 'Field/Erection', hire_date: daysFromNow(-410) },
    { employee_number: 'EMP-007', full_name: "Brian O'Connell", classification: 'Erection Foreman', department: 'Field/Erection', hire_date: daysFromNow(-1350) },
    { employee_number: 'EMP-008', full_name: 'Linda Parker', classification: 'Staff Accountant', department: 'Accounting', hire_date: daysFromNow(-860) },
    { employee_number: 'EMP-009', full_name: 'Angela Brooks', classification: 'HR Generalist', department: 'HR', hire_date: daysFromNow(-390) },
    { employee_number: 'EMP-010', full_name: 'Thomas Wright', classification: 'Shop Manager', department: 'Shop Management', hire_date: daysFromNow(-1100) },
  ].map((e) => ({ ...e, is_active: true }));

  const employees = await db.entities.employees.bulkCreate(employeeSeeds);
  const [estimator1, estimator2] = employees;

  // 4. Bids — 5 won / 3 lost / 3 in_progress / 2 submitted / 1 draft
  const bidSeeds = [
    { customer_name: 'Midwest General Contractors', job_name: 'Riverside Distribution Center - Structural Steel', job_location: 'Columbus, OH', bid_total_cost: 620000, status: 'won', due: -120, estimator_id: estimator1.id },
    { customer_name: 'Buckeye Construction Group', job_name: 'Westfield Manufacturing Plant Expansion', job_location: 'Toledo, OH', bid_total_cost: 480000, status: 'won', due: -90, estimator_id: estimator2.id },
    { customer_name: 'Great Lakes Builders', job_name: 'Harbor View Office Complex', job_location: 'Cleveland, OH', bid_total_cost: 850000, status: 'won', due: -60, estimator_id: estimator1.id },
    { customer_name: 'Heartland Construction Partners', job_name: 'Northside Parking Structure', job_location: 'Cincinnati, OH', bid_total_cost: 310000, status: 'won', due: -45, estimator_id: estimator2.id },
    { customer_name: 'Summit Ridge Contractors', job_name: 'Lakeside Retail Plaza', job_location: 'Akron, OH', bid_total_cost: 195000, status: 'won', due: -30, estimator_id: estimator1.id },

    { customer_name: 'Riverside Development Co.', job_name: 'Eastgate Industrial Warehouse', job_location: 'Dayton, OH', bid_total_cost: 400000, status: 'lost', due: -100, estimator_id: estimator2.id, loss_reason: 'price' },
    { customer_name: 'Northgate Builders', job_name: 'Maple Street Bridge Repair', job_location: 'Findlay, OH', bid_total_cost: 275000, status: 'lost', due: -70, estimator_id: estimator1.id, loss_reason: 'schedule' },
    { customer_name: 'Foundation Point Construction', job_name: 'Crestview Medical Office Building', job_location: 'Lima, OH', bid_total_cost: 560000, status: 'lost', due: -40, estimator_id: estimator2.id, loss_reason: 'competitor' },

    { customer_name: 'Midwest General Contractors', job_name: 'Union Station Renovation', job_location: 'Columbus, OH', bid_total_cost: 720000, status: 'in_progress', due: 14, estimator_id: estimator1.id },
    { customer_name: 'Buckeye Construction Group', job_name: 'Riverside Elementary School Addition', job_location: 'Toledo, OH', bid_total_cost: 340000, status: 'in_progress', due: 28, estimator_id: estimator2.id },
    { customer_name: 'Great Lakes Builders', job_name: 'Portside Cold Storage Facility', job_location: 'Cleveland, OH', bid_total_cost: 890000, status: 'in_progress', due: 42, estimator_id: estimator1.id },

    { customer_name: 'Heartland Construction Partners', job_name: 'Southgate Distribution Hub', job_location: 'Cincinnati, OH', bid_total_cost: 505000, status: 'submitted', due: 7, estimator_id: estimator2.id },
    { customer_name: 'Summit Ridge Contractors', job_name: 'Ridgeline Corporate Campus', job_location: 'Akron, OH', bid_total_cost: 615000, status: 'submitted', due: 21, estimator_id: estimator1.id },

    { customer_name: 'Riverside Development Co.', job_name: 'Fifth Avenue Mixed-Use Tower', job_location: 'Dayton, OH', bid_total_cost: 430000, status: 'draft', due: null, estimator_id: estimator2.id },
  ];

  const yearSuffix = String(new Date().getFullYear()).slice(-2);
  const bidPayloads = bidSeeds.map((b, i) => {
    const [job_city, job_state] = b.job_location.split(',').map((s) => s.trim());
    return {
      bid_number: `E${yearSuffix}-${String(101 + i).padStart(3, '0')}`,
      customer_name: b.customer_name,
      job_name: b.job_name,
      job_location: b.job_location,
      job_city,
      job_state,
      bid_due_date: b.due == null ? undefined : daysFromNow(b.due),
      status: b.status,
      bid_total_cost: b.bid_total_cost,
      estimator_id: b.estimator_id,
      is_archived: false,
      ...(b.loss_reason ? { loss_reason: b.loss_reason } : {}),
    };
  });

  const bids = await db.entities.Bid.bulkCreate(bidPayloads);

  // 5. Projects — for 4 of the 5 won bids (the 5th stays won with no project)
  const wonBidsForProjects = bids.slice(0, 4);
  const projectStatuses = ['complete', 'erection', 'fabrication', 'awarded'];
  const projectPayloads = wonBidsForProjects.map((bid, i) => ({
    project_number: `P${yearSuffix}-${String(101 + i).padStart(3, '0')}`,
    name: bid.job_name,
    project_type: 'commercial',
    status: projectStatuses[i],
    customer_name: bid.customer_name,
    estimator_id: bid.estimator_id,
    contract_value: bid.bid_total_cost,
    city: bid.job_city,
    state: bid.job_state,
    award_date: bid.bid_due_date,
    is_archived: false,
  }));
  const projects = await db.entities.Project.bulkCreate(projectPayloads);

  await Promise.all(
    wonBidsForProjects.map((bid, i) =>
      db.entities.Bid.update(bid.id, { won_project_id: projects[i].id, project_id: projects[i].id })
    )
  );

  // 6. JobCostLedgerEntry — ~6 entries each for the 3 projects with actual shop/field progress
  const costProjects = projects.slice(0, 3); // complete, erection, fabrication (skip the just-awarded one)
  const ledgerPayloads = [];
  costProjects.forEach((proj, pIdx) => {
    const stagger = pIdx * 3;
    ledgerPayloads.push(
      { project_id: proj.id, cost_code: 'LAB-FAB', cost_class: 'LAB', amount: 4200 + pIdx * 300, transaction_date: daysFromNow(-58 + stagger), source_type: 'labor', description: 'Shop fabrication labor' },
      { project_id: proj.id, cost_code: 'LAB-FAB', cost_class: 'LAB', amount: 3800 + pIdx * 250, transaction_date: daysFromNow(-42 + stagger), source_type: 'labor', description: 'Shop fabrication labor' },
      { project_id: proj.id, cost_code: 'LAB-ERECT', cost_class: 'LAB', amount: 5100 + pIdx * 200, transaction_date: daysFromNow(-20 + stagger), source_type: 'labor', description: 'Field erection labor' },
      { project_id: proj.id, cost_code: 'MAT-STL', cost_class: 'MAT', amount: 28000 + pIdx * 4000, transaction_date: daysFromNow(-52 + stagger), source_type: 'material', description: 'Structural steel material draw' },
      { project_id: proj.id, cost_code: 'SUB-ERECT', cost_class: 'SUB', amount: 11500 + pIdx * 1500, transaction_date: daysFromNow(-30 + stagger), source_type: 'vendor_bill', description: 'Erection subcontractor billing' },
      { project_id: proj.id, cost_code: 'EQP-CRANE', cost_class: 'EQP', amount: 5600 + pIdx * 400, transaction_date: daysFromNow(-15 + stagger), source_type: 'other', description: 'Crane and rigging equipment' }
    );
  });
  await db.entities.JobCostLedgerEntry.bulkCreate(ledgerPayloads);

  // 7. Bank accounts
  const [operatingAccount, payrollAccount] = await db.entities.BankAccount.bulkCreate([
    { account_name: 'Operating Checking', bank_name: 'First National Bank', account_type: 'Checking', account_number_last4: '4821', opening_balance: 150000, is_active: true },
    { account_name: 'Payroll Checking', bank_name: 'First National Bank', account_type: 'Checking', account_number_last4: '7734', opening_balance: 40000, is_active: true },
  ]);

  // 8. Bank transactions — ~20 across both accounts, ~70% reconciled
  const operatingDeposits = [
    { amount: 145000, description: 'Customer payment — Midwest General Contractors', dayOffset: -55 },
    { amount: 89670, description: 'Customer payment — Buckeye Construction Group', dayOffset: -38 },
    { amount: 57660, description: 'Customer payment — Great Lakes Builders', dayOffset: -22 },
    { amount: 62000, description: 'Customer payment — Heartland Construction Partners', dayOffset: -8 },
  ];
  const operatingWithdrawals = [
    { amount: -18500, description: 'ACH — Buckeye Steel Supply', dayOffset: -50 },
    { amount: -9800, description: 'ACH — Ohio Valley Crane Rental', dayOffset: -45 },
    { amount: -12400, description: 'ACH — Precision Welding Subcontractors', dayOffset: -36 },
    { amount: -6200, description: 'ACH — Midwest Rebar & Materials', dayOffset: -30 },
    { amount: -22000, description: 'ACH — Buckeye Steel Supply', dayOffset: -25 },
    { amount: -4300, description: 'Fuel and equipment rental', dayOffset: -18 },
    { amount: -15800, description: 'ACH — Precision Welding Subcontractors', dayOffset: -12 },
    { amount: -3200, description: 'Office supplies and utilities', dayOffset: -4 },
  ];
  const payrollDeposits = [
    { amount: 40000, description: 'Transfer from Operating Checking', dayOffset: -61 },
    { amount: 40000, description: 'Transfer from Operating Checking', dayOffset: -43 },
    { amount: 40000, description: 'Transfer from Operating Checking', dayOffset: -15 },
  ];
  // Each payroll run is dated just after the transfer that funds it, so the
  // running balance (opening + chronological transactions) never goes negative.
  const payrollWithdrawals = [
    { amount: -18700, description: 'Payroll run', dayOffset: -59 },
    { amount: -19200, description: 'Payroll run', dayOffset: -55 },
    { amount: -18800, description: 'Payroll run', dayOffset: -41 },
    { amount: -19500, description: 'Payroll run', dayOffset: -27 },
    { amount: -19100, description: 'Payroll run', dayOffset: -13 },
    { amount: -18950, description: 'Payroll run', dayOffset: -2 },
  ];

  const bankTxSeeds = [
    ...operatingDeposits.map((t) => ({ ...t, bank_account_id: operatingAccount.id, transaction_type: 'Deposit' })),
    ...operatingWithdrawals.map((t) => ({ ...t, bank_account_id: operatingAccount.id, transaction_type: 'Withdrawal' })),
    ...payrollDeposits.map((t) => ({ ...t, bank_account_id: payrollAccount.id, transaction_type: 'Transfer' })),
    ...payrollWithdrawals.map((t) => ({ ...t, bank_account_id: payrollAccount.id, transaction_type: 'Withdrawal' })),
  ];

  // Leave the ~6 most recent transactions unreconciled so the reconciliation UI has something to actually reconcile.
  const sortedByRecency = [...bankTxSeeds].sort((a, b) => b.dayOffset - a.dayOffset);
  const unreconciledSet = new Set(sortedByRecency.slice(0, 6));

  const bankTransactionPayloads = bankTxSeeds.map((t) => {
    const reconciled = !unreconciledSet.has(t);
    return {
      bank_account_id: t.bank_account_id,
      transaction_date: daysFromNow(t.dayOffset),
      description: t.description,
      amount: t.amount,
      transaction_type: t.transaction_type,
      source: 'manual',
      reconciled,
      ...(reconciled ? { reconciled_date: daysFromNow(Math.min(t.dayOffset + 5, 0)) } : {}),
    };
  });
  await db.entities.BankTransaction.bulkCreate(bankTransactionPayloads);

  // 9. Month-end close — last month Closed, current month In Progress
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const currentPeriod = periodFor(currentYear, currentMonth);

  const lastMonthDate = new Date(currentYear, currentMonth - 2, 1);
  const lastPeriod = periodFor(lastMonthDate.getFullYear(), lastMonthDate.getMonth() + 1);
  const lastMonthClosedDate = new Date(currentYear, currentMonth - 1, 0).toISOString().slice(0, 10); // last day of last month

  const closedLastMonth = await db.entities.MonthEndClose.create({
    period: lastPeriod,
    status: 'Closed',
    closed_date: lastMonthClosedDate,
    closed_by: 'Linda Parker',
  });
  await db.entities.CloseChecklistItem.bulkCreate(
    STANDARD_CLOSE_TASKS.map((t, i) => ({
      close_id: closedLastMonth.id,
      period: lastPeriod,
      category: t.category,
      task_name: t.task_name,
      status: 'Complete',
      completed_date: lastMonthClosedDate,
      sort_order: i,
    }))
  );

  const inProgressCurrentMonth = await db.entities.MonthEndClose.create({
    period: currentPeriod,
    status: 'In Progress',
  });
  const currentMonthStatuses = ['Complete', 'Complete', 'Complete', 'Complete', 'In Progress', 'In Progress', 'Not Started', 'Not Started', 'Not Started', 'Not Started'];
  await db.entities.CloseChecklistItem.bulkCreate(
    STANDARD_CLOSE_TASKS.map((t, i) => ({
      close_id: inProgressCurrentMonth.id,
      period: currentPeriod,
      category: t.category,
      task_name: t.task_name,
      status: currentMonthStatuses[i],
      ...(currentMonthStatuses[i] === 'Complete' ? { completed_date: daysFromNow(-3) } : {}),
      sort_order: i,
    }))
  );

  // 10. Budget — full current-year budget, 5 categories x 12 months
  const fiscalYear = String(currentYear);
  const budgetPayloads = [];
  BUDGET_CATEGORIES.forEach(({ category, monthly }) => {
    for (let m = 1; m <= 12; m++) {
      budgetPayloads.push({ fiscal_year: fiscalYear, period: periodFor(fiscalYear, m), category, budgeted_amount: monthly });
    }
  });
  await db.entities.BudgetLine.bulkCreate(budgetPayloads);

  // 11. Vendors + Vendor Bills
  const [buckeyeSteel, midwestRebar, ohioValleyCrane, precisionWelding] = await db.entities.Vendor.bulkCreate([
    { name: 'Buckeye Steel Supply', vendor_type: 'supplier', is_active: true },
    { name: 'Midwest Rebar & Materials', vendor_type: 'supplier', is_active: true },
    { name: 'Ohio Valley Crane Rental', vendor_type: 'equipment_rental', is_active: true },
    { name: 'Precision Welding Subcontractors', vendor_type: 'subcontractor', is_active: true },
  ]);

  const vendorBillSeeds = [
    { vendor_id: buckeyeSteel.id, project_id: projects[0].id, invoice_number: 'INV-5001', gross_amount: 42000, status: 'Approved', dueOffset: 14, invoiceOffset: -10 },
    { vendor_id: midwestRebar.id, project_id: projects[1].id, invoice_number: 'INV-5002', gross_amount: 18500, status: 'Approved', dueOffset: 21, invoiceOffset: -5 },
    { vendor_id: ohioValleyCrane.id, project_id: projects[1].id, invoice_number: 'INV-5003', gross_amount: 9800, status: 'Approved', dueOffset: 28, invoiceOffset: -2 },
    { vendor_id: precisionWelding.id, project_id: projects[2].id, invoice_number: 'INV-5004', gross_amount: 27500, status: 'Approved', dueOffset: 18, invoiceOffset: -7 },
    { vendor_id: buckeyeSteel.id, project_id: projects[0].id, invoice_number: 'INV-5005', gross_amount: 55000, status: 'Pending_Match', dueOffset: 25, invoiceOffset: -3 },
    { vendor_id: midwestRebar.id, project_id: projects[2].id, invoice_number: 'INV-5006', gross_amount: 6200, status: 'Pending_Match', dueOffset: 20, invoiceOffset: -1 },
  ];
  await db.entities.VendorBill.bulkCreate(
    vendorBillSeeds.map((v) => ({
      vendor_id: v.vendor_id,
      po_id: '',
      project_id: v.project_id,
      invoice_number: v.invoice_number,
      invoice_date: daysFromNow(v.invoiceOffset),
      due_date: daysFromNow(v.dueOffset),
      gross_amount: v.gross_amount,
      status: v.status,
    }))
  );

  // 12. Invoice Receivables
  const nextMonthDate = new Date(currentYear, currentMonth, 1);
  const nextPeriod = periodFor(nextMonthDate.getFullYear(), nextMonthDate.getMonth() + 1);
  const invoiceReceivableSeeds = [
    { project_id: projects[0].id, gross_amount: 145000, retainagePct: 0.05, payment_status: 'Released', expectedOffset: 14, billing_period: currentPeriod },
    { project_id: projects[1].id, gross_amount: 98000, retainagePct: 0.085, payment_status: 'Approved', expectedOffset: 21, billing_period: currentPeriod },
    { project_id: projects[2].id, gross_amount: 62000, retainagePct: 0.07, payment_status: 'Approved', expectedOffset: 28, billing_period: currentPeriod },
    { project_id: projects[3].id, gross_amount: 35000, retainagePct: 0.09, payment_status: 'Draft', expectedOffset: 35, billing_period: nextPeriod },
    { project_id: projects[0].id, gross_amount: 24000, retainagePct: 0.09, payment_status: 'Draft', expectedOffset: 30, billing_period: nextPeriod },
  ];
  await db.entities.InvoiceReceivable.bulkCreate(
    invoiceReceivableSeeds.map((inv) => {
      const retainage_held = Math.round(inv.gross_amount * inv.retainagePct);
      return {
        project_id: inv.project_id,
        billing_period: inv.billing_period,
        expected_payment_date: daysFromNow(inv.expectedOffset),
        gross_amount: inv.gross_amount,
        retainage_held,
        net_billing: inv.gross_amount - retainage_held,
        payment_status: inv.payment_status,
      };
    })
  );

  // 13. Review Checklist Items — Hancock Steel's actual front-end review requirements
  const reviewChecklistSeeds = [
    { item_code: 'INS-1', category: 'General/Commercial', item_label: 'Insurance Requirements', keywords: 'insurance,certificate of insurance,COI,general liability,umbrella,additional insured', sort_order: 1, note_for_estimator: 'Check required limits — flag if above standard policy' },
    { item_code: 'BND-1', category: 'General/Commercial', item_label: 'Bond Requirements', keywords: 'bond,performance bond,payment bond,surety,bonding', sort_order: 2, note_for_estimator: 'Confirm bond % and who provides it' },
    { item_code: 'PAY-1', category: 'General/Commercial', item_label: 'Payment and Performance', keywords: 'payment terms,net 30,net 45,pay-if-paid,pay when paid,progress payment,schedule of values', sort_order: 3 },
    { item_code: 'LD-1', category: 'General/Commercial', item_label: 'Liquidated Damages', keywords: 'liquidated damages,LD,delay damages,per diem,per day penalty', sort_order: 4, note_for_estimator: 'Note dollar amount per day and milestone date' },
    { item_code: 'CO-1', category: 'General/Commercial', item_label: 'Change Order Procedures', keywords: 'change order,change directive,modifications,contract modification,change order procedure', sort_order: 5 },
    { item_code: 'TAX-1', category: 'General/Commercial', item_label: 'Sales Tax / Tax Exempt', keywords: 'sales tax,tax exempt,exemption certificate,tax exemption', sort_order: 6, note_for_estimator: 'Confirm location — city and state affect rate' },
    { item_code: 'BIM-1', category: 'General/Commercial', item_label: 'BIM Requirements', keywords: 'BIM,building information modeling,Revit,Navisworks,clash detection,model coordination,IFC', sort_order: 7, note_for_estimator: 'Flag — adds cost and schedule' },
    { item_code: 'TEX-1', category: 'General/Commercial', item_label: 'Textura', keywords: 'Textura,payment management,compliance tracking,GCPay', sort_order: 8, note_for_estimator: 'Confirm fee structure' },
    { item_code: 'PRO-1', category: 'General/Commercial', item_label: 'Procore Pay', keywords: 'Procore,Procore pay,project management platform', sort_order: 9 },
    { item_code: 'BID-1', category: 'General/Commercial', item_label: 'Bid Withdraw Days', keywords: 'bid withdrawal,irrevocable,bid open,bid valid,days after bid', sort_order: 10 },
    { item_code: 'PW-1', category: 'General/Commercial', item_label: 'Prevailing Wage', keywords: 'prevailing wage,Davis-Bacon,wage determination,certified payroll,labor standards', sort_order: 11, note_for_estimator: 'Flag for estimator — impacts labor cost significantly' },
    { item_code: 'CLN-1', category: 'General/Commercial', item_label: 'Cleaning Cost', keywords: 'cleaning,clean up,site cleanup,debris removal,housekeeping', sort_order: 12 },
    { item_code: 'TST-1', category: 'General/Commercial', item_label: 'Testing Cost', keywords: 'testing,special inspection,third-party inspection,non-destructive,ultrasonic,MT,UT,RT', sort_order: 13, note_for_estimator: 'Confirm who pays and scope of testing required' },
    { item_code: 'WRN-1', category: 'General/Commercial', item_label: 'Warranty (>1 year)', keywords: 'warranty,guarantee,correction period,defect liability', sort_order: 14, note_for_estimator: 'Flag if warranty exceeds 1 year on structural steel' },
    { item_code: 'CLO-1', category: 'General/Commercial', item_label: 'Closeout Submittals', keywords: 'closeout,as-built,record drawings,O&M,operation and maintenance,final completion,substantial completion,closeout submittal', sort_order: 15 },
    { item_code: 'EDG-1', category: 'General/Commercial', item_label: 'EDGE / WBE / MBE Certifications', keywords: 'EDGE,WBE,MBE,DBE,minority,woman-owned,disadvantaged business,subcontracting goal,participation goal', sort_order: 16, requires_value_extraction: true, note_for_estimator: 'Note required % if found' },
    { item_code: 'LED-1', category: 'General/Commercial', item_label: 'LEED Requirements', keywords: 'LEED,green building,sustainable,recycled content,regional material,certified wood,environmental', sort_order: 17 },
    { item_code: 'PRQ-1', category: 'General/Commercial', item_label: 'Prequalified Bidders', keywords: 'prequalified,pre-qualified,approved bidder,approved contractor,prequalification', sort_order: 18 },
    { item_code: 'SAF-1', category: 'General/Commercial', item_label: 'Safety Requirements', keywords: 'safety plan,safety program,incident rate,EMR,experience modification,OSHA,safety requirements', sort_order: 19 },
    { item_code: 'RET-1', category: 'General/Commercial', item_label: 'Retainage', keywords: 'retainage,retention,retain,retainage reduction', sort_order: 20, note_for_estimator: 'Note % held and release conditions' },
    { item_code: 'RFI-1', category: 'General/Commercial', item_label: 'RFI Procedures', keywords: 'RFI,request for information,RFI response,submittal procedure', sort_order: 21 },
    { item_code: 'PCO-1', category: 'General/Commercial', item_label: 'Project Closeout Procedures', keywords: 'closeout procedure,punch list,final inspection,certificate of occupancy,project closeout', sort_order: 22 },
    { item_code: 'D05-AISC', category: 'Division 05', item_label: 'AISC Certification Required', keywords: 'AISC,certification,certified fabricator,standard for steel buildings,AISC 360', sort_order: 30, note_for_estimator: 'Confirm category required — Standard vs Advanced vs Sophisticated' },
    { item_code: 'D05-SCH', category: 'Division 05', item_label: 'Schedule Procedures', keywords: 'schedule,CPM,critical path,baseline schedule,schedule of values,construction schedule', sort_order: 31, note_for_estimator: 'If no schedule found, note "NO SCHEDULE"' },
    { item_code: 'D05-RFI', category: 'Division 05', item_label: 'RFI Submission (Div 05)', keywords: 'RFI,request for information,clarification,submittal log', sort_order: 32 },
    { item_code: 'D05-SAF', category: 'Division 05', item_label: 'Safety Requirements for Subcontractor', keywords: 'subcontractor safety,ironworker,fall protection,OSHA 1926,steel erection,safety plan', sort_order: 33 },
    { item_code: 'D05-COT', category: 'Division 05', item_label: 'Special Coating on Steel', keywords: 'coating,paint system,primer,epoxy,zinc,galvanized,SSPC,surface preparation,paint spec', sort_order: 34, note_for_estimator: 'Note full paint system spec if found' },
    { item_code: 'D05-FP', category: 'Division 05', item_label: 'Fireproofing', keywords: 'fireproofing,spray-applied,intumescent,fire rating,UL assembly,hourly rating,SFRM', sort_order: 35, note_for_estimator: 'Confirm who supplies and installs — in scope or excluded' },
    { item_code: 'D05-LOC', category: 'Division 05', item_label: 'Schedule Location in Document', keywords: 'schedule,project schedule,milestone schedule,construction schedule,attached hereto', sort_order: 36, note_for_estimator: 'List page/section reference where schedule appears' },
  ];
  await db.entities.ReviewChecklistItem.bulkCreate(
    reviewChecklistSeeds.map((item) => ({
      is_active: true,
      requires_value_extraction: false,
      is_required: true,
      note_for_estimator: '',
      ...item,
    }))
  );

  // 14. Customers (CRM) — feeds CustomerPickerModal's picker list
  const customerSeeds = [
    { name: 'Midwest General Contractors', customer_type: 'general_contractor', city: 'Columbus', state: 'OH' },
    { name: 'Buckeye Construction Group', customer_type: 'general_contractor', city: 'Toledo', state: 'OH' },
    { name: 'Great Lakes Builders', customer_type: 'general_contractor', city: 'Cleveland', state: 'OH' },
    { name: 'Heartland Construction Partners', customer_type: 'general_contractor', city: 'Cincinnati', state: 'OH' },
    { name: 'Franklin County Schools', customer_type: 'owner', city: 'Columbus', state: 'OH' },
    { name: 'Ohio State Medical Center', customer_type: 'owner', city: 'Columbus', state: 'OH' },
    { name: 'Findlay City Engineering', customer_type: 'other', city: 'Findlay', state: 'OH' },
    { name: 'Northwest Ohio Port Authority', customer_type: 'other', city: 'Toledo', state: 'OH' },
  ];
  await db.entities.Customer.bulkCreate(
    customerSeeds.map((c) => ({ ...c, is_active: true, portal_enabled: false }))
  );

  // 15. Contracts — one per project
  const projectStatusLdRate = { complete: 500, erection: 1000, fabrication: 750, awarded: 0 };
  const contractSeeds = projects.map((proj, i) => ({
    project_id: proj.id,
    gc_name: wonBidsForProjects[i].customer_name,
    contract_value: proj.contract_value,
    rfi_response_window_days: i < 2 ? 10 : 7,
    liquidated_damages_per_day: projectStatusLdRate[proj.status],
    retainage_pct: 0.10,
    notice_cure_days: 7,
    status: 'active',
  }));
  await db.entities.Contract.bulkCreate(contractSeeds);

  // 16. SOV Lines — 5 per active project (complete/erection/fabrication), skip the just-awarded one
  const sovItemWeights = [
    { item_description: 'Structural Steel Fabrication', weight: 0.45 },
    { item_description: 'Steel Erection', weight: 0.30 },
    { item_description: 'Anchor Bolts & Miscellaneous', weight: 0.10 },
    { item_description: 'Shop Drawings & Submittals', weight: 0.08 },
    { item_description: 'Project Management & Closeout', weight: 0.07 },
  ];
  const sovCompletionByIdx = [1.0, 0.65, 0.30]; // complete, erection, fabrication
  const sovPayloads = [];
  costProjects.forEach((proj, idx) => {
    const completion_percentage = sovCompletionByIdx[idx];
    sovItemWeights.forEach(({ item_description, weight }) => {
      const original_scheduled_value = Math.round(proj.contract_value * weight);
      sovPayloads.push({
        project_id: proj.id,
        item_description,
        original_scheduled_value,
        completion_percentage,
        current_billed_amount: Math.round(original_scheduled_value * completion_percentage),
        retainage_rate: 0.10,
      });
    });
  });
  await db.entities.SovLine.bulkCreate(sovPayloads);

  // 17. RFIs — 4 per active project (2 answered, 1 submitted, 1 draft)
  const estimatingEmployees = employees.filter((e) => e.department === 'Estimating');
  const pmEmployee = employees.find((e) => e.department === 'Project Management');
  const shopEmployees = employees.filter((e) => e.department === 'Shop/Fabrication');
  const fieldEmployees = employees.filter((e) => e.department === 'Field/Erection');
  const shopManager = employees.find((e) => e.department === 'Shop Management');
  const accountant = employees.find((e) => e.department === 'Accounting');
  const hrEmployee = employees.find((e) => e.department === 'HR');

  const rfiProjectSeeds = [
    {
      project: costProjects[0],
      items: [
        { subject: 'Connection detail clarification at grid line C-4', priority: 'medium', status: 'answered', submittedOffset: -28, answeredOffset: -10, response: 'Confirmed per detail 5/S3.1 — proceed as drawn.', submitter: estimatingEmployees[0] },
        { subject: 'Anchor bolt layout confirmation — column line 7', priority: 'high', status: 'answered', submittedOffset: -21, answeredOffset: -7, response: 'Revised anchor bolt pattern per SK-001, see attached sketch.', submitter: pmEmployee },
        { subject: 'Beam cope detail at moment connection', priority: 'high', status: 'submitted', submittedOffset: -7, requiredOffset: 3, submitter: estimatingEmployees[1] },
        { subject: 'Erection sequence clarification for north bay', priority: 'medium', status: 'draft', submitter: pmEmployee },
      ],
    },
    {
      project: costProjects[1],
      items: [
        { subject: 'Column base plate detail verification', priority: 'high', status: 'answered', submittedOffset: -25, answeredOffset: -12, response: 'See revised detail 8/S4.2 for base plate connection.', submitter: pmEmployee },
        { subject: 'Fireproofing scope at exposed steel columns', priority: 'medium', status: 'answered', submittedOffset: -20, answeredOffset: -8, response: 'Fireproofing by others per spec section 07 81 00 — steel scope excludes SFRM application.', submitter: estimatingEmployees[0] },
        { subject: 'Coating specification for exterior canopy steel', priority: 'high', status: 'submitted', submittedOffset: -7, requiredOffset: 3, submitter: estimatingEmployees[1] },
        { subject: 'Erection sequence for high bay crane runway', priority: 'medium', status: 'draft', submitter: pmEmployee },
      ],
    },
    {
      project: costProjects[2],
      items: [
        { subject: 'Connection detail clarification at typical beam-to-column', priority: 'medium', status: 'answered', submittedOffset: -22, answeredOffset: -9, response: 'Approved as submitted, no cost impact.', submitter: estimatingEmployees[1] },
        { subject: 'Anchor bolt layout — loading dock canopy', priority: 'high', status: 'answered', submittedOffset: -24, answeredOffset: -11, response: 'Revised anchor bolt pattern per SK-002, see attached sketch.', submitter: pmEmployee },
        { subject: 'Beam cope detail at cantilever condition', priority: 'high', status: 'submitted', submittedOffset: -7, requiredOffset: 3, submitter: estimatingEmployees[0] },
        { subject: 'Coating specification confirmation for interior exposed steel', priority: 'medium', status: 'draft', submitter: estimatingEmployees[1] },
      ],
    },
  ];

  const rfiPayloads = [];
  rfiProjectSeeds.forEach(({ project, items }) => {
    items.forEach((item, i) => {
      rfiPayloads.push({
        project_id: project.id,
        rfi_number: `RFI-${String(i + 1).padStart(3, '0')}`,
        subject: item.subject,
        status: item.status,
        priority: item.priority,
        submitted_by: item.submitter.full_name,
        ...(item.status !== 'draft' ? { date_submitted: daysFromNow(item.submittedOffset) } : {}),
        ...(item.requiredOffset != null ? { date_required: daysFromNow(item.requiredOffset) } : {}),
        ...(item.answeredOffset != null ? { date_answered: daysFromNow(item.answeredOffset) } : {}),
        response: item.response || '',
      });
    });
  });
  await db.entities.RFI.bulkCreate(rfiPayloads);

  // 18. Change Orders — 3 on complete, 3 on erection, 2 on fabrication
  const changeOrderProjectSeeds = [
    {
      project: costProjects[0],
      items: [
        { description: 'Added beam at grid line 5 per RFI resolution', status: 'Approved', cost_impact: 8500, schedule_impact: 0, dateOffset: -20 },
        { description: 'Owner-directed fireproofing upgrade to 2-hour rating', status: 'Approved', cost_impact: 15200, schedule_impact: 4, dateOffset: -14 },
        { description: 'Additional anchor bolts for equipment pad reinforcement', status: 'Approved', cost_impact: 4800, schedule_impact: 0, dateOffset: -8 },
      ],
    },
    {
      project: costProjects[1],
      items: [
        { description: 'Crane runway beam reinforcement', status: 'Approved', cost_impact: 18500, schedule_impact: 5, dateOffset: -16 },
        { description: 'Additional erection bracing for high bay', status: 'Approved', cost_impact: 6200, schedule_impact: 0, dateOffset: -10 },
        { description: 'Owner-directed canopy steel addition', status: 'Submitted to GC', cost_impact: 21800, schedule_impact: 3, dateOffset: -3 },
      ],
    },
    {
      project: costProjects[2],
      items: [
        { description: 'Revised connection design for loading dock canopy', status: 'Draft', cost_impact: 3800, schedule_impact: 0, dateOffset: -1 },
        { description: 'Additional shop drawings for owner-requested layout change', status: 'Submitted to GC', cost_impact: 10500, schedule_impact: 0, dateOffset: -4 },
      ],
    },
  ];

  const changeOrderPayloads = [];
  changeOrderProjectSeeds.forEach(({ project, items }) => {
    items.forEach((item, i) => {
      changeOrderPayloads.push({
        project_id: project.id,
        change_order_id: `CO-${String(i + 1).padStart(3, '0')}`,
        co_sequence_number: i + 1,
        description: item.description,
        status: item.status,
        cost_impact: item.cost_impact,
        total_change_order_value_cents: item.cost_impact * 100,
        schedule_impact: item.schedule_impact,
        date_submitted: daysFromNow(item.dateOffset),
      });
    });
  });
  await db.entities.change_orders.bulkCreate(changeOrderPayloads);

  // 19. Submittals — 4/3/3 across the 3 active projects
  const submittalProjectSeeds = [
    {
      project: costProjects[0],
      items: [
        { title: 'Structural Steel Shop Drawings', spec_section: '05 12 00 Structural Steel Framing', status: 'approved', submittedOffset: -28, returnedOffset: -18 },
        { title: 'Mill Certifications / MTRs', spec_section: '05 12 00 Structural Steel Framing', status: 'approved', submittedOffset: -25, returnedOffset: -15 },
        { title: 'Paint System Data Sheets', spec_section: '09 91 13 Exterior Painting', status: 'approved', submittedOffset: -20, returnedOffset: -10 },
        { title: 'Anchor Bolt Layout Plan', spec_section: '03 15 00 Anchor Bolts', status: 'approved', submittedOffset: -30, returnedOffset: -22 },
      ],
    },
    {
      project: costProjects[1],
      items: [
        { title: 'Structural Steel Shop Drawings', spec_section: '05 12 00 Structural Steel Framing', status: 'approved', submittedOffset: -26, returnedOffset: -16 },
        // Schema has no "Revise and Resubmit" status — 'rejected' is the closest real value; the note preserves the actual disposition.
        { title: 'Connection Design Calculations', spec_section: '05 50 00 Metal Fabrications', status: 'rejected', submittedOffset: -18, returnedOffset: -10, notes: 'Revise and resubmit — see reviewer comments.' },
        { title: 'Paint System Data Sheets', spec_section: '09 91 13 Exterior Painting', status: 'under_review', submittedOffset: -10, requiredOffset: 4 },
      ],
    },
    {
      project: costProjects[2],
      items: [
        { title: 'Mill Certifications / MTRs', spec_section: '05 12 00 Structural Steel Framing', status: 'under_review', submittedOffset: -8, requiredOffset: 6 },
        { title: 'Anchor Bolt Layout Plan', spec_section: '03 15 00 Anchor Bolts', status: 'approved', submittedOffset: -22, returnedOffset: -14 },
        { title: 'Connection Design Calculations', spec_section: '05 50 00 Metal Fabrications', status: 'draft' },
      ],
    },
  ];

  const submittalPayloads = [];
  let submittalCounter = 0;
  submittalProjectSeeds.forEach(({ project, items }) => {
    items.forEach((item) => {
      submittalCounter += 1;
      submittalPayloads.push({
        project_id: project.id,
        submittal_number: `SUB-${String(submittalCounter).padStart(3, '0')}`,
        title: item.title,
        spec_section: item.spec_section,
        status: item.status,
        ...(item.submittedOffset != null ? { date_submitted: daysFromNow(item.submittedOffset) } : {}),
        ...(item.requiredOffset != null ? { date_required: daysFromNow(item.requiredOffset) } : {}),
        ...(item.returnedOffset != null ? { date_returned: daysFromNow(item.returnedOffset) } : {}),
        ...(item.notes ? { notes: item.notes } : {}),
      });
    });
  });
  await db.entities.Submittal.bulkCreate(submittalPayloads);

  // 20. Pieces (Shop Floor) — 15 each on the fabrication and erection projects
  // pieces has no literal "fabricated/in_fab/pending/shipped" status field —
  // it's modeled via workflow_status + field_status + current_station_id.
  // seedStatus below is our own bookkeeping label, mapped to those real
  // fields, and kept alongside (not stored) so later sections know which
  // pieces need QA records / loads.
  function buildProjectPieces(projectId, statusPlan) {
    const shapeGroups = [
      { prefix: 'W', count: 6, shape: 'W-Beam', dims: ['W14x90', 'W18x35', 'W12x26', 'W16x40', 'W10x22', 'W14x30'], weights: [1980, 1240, 980, 1580, 720, 1080] },
      { prefix: 'C', count: 4, shape: 'C-Channel', dims: ['C10x20', 'C12x25', 'C9x15', 'C10x20'], weights: [640, 820, 460, 640] },
      { prefix: 'B', count: 3, shape: 'HSS Tube', dims: ['HSS6x6x1/4', 'HSS8x8x3/8', 'HSS4x4x1/4'], weights: [380, 590, 220] },
      { prefix: 'M', count: 2, shape: 'HSS Tube', dims: ['HSS3x3x1/4', 'HSS3x3x1/4'], weights: [210, 230] },
    ];
    const stationMap = {
      shipped: { workflow_status: 'Paint_Unlocked', field_status: 'On_Site', current_station_id: 6 },
      fabricated: { workflow_status: 'Paint_Unlocked', field_status: 'In_Shop', current_station_id: 5 },
      in_fab: { workflow_status: 'In_Fabrication', field_status: 'In_Shop', current_station_id: 3 },
      pending: { workflow_status: 'In_Fabrication', field_status: 'In_Shop', current_station_id: 1 },
    };
    const payloads = [];
    const statuses = [];
    let idx = 0;
    shapeGroups.forEach((group) => {
      for (let i = 1; i <= group.count; i++) {
        const seedStatus = statusPlan[idx];
        payloads.push({
          project_id: projectId,
          piece_mark: `${group.prefix}${i}`,
          material_shape: group.shape,
          dimensions: group.dims[i - 1],
          weight: group.weights[i - 1],
          ...stationMap[seedStatus],
        });
        statuses.push(seedStatus);
        idx += 1;
      }
    });
    return { payloads, statuses };
  }

  const fabricationStatusPlan = [...Array(8).fill('fabricated'), ...Array(4).fill('in_fab'), ...Array(3).fill('pending')];
  const erectionStatusPlan = Array(15).fill('shipped');

  const { payloads: fabricationPiecePayloads, statuses: fabricationStatuses } = buildProjectPieces(costProjects[2].id, fabricationStatusPlan);
  const { payloads: erectionPiecePayloads } = buildProjectPieces(costProjects[1].id, erectionStatusPlan);

  const fabricationPieces = await db.entities.pieces.bulkCreate(fabricationPiecePayloads);
  const erectionPieces = await db.entities.pieces.bulkCreate(erectionPiecePayloads);

  // 21. QA Inspections — one per piece that's fabricated or shipped
  // qa_inspections.stage only supports 1_Layout/2_Weld (no "final_fab") —
  // 2_Weld is the closest real stage to "final shop inspection before ship".
  // Likewise status only supports Approved/Failed (no "pending") — a couple
  // of the fabricated pieces are modeled as Failed (caught in QA, awaiting
  // rework) rather than inventing a status the schema doesn't have.
  const fabricatedOnlyPieces = fabricationPieces.filter((_, i) => fabricationStatuses[i] === 'fabricated');
  const qaCandidates = [...fabricatedOnlyPieces, ...erectionPieces];
  const qaDayOffsets = [-10, -9, -8, -7, -6, -5, -4, -3, -2];
  const qaInspectionPayloads = qaCandidates.map((piece, i) => ({
    piece_id: piece.id,
    stage: '2_Weld',
    inspector_id: shopManager.id,
    status: i < fabricatedOnlyPieces.length && (i === 1 || i === 4) ? 'Failed' : 'Approved',
    inspected_at: isoDaysFromNow(qaDayOffsets[i % qaDayOffsets.length]),
  }));
  await db.entities.qa_inspections.bulkCreate(qaInspectionPayloads);

  // 22. Loads & Shipping — erection project's 15 pieces across 3 loads of 5
  const loadDefs = [
    { pieces: erectionPieces.slice(0, 5), status: 'Delivered', dayOffset: -14, driver: { name: 'Sam Ortega', phone: '419-555-0177' } },
    { pieces: erectionPieces.slice(5, 10), status: 'Delivered', dayOffset: -7, driver: { name: 'Marcus Reyes', phone: '419-555-0198' } },
    { pieces: erectionPieces.slice(10, 15), status: 'In_Transit', dayOffset: -1, driver: { name: 'Dana Whitfield', phone: '419-555-0142' } },
  ];

  const loadPayloads = loadDefs.map((def, i) => ({
    project_id: costProjects[1].id,
    load_number_id: `LOAD-${String(i + 1).padStart(3, '0')}`,
    status: def.status,
    total_weight_lbs: def.pieces.reduce((sum, p) => sum + (p.weight || 0), 0),
    created_date: isoDaysFromNow(def.dayOffset),
  }));
  const loads = await db.entities.loads.bulkCreate(loadPayloads);

  const loadItemPayloads = [];
  loadDefs.forEach((def, li) => {
    def.pieces.forEach((piece, pi) => {
      loadItemPayloads.push({
        load_id: loads[li].id,
        piece_id: piece.id,
        sequence_number: pi + 1,
        status: 'Loaded',
      });
    });
  });
  await db.entities.load_items.bulkCreate(loadItemPayloads);

  await db.entities.shipping_manifests.bulkCreate(
    loadDefs.map((def, i) => ({
      load_id: loads[i].id,
      driver_name: def.driver.name,
      driver_phone: def.driver.phone,
      trailer_type: 'Flatbed',
    }))
  );

  // 23. Erection Fleet Assets
  // asset_type/status enums don't have telehandler/aerial_lift/active/maintenance
  // — mapped to the closest real values (Other for non-crane equipment,
  // Internal_Owned for company-owned gear); the Gradall is left off the
  // erection project's location to informally represent it being down.
  const [groveCrane, manitowocCrane] = await db.entities.erection_fleet_assets.bulkCreate([
    { asset_name: 'Grove RT760E Rough Terrain Crane', asset_type: 'Crane', status: 'Internal_Owned', runtime_hours: 847, project_location_id: costProjects[1].id, cost_per_hour: 185, cost_rate_type: 'owned', default_cost_code: 'EQP-001' },
    { asset_name: 'Manitowoc 14000 Lattice Boom Crane', asset_type: 'Crane', status: 'Internal_Owned', runtime_hours: 1203, project_location_id: costProjects[1].id, rental_rate_per_hour: 220, cost_rate_type: 'rented', default_cost_code: 'EQP-001' },
    { asset_name: 'Gradall XL4100 Telehandler', asset_type: 'Other', status: 'Internal_Owned', runtime_hours: 2341 },
    { asset_name: 'JLG 600S Boom Lift', asset_type: 'Other', status: 'Internal_Owned', runtime_hours: 412, project_location_id: costProjects[1].id },
  ]);

  // 23b. Equipment Usage Logs — Grove (owned, $185/hr) and Manitowoc (rented,
  // $220/hr) usage on the erection project over the last 3 weeks, each
  // mirroring what the Equipment Usage tab's "Log & Post to Job Cost" action
  // does: one EquipmentUsageLog plus a matching JobCostLedgerEntry.
  const equipmentUsageSeeds = [
    { asset: groveCrane, hours: 8, dayOffset: -20 },
    { asset: groveCrane, hours: 6, dayOffset: -15 },
    { asset: groveCrane, hours: 10, dayOffset: -9 },
    { asset: groveCrane, hours: 8, dayOffset: -3 },
    { asset: manitowocCrane, hours: 12, dayOffset: -17 },
    { asset: manitowocCrane, hours: 8, dayOffset: -6 },
  ];
  for (const seed of equipmentUsageSeeds) {
    const rate = seed.asset.cost_rate_type === 'owned' ? seed.asset.cost_per_hour : seed.asset.rental_rate_per_hour;
    const totalCost = seed.hours * rate;
    const usageDate = daysFromNow(seed.dayOffset);
    const description = `${seed.asset.asset_name} — ${seed.hours} hrs @ $${rate}/hr`;
    const log = await db.entities.EquipmentUsageLog.create({
      asset_id: seed.asset.id,
      project_id: costProjects[1].id,
      usage_date: usageDate,
      hours_used: seed.hours,
      cost_code: seed.asset.default_cost_code,
      rate_used: rate,
      total_cost: totalCost,
      description,
    });
    const ledgerEntry = await db.entities.JobCostLedgerEntry.create({
      project_id: costProjects[1].id,
      cost_code: seed.asset.default_cost_code,
      cost_class: 'EQP',
      amount: totalCost,
      transaction_date: usageDate,
      source_type: 'equipment',
      source_id: log.id,
      description,
    });
    await db.entities.EquipmentUsageLog.update(log.id, { posted_to_job_cost: true, job_cost_entry_id: ledgerEntry.id });
  }

  // 24. Attendance Punches — 20 in/out pairs per employee across the last 4 work-weeks
  const weekdayOffsets = lastNWeekdayOffsets(20);
  const attendancePayloads = [];
  employees.forEach((emp, empIdx) => {
    const isShop = emp.department === 'Shop/Fabrication';
    const isField = emp.department === 'Field/Erection';
    const project_id = isShop ? costProjects[2].id : isField ? costProjects[1].id : undefined;
    const labor_activity_category = isShop ? 'Shop_Fab' : isField ? 'Field_Erection' : undefined;
    weekdayOffsets.forEach((offset, dayIdx) => {
      const inMinute = (empIdx * 7 + dayIdx * 3) % 30;
      const outMinute = (empIdx * 5 + dayIdx * 2) % 30;
      const inDate = new Date();
      inDate.setDate(inDate.getDate() + offset);
      inDate.setHours(6, inMinute, 0, 0);
      const outDate = new Date();
      outDate.setDate(outDate.getDate() + offset);
      outDate.setHours(15, outMinute, 0, 0);
      attendancePayloads.push({
        employee_id: emp.id,
        punch_type: 'Clock_In',
        punch_time: inDate.toISOString(),
        ...(project_id ? { project_id } : {}),
        ...(labor_activity_category ? { labor_activity_category } : {}),
      });
      attendancePayloads.push({
        employee_id: emp.id,
        punch_type: 'Clock_Out',
        punch_time: outDate.toISOString(),
        total_regular_minutes: 540,
        ...(project_id ? { project_id } : {}),
        ...(labor_activity_category ? { labor_activity_category } : {}),
      });
    });
  });
  await db.entities.attendance_punches.bulkCreate(attendancePayloads);

  // 25. Employee Certifications
  // cert_type enum has no "AWS D1.1"/"Ironworker Journeyman Card"/"PMP" —
  // mapped to the closest real trade certs (Welding_6G, Rigging); PMP has no
  // sensible mapping in this safety-cert-focused enum, so it's skipped rather
  // than forcing a nonexistent value into a field that models something else.
  const certSeeds = [
    { employee: shopEmployees.find((e) => e.full_name === 'James Anderson'), cert_type: 'OSHA_10', issuedOffset: -600, expirationOffset: 700 },
    { employee: shopEmployees.find((e) => e.full_name === 'Robert Kim'), cert_type: 'OSHA_10', issuedOffset: -500, expirationOffset: 600 },
    { employee: shopEmployees.find((e) => e.full_name === 'Robert Kim'), cert_type: 'Welding_6G', issuedOffset: -400, expirationOffset: 550 },
    { employee: fieldEmployees.find((e) => e.full_name === 'Carlos Ramirez'), cert_type: 'OSHA_30', issuedOffset: -700, expirationOffset: 500 },
    { employee: fieldEmployees.find((e) => e.full_name === 'Carlos Ramirez'), cert_type: 'Rigging', issuedOffset: -337, expirationOffset: 28, statusOverride: 'Expiring_Soon' },
    { employee: fieldEmployees.find((e) => e.full_name === "Brian O'Connell"), cert_type: 'OSHA_30', issuedOffset: -800, expirationOffset: 600 },
    { employee: fieldEmployees.find((e) => e.full_name === "Brian O'Connell"), cert_type: 'Rigging', issuedOffset: -300, expirationOffset: 450 },
    { employee: pmEmployee, cert_type: 'OSHA_30', issuedOffset: -900, expirationOffset: 500 },
    { employee: shopManager, cert_type: 'OSHA_30', issuedOffset: -850, expirationOffset: 520 },
  ];
  await db.entities.employee_certifications.bulkCreate(
    certSeeds.map((c) => ({
      employee_id: c.employee.id,
      cert_type: c.cert_type,
      cert_number: `${c.cert_type}-${c.employee.employee_number}`,
      issued_date: daysFromNow(c.issuedOffset),
      expiration_date: daysFromNow(c.expirationOffset),
      status: c.statusOverride || 'Valid',
    }))
  );

  // 26. Credit Card Expenses
  const OFFICE_CARD = '4821';
  const FIELD_CARD = '7734';
  const expenseSeeds = [
    { employee: hrEmployee, merchant_name: 'Office Depot', category: 'Other', amount: 67.50, card: OFFICE_CARD, dayOffset: -26 },
    { employee: accountant, merchant_name: 'Staples', category: 'Other', amount: 124.30, card: OFFICE_CARD, dayOffset: -19 },
    { employee: fieldEmployees[0], merchant_name: 'Speedway Fuel', category: 'Fuel', amount: 215.40, card: FIELD_CARD, project: costProjects[1], dayOffset: -13 },
    { employee: fieldEmployees[1], merchant_name: 'Pilot Travel Center', category: 'Fuel', amount: 298.75, card: FIELD_CARD, project: costProjects[1], dayOffset: -6 },
    { employee: shopEmployees[0], merchant_name: 'Marathon Gas', category: 'Fuel', amount: 156.20, card: FIELD_CARD, project: costProjects[2], dayOffset: -22 },
    { employee: shopEmployees[1], merchant_name: 'Harbor Freight Tools', category: 'Other', amount: 342.10, card: FIELD_CARD, project: costProjects[2], dayOffset: -17 },
    { employee: shopEmployees[0], merchant_name: 'Grainger Industrial Supply', category: 'Other', amount: 198.65, card: FIELD_CARD, project: costProjects[2], dayOffset: -9 },
    { employee: pmEmployee, merchant_name: 'Panera Bread', category: 'Meals', amount: 62.40, card: OFFICE_CARD, project: costProjects[1], dayOffset: -12 },
    { employee: fieldEmployees[1], merchant_name: 'Texas Roadhouse', category: 'Meals', amount: 78.90, card: FIELD_CARD, project: costProjects[1], dayOffset: -7, outOfTown: true },
    { employee: fieldEmployees[0], merchant_name: 'Hampton Inn Cleveland', category: 'Lodging', amount: 172.00, card: FIELD_CARD, project: costProjects[1], dayOffset: -14, outOfTown: true, perDiem: 65 },
    { employee: fieldEmployees[1], merchant_name: 'Hampton Inn Cleveland', category: 'Lodging', amount: 189.50, card: FIELD_CARD, project: costProjects[1], dayOffset: -7, outOfTown: true, perDiem: 65 },
    { employee: shopManager, merchant_name: 'Office Depot', category: 'Other', amount: 89.20, card: OFFICE_CARD, dayOffset: -24 },
    { employee: shopManager, merchant_name: 'BP Gas Station', category: 'Fuel', amount: 178.30, card: OFFICE_CARD, project: costProjects[2], dayOffset: -15 },
    { employee: shopEmployees[1], merchant_name: 'Fastenal', category: 'Other', amount: 415.00, card: FIELD_CARD, project: costProjects[2], dayOffset: -4 },
    { employee: estimatingEmployees[0], merchant_name: 'Subway', category: 'Meals', amount: 48.75, card: OFFICE_CARD, project: costProjects[1], dayOffset: -18 },
  ];
  await db.entities.credit_card_expenses.bulkCreate(
    expenseSeeds.map((e) => ({
      employee_id: e.employee.id,
      ...(e.project ? { project_id: e.project.id } : {}),
      card_last4: e.card,
      merchant_name: e.merchant_name,
      expense_category: e.category,
      amount_cents: Math.round(e.amount * 100),
      expense_date: daysFromNow(e.dayOffset),
      ...(e.outOfTown ? { is_out_of_town_travel: true, per_diem_allowance_cents: Math.round((e.perDiem || 65) * 100) } : {}),
      status: 'Approved',
    }))
  );

  // 27. Historical Variance — won bids whose project is complete or in erection
  const historicalVarianceSeeds = [
    { bid: wonBidsForProjects[0], project: projects[0], estimatedTons: 185, actualTonsPct: 1.08, estimatedHours: 9200, actualHoursPct: 1.06, geometry: 'moment_frame', completedOffset: -5 },
    { bid: wonBidsForProjects[1], project: projects[1], estimatedTons: 140, actualTonsPct: 0.91, estimatedHours: 7100, actualHoursPct: 0.94, geometry: 'braced_frame', completedOffset: -2 },
  ];
  await db.entities.HistoricalVariance.bulkCreate(
    historicalVarianceSeeds.map((v) => {
      const actual_tons = Math.round(v.estimatedTons * v.actualTonsPct);
      const actual_man_hours = Math.round(v.estimatedHours * v.actualHoursPct);
      const tonsVariancePct = ((actual_tons - v.estimatedTons) / v.estimatedTons) * 100;
      const hoursVariancePct = ((actual_man_hours - v.estimatedHours) / v.estimatedHours) * 100;
      const overall_variance_pct = Math.round(((tonsVariancePct + hoursVariancePct) / 2) * 10) / 10;
      return {
        bid_id: v.bid.id,
        project_id: v.project.id,
        bid_number: v.bid.bid_number,
        project_number: v.project.project_number,
        structural_geometry_type: v.geometry,
        estimated_tons: v.estimatedTons,
        actual_tons,
        estimated_man_hours: v.estimatedHours,
        actual_man_hours,
        overall_variance_pct,
        auto_adjuster_alert: Math.abs(overall_variance_pct) > 7,
        adjuster_suggestion_pct: Math.abs(overall_variance_pct) > 7 ? Math.round(overall_variance_pct) : 0,
        completed_date: daysFromNow(v.completedOffset),
      };
    })
  );

  // 28. Recurring Cash Items
  const recurringCashSeeds = [
    { label: 'Bi-Weekly Payroll', amount: 38500, direction: 'Outflow', frequency: 'Biweekly', next_occurrence_date: daysFromNow(5), is_active: true },
    { label: 'Office & Facility Rent', amount: 4200, direction: 'Outflow', frequency: 'Monthly', next_occurrence_date: daysFromNow(12), is_active: true },
    { label: 'Equipment Lease Payment', amount: 8750, direction: 'Outflow', frequency: 'Monthly', next_occurrence_date: daysFromNow(8), is_active: true },
  ];
  await db.entities.RecurringCashItem.bulkCreate(recurringCashSeeds);

  // 29. Notifications — for whoever is running the seeder (Notification is read by user_id)
  const currentUser = await db.auth.me().catch(() => null);
  const notificationSeeds = [
    { text: 'RFI-003 response overdue — 3 days past contractual window', type: 'rfi_update', is_read: false, dayOffset: -1 },
    { text: 'Change Order CO-003 approved by Buckeye Construction Group', type: 'success', is_read: true, dayOffset: -3 },
    { text: 'Ironworker certification expiring in 28 days — Carlos Ramirez', type: 'warning', is_read: false, dayOffset: -1 },
    { text: 'Load #3 departed yard — 5 pieces in transit to Cleveland', type: 'info', is_read: true, dayOffset: -1 },
    { text: 'Monthly budget variance: LAB category 8% over budget YTD', type: 'warning', is_read: false, dayOffset: 0 },
  ];
  if (currentUser) {
    await db.entities.Notification.bulkCreate(
      notificationSeeds.map((n) => ({
        user_id: currentUser.id,
        title: n.text,
        message: n.text,
        type: n.type,
        is_read: n.is_read,
        created_date: isoDaysFromNow(n.dayOffset),
      }))
    );
  }

  // 30. Subcontracts, Pay Apps, and Lien Waivers — on the erection project
  // (costProjects[1]), covering the full scope-to-final-payment lifecycle:
  // one fully-paid pay app (with both a conditional waiver at submission and
  // an unconditional waiver once payment cleared — real lien-waiver practice
  // issues both), one approved-but-unpaid pay app (conditional waiver only,
  // since payment hasn't cleared yet), and one freshly-received pay app with
  // no waiver yet, on purpose, so the compliance summary has nothing to flag
  // for it. Superior Painting's single pay app is deliberately still
  // unapproved so its subcontract's own insurance/W-9 gaps stay visible too.
  const [midwestIronworkers, superiorPainting] = await db.entities.Vendor.bulkCreate([
    { name: 'Midwest Ironworkers LLC', vendor_type: 'subcontractor', is_active: true },
    { name: 'Superior Painting Co', vendor_type: 'subcontractor', is_active: true },
  ]);

  const [midwestSubcontract, superiorSubcontract] = await db.entities.Subcontract.bulkCreate([
    {
      project_id: costProjects[1].id,
      vendor_id: midwestIronworkers.id,
      subcontractor_name: 'Midwest Ironworkers LLC',
      scope_description: 'Structural steel erection — full building frame, per approved erection drawings.',
      subcontract_number: `SC-${currentYear}-001`,
      contract_value: 285000,
      executed_date: daysFromNow(-45),
      start_date: daysFromNow(-30),
      status: 'executed',
      retention_pct: 0.10,
      insurance_verified: true,
      insurance_expiry_date: daysFromNow(300),
      w9_on_file: true,
      bonded: false,
      scope_of_work: 'erection',
    },
    {
      project_id: costProjects[1].id,
      vendor_id: superiorPainting.id,
      subcontractor_name: 'Superior Painting Co',
      scope_description: 'Field touch-up painting for erected structural steel.',
      subcontract_number: `SC-${currentYear}-002`,
      contract_value: 42000,
      executed_date: daysFromNow(-20),
      start_date: daysFromNow(-10),
      status: 'active',
      retention_pct: 0.10,
      insurance_verified: false,
      w9_on_file: false,
      bonded: false,
      scope_of_work: 'painting',
    },
  ]);

  const [midwestPayApp1, midwestPayApp2, midwestPayApp3] = await db.entities.SubcontractPayApp.bulkCreate([
    {
      subcontract_id: midwestSubcontract.id,
      project_id: costProjects[1].id,
      pay_app_number: 1,
      period_start: daysFromNow(-28),
      period_end: daysFromNow(-14),
      amount_requested: 95000,
      amount_approved: 95000,
      retention_held: 9500,
      status: 'paid',
      date_received: daysFromNow(-12),
      date_approved: daysFromNow(-9),
      date_paid: daysFromNow(-5),
      lien_waiver_received: true,
      lien_waiver_type: 'unconditional',
    },
    {
      subcontract_id: midwestSubcontract.id,
      project_id: costProjects[1].id,
      pay_app_number: 2,
      period_start: daysFromNow(-14),
      period_end: daysFromNow(-1),
      amount_requested: 85000,
      amount_approved: 85000,
      retention_held: 8500,
      status: 'approved',
      date_received: daysFromNow(-6),
      date_approved: daysFromNow(-2),
      lien_waiver_received: true,
      lien_waiver_type: 'conditional',
    },
    {
      subcontract_id: midwestSubcontract.id,
      project_id: costProjects[1].id,
      pay_app_number: 3,
      period_start: daysFromNow(-1),
      period_end: daysFromNow(13),
      amount_requested: 75000,
      amount_approved: 0,
      retention_held: 0,
      status: 'received',
      date_received: daysFromNow(0),
      lien_waiver_received: false,
      lien_waiver_type: 'none',
    },
  ]);

  const superiorPayApp1 = await db.entities.SubcontractPayApp.create({
    subcontract_id: superiorSubcontract.id,
    project_id: costProjects[1].id,
    pay_app_number: 1,
    period_start: daysFromNow(-10),
    period_end: daysFromNow(4),
    amount_requested: 14000,
    amount_approved: 0,
    retention_held: 0,
    status: 'received',
    date_received: daysFromNow(-3),
    lien_waiver_received: false,
    lien_waiver_type: 'none',
  });

  const lienWaiverSeeds = [
    {
      subcontract_id: midwestSubcontract.id,
      project_id: costProjects[1].id,
      pay_app_id: midwestPayApp1.id,
      waiver_type: 'conditional_progress',
      amount: 95000,
      through_date: daysFromNow(-14),
      date_received: daysFromNow(-12),
      is_notarized: false,
      status: 'received',
    },
    {
      subcontract_id: midwestSubcontract.id,
      project_id: costProjects[1].id,
      pay_app_id: midwestPayApp1.id,
      waiver_type: 'unconditional_progress',
      amount: 95000,
      through_date: daysFromNow(-14),
      date_received: daysFromNow(-5),
      date_notarized: daysFromNow(-5),
      is_notarized: true,
      status: 'verified',
    },
    {
      subcontract_id: midwestSubcontract.id,
      project_id: costProjects[1].id,
      pay_app_id: midwestPayApp2.id,
      waiver_type: 'conditional_progress',
      amount: 85000,
      through_date: daysFromNow(-1),
      date_received: daysFromNow(-2),
      is_notarized: false,
      status: 'received',
    },
  ];
  await db.entities.LienWaiver.bulkCreate(lienWaiverSeeds);

  // Mirrors what the Subcontracts page's "Mark Paid" action does automatically
  // for Pay App #1, so the demo job cost ledger already reflects it.
  await db.entities.JobCostLedgerEntry.create({
    project_id: costProjects[1].id,
    cost_code: midwestSubcontract.subcontract_number,
    cost_class: 'SUB',
    amount: midwestPayApp1.amount_approved,
    transaction_date: midwestPayApp1.date_paid,
    source_type: 'subcontract',
    source_id: midwestPayApp1.id,
    description: `Midwest Ironworkers LLC Pay App #${midwestPayApp1.pay_app_number}`,
  });

  return {
    skipped: false,
    counts: {
      employees: employees.length,
      bids: bids.length,
      projects: projects.length,
      jobCostEntries: ledgerPayloads.length,
      bankAccounts: 2,
      bankTransactions: bankTransactionPayloads.length,
      vendorBills: vendorBillSeeds.length,
      invoiceReceivables: invoiceReceivableSeeds.length,
      reviewChecklistItems: reviewChecklistSeeds.length,
      customers: customerSeeds.length,
      contracts: contractSeeds.length,
      sovLines: sovPayloads.length,
      rfis: rfiPayloads.length,
      changeOrders: changeOrderPayloads.length,
      submittals: submittalPayloads.length,
      pieces: fabricationPiecePayloads.length + erectionPiecePayloads.length,
      qaInspections: qaInspectionPayloads.length,
      loads: loadPayloads.length,
      loadItems: loadItemPayloads.length,
      shippingManifests: loadDefs.length,
      fleetAssets: 4,
      equipmentUsageLogs: equipmentUsageSeeds.length,
      attendancePunches: attendancePayloads.length,
      employeeCertifications: certSeeds.length,
      creditCardExpenses: expenseSeeds.length,
      historicalVariances: historicalVarianceSeeds.length,
      recurringCashItems: recurringCashSeeds.length,
      notifications: currentUser ? notificationSeeds.length : 0,
      subcontracts: 2,
      subcontractPayApps: 4,
      lienWaivers: lienWaiverSeeds.length,
    },
  };
}
