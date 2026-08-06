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
    },
  };
}
