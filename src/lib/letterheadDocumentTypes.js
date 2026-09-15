// Single source of truth for every PDF export type a CompanyLetterhead can
// be assigned to — the Admin letterhead manager's checkbox list is built
// straight from this, and CompanyLetterhead.applies_to values are always one
// of these keys. Built by grepping every jsPDF generator in the app (see
// AGENTS.md-adjacent audit notes in the letterhead feature's commit) rather
// than guessed — re-grep for `new jsPDF(` before adding a new export type
// without updating this list, so it never silently drifts out of sync with
// what the app can actually produce.
//
// Every entry is 'document' mechanism = generated directly with jsPDF
// (drawn text/tables) — the letterhead image REPLACES that generator's own
// logo/company-name header block when active (see letterheadPdf.js's
// drawLetterheadIfActive). There used to be a 'snapshot' group routed
// through an html2canvas DOM-screenshot helper (exportNodeToPdf.js), but
// that mechanism only ever produced a picture of the screen rather than a
// real data report — every one of those call sites was rebuilt as a proper
// jsPDF generator and exportNodeToPdf.js was deleted, so 'snapshot' no
// longer exists as a category here.
export const LETTERHEAD_DOCUMENT_TYPES = [
  // Bids, proposals & customer-facing paperwork
  { key: 'bid_proposal', label: 'Bid Proposal', category: 'Bids & Proposals', mechanism: 'document', source: 'bidProposalPdf.js' },
  { key: 'bid_internal_breakdown', label: 'Bid Internal Breakdown', category: 'Bids & Proposals', mechanism: 'document', source: 'bidInternalBreakdownPdf.js' },
  { key: 'material_requisition', label: 'Material Takeoff Requisition', category: 'Bids & Proposals', mechanism: 'document', source: 'requisitionPdfExport.js' },
  { key: 'delay_impact_notice', label: 'Delay Impact Notice', category: 'Bids & Proposals', mechanism: 'document', source: 'delayNoticePdf.js' },
  { key: 'submittal_transmittal', label: 'Submittal Transmittal', category: 'Bids & Proposals', mechanism: 'document', source: 'submittalTransmittalPdf.js' },

  // Shipping & field paperwork
  { key: 'bol', label: 'Bill of Lading (BOL)', category: 'Shipping & Field', mechanism: 'document', source: 'bolPdf.js' },
  { key: 'certified_payroll_wh347', label: 'Certified Payroll (WH-347)', category: 'Shipping & Field', mechanism: 'document', source: 'certifiedPayrollReportPdf.js' },

  // Project reviews
  { key: 'turnover_review', label: 'Turnover Review', category: 'Project Reviews', mechanism: 'document', source: 'turnoverReviewPdf.js' },
  { key: 'scope_review', label: 'Scope Review', category: 'Project Reviews', mechanism: 'document', source: 'scopeReviewPdf.js' },
  { key: 'material_optimization_report', label: 'Material Optimization Report', category: 'Project Reviews', mechanism: 'document', source: 'materialOptimizationReportPdf.js' },
  { key: 'detailer_import_batch_review', label: 'Detailer Import Batch Review', category: 'Project Reviews', mechanism: 'document', source: 'detailerImportBatchReviewPdf.js' },

  // Accounting & financial reports
  { key: 'customer_statement', label: 'Customer Statement', category: 'Accounting Reports', mechanism: 'document', source: 'customerStatementPdf.js' },
  { key: 'job_cost_detail_project', label: 'Job Cost Detail — Project', category: 'Accounting Reports', mechanism: 'document', source: 'jobCostDetailPdf.js' },
  { key: 'job_cost_detail_company_wide', label: 'Job Cost Detail — Company-Wide Rollup', category: 'Accounting Reports', mechanism: 'document', source: 'jobCostDetailPdf.js' },
  { key: 'job_costing_summary', label: 'Job Costing Summary', category: 'Accounting Reports', mechanism: 'document', source: 'jobCostingSummaryPdf.js' },
  { key: 'vendor_bills', label: 'Vendor Bills (AP)', category: 'Accounting Reports', mechanism: 'document', source: 'vendorBillsPdf.js' },
  { key: 'cash_reconciliation', label: 'Cash Reconciliation', category: 'Accounting Reports', mechanism: 'document', source: 'cashReconciliationPdf.js' },
  { key: 'cash_forecast', label: '90-Day Cash Forecast', category: 'Accounting Reports', mechanism: 'document', source: 'cashForecastPdf.js' },
  { key: 'incoming_ach', label: 'Incoming ACH', category: 'Accounting Reports', mechanism: 'document', source: 'incomingAchPdf.js' },
  { key: 'unapplied_cash', label: 'Unapplied Cash', category: 'Accounting Reports', mechanism: 'document', source: 'unappliedCashPdf.js' },
  { key: 'month_end_close', label: 'Month-End Close', category: 'Accounting Reports', mechanism: 'document', source: 'monthEndClosePdf.js' },
  { key: 'budget', label: 'Budget', category: 'Accounting Reports', mechanism: 'document', source: 'budgetPdf.js' },
  { key: 'ar_billing', label: 'AR & Billings', category: 'Accounting Reports', mechanism: 'document', source: 'arBillingPdf.js' },
  { key: 'wip_report', label: 'WIP Report', category: 'Accounting Reports', mechanism: 'document', source: 'wipReportPdf.js' },
  { key: 'ai_financial_flags', label: 'AI Financial Flags', category: 'Accounting Reports', mechanism: 'document', source: 'aiFinancialFlagsPdf.js' },
  { key: 'exec_wip_radar', label: 'Executive — WIP Radar', category: 'Accounting Reports', mechanism: 'document', source: 'wipRadarPdf.js' },
  { key: 'exec_wip_overbilling_underbilling', label: 'Executive — Over/Under-billing', category: 'Accounting Reports', mechanism: 'document', source: 'wipOverUnderBillingPdf.js' },
  { key: 'exec_ar_ap_aging_summary', label: 'Executive — AR/AP Aging Summary', category: 'Accounting Reports', mechanism: 'document', source: 'execArApAgingPdf.js' },
  { key: 'exec_cash_position', label: 'Executive — Cash Position', category: 'Accounting Reports', mechanism: 'document', source: 'execCashPositionPdf.js' },
  { key: 'exec_quarterly_tax_exposure', label: 'Executive — Quarterly Tax Exposure', category: 'Accounting Reports', mechanism: 'document', source: 'execQuarterlyTaxExposurePdf.js' },

  // Sales / estimating analytics & lists
  { key: 'exec_bid_win_loss', label: 'Executive — Bid Win/Loss', category: 'Sales & Estimating Reports', mechanism: 'document', source: 'execBidWinLossPdf.js' },
  { key: 'exec_estimating_performance', label: 'Executive — Estimating Performance', category: 'Sales & Estimating Reports', mechanism: 'document', source: 'execEstimatingPerformancePdf.js' },
  { key: 'exec_sales_pipeline_commission', label: 'Executive — Sales Pipeline & Commission', category: 'Sales & Estimating Reports', mechanism: 'document', source: 'execSalesPipelineCommissionPdf.js' },
  { key: 'estimating_active_bids', label: 'Estimating — Active Bids List', category: 'Sales & Estimating Reports', mechanism: 'document', source: 'estimatingActiveBidsPdf.js' },
  { key: 'estimating_bid_history', label: 'Estimating — Bid History (Won & Lost)', category: 'Sales & Estimating Reports', mechanism: 'document', source: 'estimatingBidHistoryPdf.js' },
  { key: 'estimating_did_not_bid', label: 'Estimating — Did Not Bid List', category: 'Sales & Estimating Reports', mechanism: 'document', source: 'estimatingDidNotBidPdf.js' },
  { key: 'estimating_shop_hours_variance', label: 'Estimating — Estimated vs. Shop Hours', category: 'Sales & Estimating Reports', mechanism: 'document', source: 'estimatingShopHoursVariancePdf.js' },

  // Shop / HR / quality
  { key: 'exec_shop_production', label: 'Executive — Shop Production', category: 'Shop, HR & Quality Reports', mechanism: 'document', source: 'execShopProductionPdf.js' },
  { key: 'exec_headcount', label: 'Executive — Headcount', category: 'Shop, HR & Quality Reports', mechanism: 'document', source: 'execHeadcountPdf.js' },
  { key: 'quality_kpi_report', label: 'Quality KPI Report', category: 'Shop, HR & Quality Reports', mechanism: 'document', source: 'qualityKpiReportPdf.js' },
  { key: 'hr_candidate_application', label: 'HR — Candidate Application', category: 'Shop, HR & Quality Reports', mechanism: 'document', source: 'candidateApplicationPdf.js' },
];

export const LETTERHEAD_DOCUMENT_TYPE_KEYS = LETTERHEAD_DOCUMENT_TYPES.map((t) => t.key);

export const LETTERHEAD_DOCUMENT_CATEGORIES = [...new Set(LETTERHEAD_DOCUMENT_TYPES.map((t) => t.category))];
