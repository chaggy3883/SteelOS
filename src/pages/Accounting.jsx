import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { DollarSign, TrendingUp, AlertCircle, Brain, BarChart3, Plus, Pencil, Trash2, Receipt, FileText, Gauge, Download, Webhook, Landmark, ListChecks, ClipboardList, UploadCloud, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { normalizeRoleName } from '@/components/dashboard/rbacConfig';
import { isAdminUser } from '@/lib/tenantContext';
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { runThreeWayMatch } from '@/lib/threeWayMatch';
import { calculateWIPSchedule } from '@/lib/wipCalculations';
import { handleProcorePayWebhook, handleTexturaWebhook } from '@/lib/webhookHandlers';
import { exportToQuickBooksCSV, exportToSage100CSV } from '@/lib/glExport';
import CashManagementPanel from '@/components/accounting/CashManagementPanel';
import CashForecastPanel from '@/components/accounting/CashForecastPanel';
import MonthEndClosePanel from '@/components/accounting/MonthEndClosePanel';
import BudgetPanel from '@/components/accounting/BudgetPanel';
import LedgerDrilldownModal from '@/components/accounting/LedgerDrilldownModal';
import VendorBillDetailModal from '@/components/accounting/VendorBillDetailModal';
import InvoiceReceivableDetailModal from '@/components/accounting/InvoiceReceivableDetailModal';
import PurchaseOrderDetailModal from '@/components/purchasing/PurchaseOrderDetailModal';

const COST_CLASSES = ['LAB', 'MAT', 'SUB', 'DEB', 'OTH', 'FRT', 'OFB'];
const LEDGER_COST_CLASSES = ['MAT', 'SUB', 'EQP', 'LAB'];
const VENDOR_TYPES = ['subcontractor', 'supplier', 'equipment_rental', 'other'];
const BILLING_STATUSES = ['Draft', 'Submitted', 'Approved', 'Released'];

// Tab-level RBAC. Every role string below is a REAL entry in BUILTIN_ROLES
// (src/components/dashboard/rbacConfig.jsx) — verified against that list, not
// guessed. admin/super_admin are NOT listed here on purpose: they bypass this
// map entirely via isAdminUser() in canAccessTab() below, so full access for
// those two roles can't be accidentally dropped by editing this table.
//
// This financial page is restricted to roles with an actual accounting
// function (Controller, Finance, executives) plus Project Manager for the
// job-costing/WIP/billing tabs they own day-to-day. hr_admin and
// payroll_admin currently have module-level access to /accounting (see
// BUILTIN_ROLES) for payroll-adjacent reporting elsewhere, but none of the
// tabs on THIS page (AP, AR, cash, GL close) are HR/payroll data — so by
// design they see none of them here and land on the access-denied state.
const TAB_ROLES = {
  jobs: ['project_manager', 'finance_department', 'controller', 'president', 'ceo'],
  jobcostdetail: ['project_manager', 'finance_department', 'controller', 'president', 'ceo'],
  vendorbills: ['finance_department', 'controller', 'president', 'ceo'],
  cash: ['finance_department', 'controller', 'president', 'ceo'],
  close: ['finance_department', 'controller', 'president', 'ceo'],
  budget: ['project_manager', 'finance_department', 'controller', 'president', 'ceo'],
  arbilling: ['project_manager', 'finance_department', 'controller', 'president', 'ceo'],
  wip: ['project_manager', 'finance_department', 'controller', 'president', 'ceo'],
  ai: ['project_manager', 'finance_department', 'controller', 'president', 'ceo'],
};
const TAB_ORDER = ['jobs', 'jobcostdetail', 'vendorbills', 'cash', 'close', 'budget', 'arbilling', 'wip', 'ai'];

const CONTRACT_FIELDS = [
  { key: 'original_contract', label: 'Original Contract' },
  { key: 'change_orders_to_date', label: 'Change Orders to Date' },
  { key: 'billed_to_date', label: 'Billed to Date' },
  { key: 'retainage', label: 'Retainage' },
  { key: 'net_billings', label: 'Net Billings' },
  { key: 'cash_received', label: 'Cash Received' },
  { key: 'left_to_bill', label: 'Left to Bill' },
];

function emptyRowForm() {
  return {
    cost_code: '', description: '', cost_class: 'LAB',
    original_estimate: 0, approved_co: 0, revised_estimated_cost: 0,
    jtd_hours: 0, jtd_costs: 0, profit_loss: 0,
  };
}

function emptyVendorForm() {
  return { name: '', vendor_type: 'supplier', contact_name: '', phone: '', email: '', portal_enabled: false, portal_email: '', portal_password: '' };
}

function emptyBillForm() {
  return { vendor_id: '', po_id: '', invoice_number: '', invoice_date: '', due_date: '', gross_amount: 0, conditional_waiver_signed: false, unconditional_waiver_received: false };
}

function emptySovForm() {
  return { item_description: '', cost_code: '', original_scheduled_value: 0, completion_percentage: 0, current_billed_amount: 0, retainage_rate: 0.10 };
}

function emptyInvoiceForm() {
  return { billing_period: '', expected_payment_date: '', gross_amount: 0, retainage_held: 0, payment_status: 'Draft' };
}

function emptyLedgerForm() {
  return { cost_code: '', cost_class: 'MAT', amount: 0, transaction_date: '', source_type: 'other', description: '' };
}

export default function Accounting() {
  const { toast } = useToast();
  const navigate = useNavigate();

  // --- Drill-down targets (standing rule: every data point navigates to its
  // full underlying detail). Kept separate from the existing edit-form state
  // above/below since these are read-only detail views, not edit forms. ---
  const [ledgerModal, setLedgerModal] = useState({ open: false, title: '', entries: [], emptyMessage: undefined });
  const [viewingBillId, setViewingBillId] = useState(null);
  const [viewingInvoiceId, setViewingInvoiceId] = useState(null);
  const [viewingPOId, setViewingPOId] = useState(null);
  const [jobsRiskFilter, setJobsRiskFilter] = useState(false);
  const [findingsProjectFilter, setFindingsProjectFilter] = useState(null);

  const openLedgerDrilldown = (title, entries, emptyMessage) => setLedgerModal({ open: true, title, entries, emptyMessage });
  const closeLedgerDrilldown = () => setLedgerModal((m) => ({ ...m, open: false }));

  const [currentUser, setCurrentUser] = useState(null);
  const [userRoles, setUserRoles] = useState([]);
  const [accessChecked, setAccessChecked] = useState(false);
  const [activeTab, setActiveTab] = useState(null);

  const [projects, setProjects] = useState([]);
  const [findings, setFindings] = useState([]);
  const [loading, setLoading] = useState(true);

  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [jobCostRows, setJobCostRows] = useState([]);
  const [loadingJobCost, setLoadingJobCost] = useState(false);
  const [editingRow, setEditingRow] = useState(null);
  const [rowForm, setRowForm] = useState(emptyRowForm());
  const [savingRow, setSavingRow] = useState(false);

  const [editingContract, setEditingContract] = useState(false);
  const [contractForm, setContractForm] = useState({});
  const [savingContract, setSavingContract] = useState(false);

  // --- Vendor Bills (AP) ---
  const [vendors, setVendors] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [receivingLogs, setReceivingLogs] = useState([]);
  const [vendorBills, setVendorBills] = useState([]);
  const [editingVendor, setEditingVendor] = useState(false);
  const [vendorForm, setVendorForm] = useState(emptyVendorForm());
  const [editingBill, setEditingBill] = useState(null);
  const [billForm, setBillForm] = useState(emptyBillForm());
  const [savingBill, setSavingBill] = useState(false);

  // --- AI Invoice Reader — extraction only, review before save. Matching
  // (runThreeWayMatch) stays a fully separate, deterministic step the user
  // triggers afterward via the existing "Run Match" button. ---
  const [invoiceFile, setInvoiceFile] = useState(null);
  const [invoiceFileUrl, setInvoiceFileUrl] = useState('');
  const [parsingInvoice, setParsingInvoice] = useState(false);
  const [invoiceParseError, setInvoiceParseError] = useState('');
  const [aiInvoice, setAiInvoice] = useState(null);

  // --- AR / Billings ---
  const [sovLines, setSovLines] = useState([]);
  const [invoiceReceivables, setInvoiceReceivables] = useState([]);
  const [editingSov, setEditingSov] = useState(null);
  const [sovForm, setSovForm] = useState(emptySovForm());
  const [editingInvoice, setEditingInvoice] = useState(null);
  const [invoiceForm, setInvoiceForm] = useState(emptyInvoiceForm());
  const [webhookPlatform, setWebhookPlatform] = useState('procore');
  const [webhookPayloadText, setWebhookPayloadText] = useState('');

  // --- WIP / Ledger ---
  const [ledgerEntries, setLedgerEntries] = useState([]);
  const [editingLedger, setEditingLedger] = useState(null);
  const [ledgerForm, setLedgerForm] = useState(emptyLedgerForm());

  const isAdmin = isAdminUser(currentUser);
  const canAccessTab = (tabId) => isAdmin || userRoles.some((r) => (TAB_ROLES[tabId] || []).includes(r));
  const accessibleTabs = TAB_ORDER.filter(canAccessTab);

  useEffect(() => {
    const checkAccess = async () => {
      try {
        const me = await db.auth.me();
        setCurrentUser(me);
        setUserRoles((me?.roles || ['user']).map(normalizeRoleName));
      } catch (e) {
        setCurrentUser(null);
        setUserRoles([]);
      } finally {
        setAccessChecked(true);
      }
    };
    checkAccess();
  }, []);

  useEffect(() => {
    if (accessChecked && !activeTab) {
      const firstAccessible = TAB_ORDER.find(canAccessTab);
      if (firstAccessible) setActiveTab(firstAccessible);
    }
  }, [accessChecked]);

  useEffect(() => { if (accessChecked && accessibleTabs.length > 0) loadData(); }, [accessChecked]);
  useEffect(() => {
    if (selectedProjectId) {
      loadJobCostRows(selectedProjectId);
      loadSovAndLedger(selectedProjectId);
    }
  }, [selectedProjectId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [projData, findData, vendorData, poData, rlData, billData] = await Promise.all([
        db.entities.Project.filter({ is_archived: false }, '-contract_value', 50),
        db.entities.AIFinding.filter({ review_package: 'accounting' }, '-created_date', 50),
        db.entities.Vendor.list('-created_date', 100),
        db.entities.purchase_orders.list('-created_date', 100),
        db.entities.receiving_logs.list('-created_date', 100),
        db.entities.VendorBill.list('-created_date', 100),
      ]);
      setProjects(projData);
      setFindings(findData);
      setVendors(vendorData);
      setPurchaseOrders(poData);
      setReceivingLogs(rlData);
      setVendorBills(billData);
      if (!selectedProjectId && projData.length > 0) setSelectedProjectId(projData[0].id);
    } catch (e) {} finally { setLoading(false); }
  };

  const loadJobCostRows = async (projectId) => {
    setLoadingJobCost(true);
    try {
      const rows = await db.entities.ProjectJobCostSummary.filter({ project_id: projectId }, '-created_date', 200);
      setJobCostRows(rows);
    } catch (e) {
      setJobCostRows([]);
    } finally {
      setLoadingJobCost(false);
    }
  };

  const loadSovAndLedger = async (projectId) => {
    try {
      const [sovData, invoiceData, ledgerData] = await Promise.all([
        db.entities.SovLine.filter({ project_id: projectId }, '-created_date', 200),
        db.entities.InvoiceReceivable.filter({ project_id: projectId }, '-created_date', 200),
        db.entities.JobCostLedgerEntry.filter({ project_id: projectId }, '-created_date', 500),
      ]);
      setSovLines(sovData);
      setInvoiceReceivables(invoiceData);
      setLedgerEntries(ledgerData);
    } catch (e) {
      setSovLines([]); setInvoiceReceivables([]); setLedgerEntries([]);
    }
  };

  const selectedProject = projects.find(p => p.id === selectedProjectId);

  const startAddRow = () => { setEditingRow('new'); setRowForm(emptyRowForm()); };
  const startEditRow = (row) => {
    setEditingRow(row);
    setRowForm({
      cost_code: row.cost_code || '', description: row.description || '', cost_class: row.cost_class || 'LAB',
      original_estimate: row.original_estimate || 0, approved_co: row.approved_co || 0, revised_estimated_cost: row.revised_estimated_cost || 0,
      jtd_hours: row.jtd_hours || 0, jtd_costs: row.jtd_costs || 0, profit_loss: row.profit_loss || 0,
    });
  };

  const handleSaveRow = async () => {
    if (!rowForm.cost_code) { toast({ title: 'Cost Code is required', variant: 'destructive' }); return; }
    setSavingRow(true);
    try {
      const payload = { ...rowForm, project_id: selectedProjectId };
      if (editingRow && editingRow !== 'new') {
        await db.entities.ProjectJobCostSummary.update(editingRow.id, payload);
      } else {
        await db.entities.ProjectJobCostSummary.create(payload);
      }
      toast({ title: 'Job cost row saved' });
      setEditingRow(null);
      loadJobCostRows(selectedProjectId);
    } catch (e) {
      toast({ title: 'Unable to save job cost row', variant: 'destructive' });
    } finally {
      setSavingRow(false);
    }
  };

  const handleDeleteRow = async (row) => {
    try {
      await db.entities.ProjectJobCostSummary.delete(row.id);
      toast({ title: 'Row deleted' });
      loadJobCostRows(selectedProjectId);
    } catch (e) {
      toast({ title: 'Unable to delete row', variant: 'destructive' });
    }
  };

  const startEditContract = () => {
    setContractForm(CONTRACT_FIELDS.reduce((acc, f) => ({ ...acc, [f.key]: selectedProject?.[f.key] || 0 }), {}));
    setEditingContract(true);
  };

  const handleSaveContract = async () => {
    setSavingContract(true);
    try {
      await db.entities.Project.update(selectedProjectId, contractForm);
      toast({ title: 'Contract summary saved' });
      setEditingContract(false);
      loadData();
    } catch (e) {
      toast({ title: 'Unable to save contract summary', variant: 'destructive' });
    } finally {
      setSavingContract(false);
    }
  };

  // --- Vendor Bills handlers ---
  const handleSaveVendor = async () => {
    if (!vendorForm.name) { toast({ title: 'Vendor name is required', variant: 'destructive' }); return; }
    try {
      await db.entities.Vendor.create(vendorForm);
      toast({ title: 'Vendor added' });
      setEditingVendor(false);
      setVendorForm(emptyVendorForm());
      loadData();
    } catch (e) {
      toast({ title: 'Unable to add vendor', variant: 'destructive' });
    }
  };

  const resetInvoiceAiState = () => {
    setInvoiceFile(null);
    setInvoiceFileUrl('');
    setParsingInvoice(false);
    setInvoiceParseError('');
    setAiInvoice(null);
  };

  const startAddBill = () => { setEditingBill('new'); setBillForm(emptyBillForm()); resetInvoiceAiState(); };
  const startEditBill = (bill) => {
    setEditingBill(bill);
    setBillForm({
      vendor_id: bill.vendor_id || '', po_id: bill.po_id || '', invoice_number: bill.invoice_number || '',
      invoice_date: bill.invoice_date || '', due_date: bill.due_date || '', gross_amount: bill.gross_amount || 0,
      conditional_waiver_signed: !!bill.conditional_waiver_signed, unconditional_waiver_received: !!bill.unconditional_waiver_received,
    });
    resetInvoiceAiState();
  };

  const handleInvoiceFileSelected = (file) => {
    if (!file) return;
    setInvoiceFile(file);
    setInvoiceFileUrl('');
    setAiInvoice(null);
    setInvoiceParseError('');
  };

  // Same InvokeLLM call shape (upload first, single structured-extraction
  // call, identical try/catch) as SmartFileDump.jsx's runAIParse. Extraction
  // only — nothing here approves or matches anything.
  const runInvoiceParse = async () => {
    if (!invoiceFile) return;
    setParsingInvoice(true);
    setInvoiceParseError('');
    try {
      const { file_url } = await db.integrations.Core.UploadFile({ file: invoiceFile });
      setInvoiceFileUrl(file_url);

      const response = await db.integrations.Core.InvokeLLM({
        prompt: 'You are an accounts-payable assistant. Parse the uploaded vendor invoice and extract the vendor name, invoice number, invoice date, due date, gross amount, the purchase order number if one is referenced on the invoice, and every itemized line (description, quantity, unit cost) if the invoice itemizes.',
        file_urls: [file_url],
        response_json_schema: {
          type: 'object',
          properties: {
            vendor_name: { type: 'string' },
            invoice_number: { type: 'string' },
            invoice_date: { type: 'string' },
            due_date: { type: 'string' },
            gross_amount: { type: 'number' },
            po_number: { type: 'string' },
            line_items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  description: { type: 'string' },
                  quantity: { type: 'number' },
                  unit_cost: { type: 'number' }
                }
              }
            }
          }
        }
      });

      setAiInvoice(response);

      const matchedVendor = vendors.find(v => v.name?.trim().toLowerCase() === (response.vendor_name || '').trim().toLowerCase());

      // Vendor + PO number together, not vendor alone, once a PO number is
      // on the invoice — narrows rather than guesses. Anything short of
      // exactly one match leaves po_id blank for manual selection.
      let matchedPoId = '';
      if (matchedVendor) {
        let candidates = purchaseOrders.filter(po => po.vendor_id === matchedVendor.id);
        if (response.po_number) {
          candidates = candidates.filter(po => po.po_number?.trim().toLowerCase() === response.po_number.trim().toLowerCase());
        }
        if (candidates.length === 1) matchedPoId = candidates[0].id;
      }

      setBillForm(f => ({
        ...f,
        vendor_id: matchedVendor ? matchedVendor.id : f.vendor_id,
        po_id: matchedPoId || f.po_id,
        invoice_number: response.invoice_number || f.invoice_number,
        invoice_date: response.invoice_date || f.invoice_date,
        due_date: response.due_date || f.due_date,
        gross_amount: typeof response.gross_amount === 'number' ? response.gross_amount : f.gross_amount,
      }));

      toast({ title: 'Invoice parsed', description: 'Review the extracted fields before saving.' });
    } catch (e) {
      const message = e?.message || 'The AI parse failed unexpectedly.';
      setInvoiceParseError(message);
      toast({ title: 'AI parsing failed', description: message, variant: 'destructive' });
    } finally {
      setParsingInvoice(false);
    }
  };

  const handleSaveBill = async () => {
    if (!billForm.vendor_id || !billForm.po_id) { toast({ title: 'Vendor and PO are required', variant: 'destructive' }); return; }
    setSavingBill(true);
    try {
      const po = purchaseOrders.find(p => p.id === billForm.po_id);
      const payload = { ...billForm, project_id: selectedProjectId };
      let savedBill;
      if (editingBill && editingBill !== 'new') {
        savedBill = await db.entities.VendorBill.update(editingBill.id, payload);
      } else {
        savedBill = await db.entities.VendorBill.create(payload);
      }

      if (invoiceFileUrl) {
        await db.entities.Document.create({
          project_id: selectedProjectId,
          vendor_bill_id: savedBill.id,
          name: invoiceFile?.name || `Invoice — ${billForm.invoice_number || savedBill.id}`,
          file_url: invoiceFileUrl,
          file_name: invoiceFile?.name || '',
          file_size: invoiceFile?.size || 0,
          file_type: invoiceFile?.type || '',
          document_type: 'vendor_invoice',
          status: 'uploaded',
          ai_processing_status: 'complete',
          description: `Source vendor invoice for ${billForm.invoice_number || savedBill.id}`,
        });
      }

      toast({ title: 'Vendor bill saved', description: po ? undefined : 'No matching PO found for match calculations.' });
      setEditingBill(null);
      resetInvoiceAiState();
      loadData();
    } catch (e) {
      toast({ title: 'Unable to save vendor bill', variant: 'destructive' });
    } finally {
      setSavingBill(false);
    }
  };

  const handleRunMatch = async (bill) => {
    const po = purchaseOrders.find(p => p.id === bill.po_id);
    const receivingLog = receivingLogs.find(r => r.po_id === bill.po_id || r.po_number === po?.po_number);
    const result = runThreeWayMatch(bill, po, receivingLog);
    try {
      await db.entities.VendorBill.update(bill.id, result);
      toast({ title: `Match result: ${result.status.replace(/_/g, ' ')}`, description: `Variance ${result.variance_pct}%` });
      loadData();
    } catch (e) {
      toast({ title: 'Unable to run match', variant: 'destructive' });
    }
  };

  // --- AR / Billings handlers ---
  const startAddSov = () => { setEditingSov('new'); setSovForm(emptySovForm()); };
  const startEditSov = (line) => {
    setEditingSov(line);
    setSovForm({
      item_description: line.item_description || '', cost_code: line.cost_code || '',
      original_scheduled_value: line.original_scheduled_value || 0, completion_percentage: line.completion_percentage || 0,
      current_billed_amount: line.current_billed_amount || 0, retainage_rate: line.retainage_rate ?? 0.10,
    });
  };

  const handleSaveSov = async () => {
    if (!sovForm.item_description) { toast({ title: 'Item description is required', variant: 'destructive' }); return; }
    try {
      const payload = { ...sovForm, project_id: selectedProjectId };
      if (editingSov && editingSov !== 'new') {
        await db.entities.SovLine.update(editingSov.id, payload);
      } else {
        await db.entities.SovLine.create(payload);
      }
      toast({ title: 'SOV line saved' });
      setEditingSov(null);
      loadSovAndLedger(selectedProjectId);
    } catch (e) {
      toast({ title: 'Unable to save SOV line', variant: 'destructive' });
    }
  };

  const startAddInvoice = () => { setEditingInvoice('new'); setInvoiceForm(emptyInvoiceForm()); };
  const startEditInvoice = (inv) => {
    setEditingInvoice(inv);
    setInvoiceForm({
      billing_period: inv.billing_period || '', expected_payment_date: inv.expected_payment_date || '', gross_amount: inv.gross_amount || 0,
      retainage_held: inv.retainage_held || 0, payment_status: inv.payment_status || 'Draft',
    });
  };

  const handleSaveInvoice = async () => {
    if (!invoiceForm.billing_period) { toast({ title: 'Billing period is required', variant: 'destructive' }); return; }
    try {
      const netBilling = (Number(invoiceForm.gross_amount) || 0) - (Number(invoiceForm.retainage_held) || 0);
      const payload = { ...invoiceForm, project_id: selectedProjectId, net_billing: netBilling };
      if (editingInvoice && editingInvoice !== 'new') {
        await db.entities.InvoiceReceivable.update(editingInvoice.id, payload);
      } else {
        await db.entities.InvoiceReceivable.create(payload);
      }
      toast({ title: 'Progress billing saved' });
      setEditingInvoice(null);
      loadSovAndLedger(selectedProjectId);
    } catch (e) {
      toast({ title: 'Unable to save progress billing', variant: 'destructive' });
    }
  };

  const handleSimulateWebhook = async () => {
    let payload;
    try {
      payload = JSON.parse(webhookPayloadText);
    } catch (e) {
      toast({ title: 'Invalid JSON payload', variant: 'destructive' });
      return;
    }
    try {
      const handler = webhookPlatform === 'procore' ? handleProcorePayWebhook : handleTexturaWebhook;
      await handler(payload);
      toast({ title: 'Webhook processed', description: 'Invoice payment status updated.' });
      loadSovAndLedger(selectedProjectId);
    } catch (e) {
      toast({ title: 'Webhook failed', description: e.message, variant: 'destructive' });
    }
  };

  // --- Ledger / WIP handlers ---
  const startAddLedger = () => { setEditingLedger('new'); setLedgerForm(emptyLedgerForm()); };
  const handleSaveLedger = async () => {
    if (!ledgerForm.cost_code) { toast({ title: 'Cost Code is required', variant: 'destructive' }); return; }
    try {
      const payload = { ...ledgerForm, project_id: selectedProjectId };
      await db.entities.JobCostLedgerEntry.create(payload);
      toast({ title: 'Ledger entry added' });
      setEditingLedger(null);
      loadSovAndLedger(selectedProjectId);
    } catch (e) {
      toast({ title: 'Unable to add ledger entry', variant: 'destructive' });
    }
  };

  const wip = selectedProject ? calculateWIPSchedule(selectedProject, sovLines, ledgerEntries, jobCostRows) : null;

  const totalContractValue = projects.reduce((s, p) => s + (p.contract_value || 0), 0);
  const activeProjects = projects.filter(p => !['complete','cancelled','lead'].includes(p.status));
  const activeValue = activeProjects.reduce((s, p) => s + (p.contract_value || 0), 0);

  if (!accessChecked) {
    return <div className="p-6 space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 bg-muted rounded-xl animate-pulse" />)}</div>;
  }

  if (accessibleTabs.length === 0) {
    return (
      <div className="p-6">
        <div className="steel-card p-8 text-center max-w-md mx-auto mt-12">
          <ShieldAlert className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <h2 className="font-semibold text-lg mb-1">Access Restricted</h2>
          <p className="text-sm text-muted-foreground">Accounting & Finance data is only available to Project Manager, Finance, Controller, and executive roles.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader title="Accounting & Finance" subtitle="Job costing, financial tracking, and AI-flagged financial risks" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Contract Value', value: `$${(totalContractValue/1000000).toFixed(2)}M`, icon: DollarSign, color: 'text-green-500', onClick: () => { setJobsRiskFilter(false); setActiveTab('jobs'); } },
          { label: 'Active Projects Value', value: `$${(activeValue/1000000).toFixed(2)}M`, icon: TrendingUp, color: 'text-blue-500', onClick: () => { setJobsRiskFilter(false); setActiveTab('jobs'); } },
          { label: 'Projects with Risk', value: projects.filter(p => p.financial_risk > 0).length, icon: AlertCircle, color: 'text-orange-500', onClick: () => { setJobsRiskFilter(true); setActiveTab('jobs'); } },
          { label: 'AI Financial Flags', value: findings.length, icon: Brain, color: 'text-purple-500', onClick: () => { setFindingsProjectFilter(null); setActiveTab('ai'); } },
        ].map(({ label, value, icon: Icon, color, onClick }) => (
          <button key={label} type="button" onClick={onClick} disabled={!canAccessTab(label === 'AI Financial Flags' ? 'ai' : 'jobs')} className="steel-card p-4 text-left hover:ring-2 hover:ring-primary/40 transition-shadow disabled:hover:ring-0 disabled:cursor-default">
            <div className="flex items-center gap-2 mb-1"><Icon className={`w-4 h-4 ${color}`} /><p className="text-xs text-muted-foreground">{label}</p></div>
            <p className={`text-xl font-bold ${color}`}>{loading ? '—' : value}</p>
          </button>
        ))}
      </div>

      <div className="steel-card p-4 mb-4">
        <Label>Project (applies to Job Cost Detail, AR &amp; Billings, and WIP Report tabs)</Label>
        <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
          <SelectTrigger className="mt-1 max-w-md"><SelectValue placeholder="Select a project" /></SelectTrigger>
          <SelectContent>
            {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name} ({p.project_number})</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4 flex-wrap h-auto">
          {canAccessTab('jobs') && <TabsTrigger value="jobs">Job Costing Summary</TabsTrigger>}
          {canAccessTab('jobcostdetail') && <TabsTrigger value="jobcostdetail"><BarChart3 className="w-3.5 h-3.5 mr-1.5" />Job Cost Detail</TabsTrigger>}
          {canAccessTab('vendorbills') && <TabsTrigger value="vendorbills"><Receipt className="w-3.5 h-3.5 mr-1.5" />Vendor Bills (AP)</TabsTrigger>}
          {canAccessTab('cash') && <TabsTrigger value="cash"><Landmark className="w-3.5 h-3.5 mr-1.5" />Bank &amp; Cash</TabsTrigger>}
          {canAccessTab('close') && <TabsTrigger value="close"><ListChecks className="w-3.5 h-3.5 mr-1.5" />Month-End Close</TabsTrigger>}
          {canAccessTab('budget') && <TabsTrigger value="budget"><ClipboardList className="w-3.5 h-3.5 mr-1.5" />Budget</TabsTrigger>}
          {canAccessTab('arbilling') && <TabsTrigger value="arbilling"><FileText className="w-3.5 h-3.5 mr-1.5" />AR &amp; Billings</TabsTrigger>}
          {canAccessTab('wip') && <TabsTrigger value="wip"><Gauge className="w-3.5 h-3.5 mr-1.5" />WIP Report</TabsTrigger>}
          {canAccessTab('ai') && <TabsTrigger value="ai">AI Financial Flags ({findings.length})</TabsTrigger>}
        </TabsList>

        {canAccessTab('jobs') && (
        <TabsContent value="jobs">
          {jobsRiskFilter && (
            <div className="flex items-center justify-between text-sm mb-3 px-3 py-2 rounded-lg bg-orange-500/10 text-orange-600">
              <span>Showing only projects with financial risk flagged.</span>
              <button className="flex items-center gap-1 hover:underline" onClick={() => setJobsRiskFilter(false)}><X className="w-3.5 h-3.5" />Clear filter</button>
            </div>
          )}
          <div className="steel-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="text-left py-3 px-4">Project</th>
                    <th className="text-left py-3 px-4">Status</th>
                    <th className="text-right py-3 px-4">Contract Value</th>
                    <th className="text-right py-3 px-4">Est. Tons</th>
                    <th className="text-right py-3 px-4">$/Ton</th>
                    <th className="text-left py-3 px-4">Risk Level</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={6} className="py-3 px-4"><div className="h-6 bg-muted rounded animate-pulse" /></td></tr>)
                  ) : (jobsRiskFilter ? projects.filter(p => p.financial_risk > 0) : projects).length === 0 ? (
                    <tr><td colSpan={6} className="py-16 text-center text-muted-foreground text-sm">No projects found</td></tr>
                  ) : (
                    (jobsRiskFilter ? projects.filter(p => p.financial_risk > 0) : projects).map(p => (
                      <tr key={p.id} onClick={() => navigate(`/projects/${p.id}`)} className="border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer">
                        <td className="py-3 px-4">
                          <p className="font-medium text-primary hover:underline">{p.name}</p>
                          <p className="text-xs text-muted-foreground">{p.project_number}</p>
                        </td>
                        <td className="py-3 px-4"><StatusBadge status={p.status} /></td>
                        <td className="py-3 px-4 text-right font-mono font-bold">
                          {p.contract_value ? (
                            <button className="hover:underline" onClick={(e) => { e.stopPropagation(); setSelectedProjectId(p.id); setActiveTab('jobcostdetail'); }}>
                              ${p.contract_value.toLocaleString()}
                            </button>
                          ) : '—'}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-muted-foreground">
                          {p.estimated_tons ? `${p.estimated_tons.toLocaleString()} T` : '—'}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-muted-foreground">
                          {p.contract_value && p.estimated_tons
                            ? `$${Math.round(p.contract_value / p.estimated_tons).toLocaleString()}`
                            : '—'}
                        </td>
                        <td className="py-3 px-4">
                          <button onClick={(e) => { e.stopPropagation(); setFindingsProjectFilter(p.id); setActiveTab('ai'); }}>
                            <StatusBadge status={p.risk_level} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>
        )}

        {canAccessTab('jobcostdetail') && (
        <TabsContent value="jobcostdetail">
          {selectedProjectId && (
            <>
              <div className="steel-card p-5 mb-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold">Contract Summary</h3>
                  <Button variant="outline" size="sm" onClick={startEditContract}>
                    <Pencil className="w-3.5 h-3.5 mr-1" />Edit
                  </Button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {CONTRACT_FIELDS.map(f => {
                    const targets = {
                      original_contract: () => navigate(`/projects/${selectedProjectId}`),
                      change_orders_to_date: () => navigate('/projects/change-orders'),
                      billed_to_date: () => setActiveTab('arbilling'),
                      retainage: () => setActiveTab('arbilling'),
                      net_billings: () => setActiveTab('arbilling'),
                      cash_received: () => setActiveTab('cash'),
                      left_to_bill: () => setActiveTab('arbilling'),
                    };
                    return (
                      <button key={f.key} type="button" onClick={targets[f.key]} className="text-left hover:bg-muted/50 rounded p-1 -m-1 transition-colors">
                        <p className="text-xs text-muted-foreground">{f.label}</p>
                        <p className="font-mono font-bold">${(selectedProject?.[f.key] || 0).toLocaleString()}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="steel-card overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b border-border">
                  <h3 className="font-semibold">Job Cost by Cost Code</h3>
                  <Button size="sm" onClick={startAddRow}><Plus className="w-3.5 h-3.5 mr-1" />Add Cost Code</Button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                        <th className="text-left py-3 px-4">Cost Code</th>
                        <th className="text-left py-3 px-4">Class</th>
                        <th className="text-right py-3 px-4">Orig. Estimate</th>
                        <th className="text-right py-3 px-4">Approved C.O.</th>
                        <th className="text-right py-3 px-4">Revised Est.</th>
                        <th className="text-right py-3 px-4">JTD Hours</th>
                        <th className="text-right py-3 px-4">JTD Costs</th>
                        <th className="text-right py-3 px-4">Profit/Loss</th>
                        <th className="text-right py-3 px-4">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loadingJobCost ? (
                        <tr><td colSpan={9} className="py-3 px-4"><div className="h-6 bg-muted rounded animate-pulse" /></td></tr>
                      ) : jobCostRows.length === 0 ? (
                        <tr><td colSpan={9} className="py-12 text-center text-muted-foreground">No job cost data for this project yet.</td></tr>
                      ) : (
                        jobCostRows.map(row => {
                          const codeEntries = ledgerEntries.filter(e => e.cost_code === row.cost_code);
                          const openCodeLedger = () => openLedgerDrilldown(
                            `Ledger — ${row.cost_code}`,
                            codeEntries,
                            `No job cost ledger entries recorded against ${row.cost_code} yet.`
                          );
                          return (
                            <tr key={row.id} onClick={() => startEditRow(row)} className="border-b border-border/50 hover:bg-muted/50 cursor-pointer">
                              <td className="py-3 px-4">
                                <button onClick={(e) => { e.stopPropagation(); openCodeLedger(); }} className="font-mono font-bold text-primary hover:underline">{row.cost_code}</button>
                                {row.description && <p className="text-xs text-muted-foreground font-sans">{row.description}</p>}
                              </td>
                              <td className="py-3 px-4">{row.cost_class}</td>
                              <td className="py-3 px-4 text-right font-mono">${(row.original_estimate || 0).toLocaleString()}</td>
                              <td className="py-3 px-4 text-right font-mono">${(row.approved_co || 0).toLocaleString()}</td>
                              <td className="py-3 px-4 text-right font-mono">${(row.revised_estimated_cost || 0).toLocaleString()}</td>
                              <td className="py-3 px-4 text-right font-mono">{(row.jtd_hours || 0).toLocaleString()}</td>
                              <td className="py-3 px-4 text-right font-mono">
                                <button onClick={(e) => { e.stopPropagation(); openCodeLedger(); }} className="hover:underline">${(row.jtd_costs || 0).toLocaleString()}</button>
                              </td>
                              <td className={`py-3 px-4 text-right font-mono font-bold ${(row.profit_loss || 0) < 0 ? 'text-red-500' : 'text-green-500'}`}>
                                <button onClick={(e) => { e.stopPropagation(); openCodeLedger(); }} className="hover:underline">${(row.profit_loss || 0).toLocaleString()}</button>
                              </td>
                              <td className="py-3 px-4 text-right">
                                <button onClick={(e) => { e.stopPropagation(); startEditRow(row); }} className="text-muted-foreground hover:text-primary p-1"><Pencil className="w-4 h-4" /></button>
                                <button onClick={(e) => { e.stopPropagation(); handleDeleteRow(row); }} className="text-muted-foreground hover:text-red-500 p-1"><Trash2 className="w-4 h-4" /></button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </TabsContent>
        )}

        {canAccessTab('vendorbills') && (
        <TabsContent value="vendorbills">
          <div className="steel-card p-5 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Vendors</h3>
              <Button size="sm" variant="outline" onClick={() => { setVendorForm(emptyVendorForm()); setEditingVendor(true); }}>
                <Plus className="w-3.5 h-3.5 mr-1" />Add Vendor
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {vendors.length === 0 ? (
                <p className="text-sm text-muted-foreground">No vendors yet — add one to attach vendor bills.</p>
              ) : vendors.map(v => (
                <button key={v.id} type="button" onClick={() => navigate(`/crm/directory?vendor=${v.id}`)} className="text-xs px-2 py-1 rounded bg-muted hover:bg-muted/70 hover:underline">
                  {v.name} <span className="text-muted-foreground">({v.vendor_type})</span>
                </button>
              ))}
            </div>
          </div>

          <div className="steel-card overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="font-semibold">Vendor Bills — 3-Way Match Queue</h3>
              <Button size="sm" onClick={startAddBill}><Plus className="w-3.5 h-3.5 mr-1" />Add Vendor Bill</Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="text-left py-3 px-4">Invoice #</th>
                    <th className="text-left py-3 px-4">Vendor</th>
                    <th className="text-left py-3 px-4">PO</th>
                    <th className="text-right py-3 px-4">Gross Amount</th>
                    <th className="text-right py-3 px-4">Variance %</th>
                    <th className="text-left py-3 px-4">Status</th>
                    <th className="text-left py-3 px-4">Waivers</th>
                    <th className="text-right py-3 px-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {vendorBills.length === 0 ? (
                    <tr><td colSpan={8} className="py-12 text-center text-muted-foreground">No vendor bills yet.</td></tr>
                  ) : vendorBills.map(bill => {
                    const vendor = vendors.find(v => v.id === bill.vendor_id);
                    const po = purchaseOrders.find(p => p.id === bill.po_id);
                    return (
                      <tr key={bill.id} onClick={() => setViewingBillId(bill.id)} className="border-b border-border/50 hover:bg-muted/50 cursor-pointer">
                        <td className="py-3 px-4 font-mono text-primary hover:underline">{bill.invoice_number || '—'}</td>
                        <td className="py-3 px-4">
                          {vendor ? (
                            <button onClick={(e) => { e.stopPropagation(); navigate(`/crm/directory?vendor=${vendor.id}`); }} className="hover:underline">{vendor.name}</button>
                          ) : '—'}
                        </td>
                        <td className="py-3 px-4">
                          {po ? (
                            <button onClick={(e) => { e.stopPropagation(); setViewingPOId(po.id); }} className="hover:underline">{po.po_number}</button>
                          ) : '—'}
                        </td>
                        <td className="py-3 px-4 text-right font-mono">${(bill.gross_amount || 0).toLocaleString()}</td>
                        <td className="py-3 px-4 text-right font-mono">{bill.variance_pct != null ? `${bill.variance_pct}%` : '—'}</td>
                        <td className="py-3 px-4"><StatusBadge status={bill.status} /></td>
                        <td className="py-3 px-4 text-xs text-muted-foreground">
                          {bill.conditional_waiver_signed ? 'Cond ✓' : 'Cond —'} / {bill.unconditional_waiver_received ? 'Uncond ✓' : 'Uncond —'}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <Button size="sm" variant="outline" className="mr-1" onClick={(e) => { e.stopPropagation(); handleRunMatch(bill); }}>Run Match</Button>
                          <button onClick={(e) => { e.stopPropagation(); startEditBill(bill); }} className="text-muted-foreground hover:text-primary p-1"><Pencil className="w-4 h-4" /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>
        )}

        {canAccessTab('cash') && (
        <TabsContent value="cash">
          <Tabs defaultValue="accounts">
            <TabsList className="mb-4">
              <TabsTrigger value="accounts">Accounts &amp; Reconciliation</TabsTrigger>
              <TabsTrigger value="forecast"><TrendingUp className="w-3.5 h-3.5 mr-1.5" />90-Day Forecast</TabsTrigger>
            </TabsList>
            <TabsContent value="accounts">
              <CashManagementPanel />
            </TabsContent>
            <TabsContent value="forecast">
              <CashForecastPanel />
            </TabsContent>
          </Tabs>
        </TabsContent>
        )}

        {canAccessTab('close') && (
        <TabsContent value="close">
          <MonthEndClosePanel />
        </TabsContent>
        )}

        {canAccessTab('budget') && (
        <TabsContent value="budget">
          <BudgetPanel />
        </TabsContent>
        )}

        {canAccessTab('arbilling') && (
        <TabsContent value="arbilling">
          {selectedProjectId && (
            <>
              <div className="steel-card overflow-hidden mb-4">
                <div className="flex items-center justify-between p-4 border-b border-border">
                  <h3 className="font-semibold">Schedule of Values (SOV)</h3>
                  <Button size="sm" onClick={startAddSov}><Plus className="w-3.5 h-3.5 mr-1" />Add SOV Line</Button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                        <th className="text-left py-3 px-4">Item</th>
                        <th className="text-right py-3 px-4">Scheduled Value</th>
                        <th className="text-right py-3 px-4">% Complete</th>
                        <th className="text-right py-3 px-4">Billed to Date</th>
                        <th className="text-right py-3 px-4">Retainage %</th>
                        <th className="text-right py-3 px-4">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sovLines.length === 0 ? (
                        <tr><td colSpan={6} className="py-12 text-center text-muted-foreground">No SOV lines for this project yet.</td></tr>
                      ) : sovLines.map(line => {
                        const codeEntries = line.cost_code ? ledgerEntries.filter(e => e.cost_code === line.cost_code) : [];
                        const openLineLedger = (e) => {
                          e.stopPropagation();
                          if (!line.cost_code) { openLedgerDrilldown('Job Cost Ledger', [], 'This SOV line has no cost code assigned, so there is nothing to match against the job cost ledger.'); return; }
                          openLedgerDrilldown(`Ledger — ${line.cost_code}`, codeEntries, `No job cost ledger entries recorded against ${line.cost_code} yet.`);
                        };
                        return (
                          <tr key={line.id} onClick={() => startEditSov(line)} className="border-b border-border/50 hover:bg-muted/50 cursor-pointer">
                            <td className="py-3 px-4">
                              {line.item_description}
                              {line.cost_code && <button onClick={openLineLedger} className="block text-xs text-muted-foreground hover:underline">{line.cost_code}</button>}
                            </td>
                            <td className="py-3 px-4 text-right font-mono">${(line.original_scheduled_value || 0).toLocaleString()}</td>
                            <td className="py-3 px-4 text-right font-mono">{line.completion_percentage || 0}%</td>
                            <td className="py-3 px-4 text-right font-mono"><button onClick={openLineLedger} className="hover:underline">${(line.current_billed_amount || 0).toLocaleString()}</button></td>
                            <td className="py-3 px-4 text-right font-mono">{((line.retainage_rate || 0) * 100).toFixed(1)}%</td>
                            <td className="py-3 px-4 text-right">
                              <button onClick={(e) => { e.stopPropagation(); startEditSov(line); }} className="text-muted-foreground hover:text-primary p-1"><Pencil className="w-4 h-4" /></button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="steel-card overflow-hidden mb-4">
                <div className="flex items-center justify-between p-4 border-b border-border">
                  <h3 className="font-semibold">Progress Billings (AIA G702/G703)</h3>
                  <Button size="sm" onClick={startAddInvoice}><Plus className="w-3.5 h-3.5 mr-1" />Add Billing</Button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                        <th className="text-left py-3 px-4">Billing Period</th>
                        <th className="text-right py-3 px-4">Gross Amount</th>
                        <th className="text-right py-3 px-4">Retainage Held</th>
                        <th className="text-right py-3 px-4">Net Billing</th>
                        <th className="text-left py-3 px-4">Status</th>
                        <th className="text-right py-3 px-4">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoiceReceivables.length === 0 ? (
                        <tr><td colSpan={6} className="py-12 text-center text-muted-foreground">No progress billings for this project yet.</td></tr>
                      ) : invoiceReceivables.map(inv => (
                        <tr key={inv.id} onClick={() => setViewingInvoiceId(inv.id)} className="border-b border-border/50 hover:bg-muted/50 cursor-pointer">
                          <td className="py-3 px-4 text-primary hover:underline">{inv.billing_period}</td>
                          <td className="py-3 px-4 text-right font-mono">${(inv.gross_amount || 0).toLocaleString()}</td>
                          <td className="py-3 px-4 text-right font-mono">${(inv.retainage_held || 0).toLocaleString()}</td>
                          <td className="py-3 px-4 text-right font-mono">${(inv.net_billing || 0).toLocaleString()}</td>
                          <td className="py-3 px-4"><StatusBadge status={inv.payment_status} /></td>
                          <td className="py-3 px-4 text-right">
                            <button onClick={(e) => { e.stopPropagation(); startEditInvoice(inv); }} className="text-muted-foreground hover:text-primary p-1"><Pencil className="w-4 h-4" /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="steel-card p-5">
                <h3 className="font-semibold mb-1 flex items-center gap-2"><Webhook className="w-4 h-4 text-primary" />Billing Webhook Test Console</h3>
                <p className="text-xs text-muted-foreground mb-3">No live server exists to receive real Procore Pay/Textura webhooks — paste a sample payload here to test the status-mapping logic against a real progress billing record.</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">Platform</Label>
                    <Select value={webhookPlatform} onValueChange={setWebhookPlatform}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="procore">Procore Pay</SelectItem>
                        <SelectItem value="textura">Textura</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] text-muted-foreground mt-2">
                      Procore: {'{ "invoice_receivable_id": "...", "status": "approved" }'}<br />
                      Textura: {'{ "invoice_receivable_id": "...", "sov_status": "Approved" }'}
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <Label className="text-xs">Sample Payload (JSON)</Label>
                    <Textarea value={webhookPayloadText} onChange={(e) => setWebhookPayloadText(e.target.value)} className="mt-1 h-24 font-mono text-xs" placeholder='{ "invoice_receivable_id": "...", "status": "approved" }' />
                  </div>
                </div>
                <div className="flex justify-end mt-3">
                  <Button size="sm" onClick={handleSimulateWebhook}>Simulate Webhook</Button>
                </div>
              </div>
            </>
          )}
        </TabsContent>
        )}

        {canAccessTab('wip') && (
        <TabsContent value="wip">
          {selectedProjectId && (
            <>
              <div className="steel-card p-5 mb-4">
                <h3 className="font-semibold mb-4">WIP Schedule — {selectedProject?.name}</h3>
                {wip ? (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <button type="button" onClick={() => setActiveTab('jobcostdetail')} className="text-left hover:bg-muted/50 rounded p-1 -m-1 transition-colors">
                      <p className="text-xs text-muted-foreground">Total Contract Value</p><p className="font-mono font-bold text-lg">${wip.totalContractValue.toLocaleString()}</p>
                    </button>
                    <button type="button" onClick={() => openLedgerDrilldown(`All Ledger Entries — ${selectedProject?.name || ''}`, ledgerEntries, 'No job cost ledger entries recorded for this project yet.')} className="text-left hover:bg-muted/50 rounded p-1 -m-1 transition-colors">
                      <p className="text-xs text-muted-foreground">Actual JTD Costs</p><p className="font-mono font-bold text-lg">${wip.actualJTDCosts.toLocaleString()}</p>
                    </button>
                    <button type="button" onClick={() => setActiveTab('arbilling')} className="text-left hover:bg-muted/50 rounded p-1 -m-1 transition-colors">
                      <p className="text-xs text-muted-foreground">Earned Revenue</p><p className="font-mono font-bold text-lg">${wip.earnedRevenue.toLocaleString()}</p>
                    </button>
                    <button type="button" onClick={() => setActiveTab('jobcostdetail')} className="text-left hover:bg-muted/50 rounded p-1 -m-1 transition-colors">
                      <p className="text-xs text-muted-foreground">Margin Variance</p>
                      <p className={`font-mono font-bold text-lg ${wip.isOverBudget ? 'text-red-500' : 'text-green-500'}`}>
                        {wip.marginVariancePct > 0 ? '+' : ''}{wip.marginVariancePct.toFixed(1)}%
                        {wip.isOverBudget && <span className="text-xs ml-1">(over 3% threshold)</span>}
                      </p>
                    </button>
                  </div>
                ) : <p className="text-sm text-muted-foreground">Select a project to view its WIP schedule.</p>}
              </div>

              <div className="steel-card overflow-hidden mb-4">
                <div className="flex items-center justify-between p-4 border-b border-border">
                  <h3 className="font-semibold">Job Cost Ledger — Transaction Detail</h3>
                  <Button size="sm" onClick={startAddLedger}><Plus className="w-3.5 h-3.5 mr-1" />Add Ledger Entry</Button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                        <th className="text-left py-3 px-4">Date</th>
                        <th className="text-left py-3 px-4">Cost Code</th>
                        <th className="text-left py-3 px-4">Class</th>
                        <th className="text-left py-3 px-4">Source</th>
                        <th className="text-right py-3 px-4">Amount</th>
                        <th className="text-left py-3 px-4">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledgerEntries.length === 0 ? (
                        <tr><td colSpan={6} className="py-12 text-center text-muted-foreground">No ledger transactions for this project yet.</td></tr>
                      ) : ledgerEntries.map(entry => {
                        const openEntryDetail = () => openLedgerDrilldown('Ledger Entry Detail', [entry]);
                        const linkedBill = entry.source_type === 'vendor_bill' && entry.source_id
                          ? vendorBills.find(b => b.id === entry.source_id)
                          : null;
                        return (
                          <tr key={entry.id} onClick={openEntryDetail} className="border-b border-border/50 hover:bg-muted/50 cursor-pointer">
                            <td className="py-3 px-4 text-xs">{entry.transaction_date || '—'}</td>
                            <td className="py-3 px-4 font-mono">
                              <button onClick={(e) => { e.stopPropagation(); setActiveTab('jobcostdetail'); }} className="hover:underline">{entry.cost_code}</button>
                            </td>
                            <td className="py-3 px-4">{entry.cost_class}</td>
                            <td className="py-3 px-4 text-xs text-muted-foreground">
                              {linkedBill ? (
                                <button onClick={(e) => { e.stopPropagation(); setViewingBillId(linkedBill.id); }} className="hover:underline">{entry.source_type.replace(/_/g, ' ')}</button>
                              ) : entry.source_type}
                            </td>
                            <td className="py-3 px-4 text-right font-mono">${(entry.amount || 0).toLocaleString()}</td>
                            <td className="py-3 px-4 text-xs text-muted-foreground">{entry.description || '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="steel-card p-5">
                <h3 className="font-semibold mb-1 flex items-center gap-2"><Download className="w-4 h-4 text-primary" />GL Export</h3>
                <p className="text-xs text-muted-foreground mb-3">Exports this project's job cost ledger transactions. Column layouts are a general approximation — verify against your accounting system's current import template before production use.</p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => exportToQuickBooksCSV(ledgerEntries)}>
                    <Download className="w-3.5 h-3.5 mr-1" />Export for QuickBooks Online
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => exportToSage100CSV(ledgerEntries)}>
                    <Download className="w-3.5 h-3.5 mr-1" />Export for Sage 100
                  </Button>
                </div>
              </div>
            </>
          )}
        </TabsContent>
        )}

        {canAccessTab('ai') && (
        <TabsContent value="ai">
          {findingsProjectFilter && (
            <div className="flex items-center justify-between text-sm mb-3 px-3 py-2 rounded-lg bg-purple-500/10 text-purple-600">
              <span>Showing flags for {projects.find(p => p.id === findingsProjectFilter)?.name || 'selected project'}.</span>
              <button className="flex items-center gap-1 hover:underline" onClick={() => setFindingsProjectFilter(null)}><X className="w-3.5 h-3.5" />Clear filter</button>
            </div>
          )}
          {(() => {
            const visibleFindings = findingsProjectFilter ? findings.filter(f => f.project_id === findingsProjectFilter) : findings;
            return visibleFindings.length === 0 ? (
              <div className="text-center py-16 steel-card">
                <Brain className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No AI financial findings yet. Upload project contracts to generate analysis.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {visibleFindings.map(f => (
                  <div
                    key={f.id}
                    onClick={() => f.project_id && navigate(`/projects/${f.project_id}`)}
                    className={`steel-card p-4 border-l-4 ${f.project_id ? 'cursor-pointer hover:bg-muted/40' : ''} ${f.status === 'fail' ? 'border-l-red-500' : f.status === 'warning' ? 'border-l-yellow-500' : 'border-l-blue-500'}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <StatusBadge status={f.status} />
                      {f.risk_level && <StatusBadge status={f.risk_level} />}
                    </div>
                    <p className="font-medium text-sm">{f.title}</p>
                    {f.ai_explanation && <p className="text-xs text-muted-foreground mt-1">{f.ai_explanation}</p>}
                    {f.estimated_financial_impact && <p className="text-xs text-orange-500 mt-1 font-medium">Est. Impact: {f.estimated_financial_impact}</p>}
                  </div>
                ))}
              </div>
            );
          })()}
        </TabsContent>
        )}
      </Tabs>

      <Dialog open={!!editingRow} onOpenChange={(open) => !open && setEditingRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingRow === 'new' ? 'Add Cost Code' : 'Edit Cost Code'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Cost Code</Label>
              <Input value={rowForm.cost_code} onChange={(e) => setRowForm(f => ({ ...f, cost_code: e.target.value }))} className="mt-1" placeholder="e.g. structural_material" />
            </div>
            <div className="col-span-2">
              <Label>Description</Label>
              <Input value={rowForm.description} onChange={(e) => setRowForm(f => ({ ...f, description: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Cost Class</Label>
              <Select value={rowForm.cost_class} onValueChange={(v) => setRowForm(f => ({ ...f, cost_class: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COST_CLASSES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Original Estimate ($)</Label>
              <Input type="number" value={rowForm.original_estimate} onChange={(e) => setRowForm(f => ({ ...f, original_estimate: parseFloat(e.target.value) || 0 }))} className="mt-1" />
            </div>
            <div>
              <Label>Approved C.O. ($)</Label>
              <Input type="number" value={rowForm.approved_co} onChange={(e) => setRowForm(f => ({ ...f, approved_co: parseFloat(e.target.value) || 0 }))} className="mt-1" />
            </div>
            <div>
              <Label>Revised Estimated Cost ($)</Label>
              <Input type="number" value={rowForm.revised_estimated_cost} onChange={(e) => setRowForm(f => ({ ...f, revised_estimated_cost: parseFloat(e.target.value) || 0 }))} className="mt-1" />
            </div>
            <div>
              <Label>JTD Hours</Label>
              <Input type="number" value={rowForm.jtd_hours} onChange={(e) => setRowForm(f => ({ ...f, jtd_hours: parseFloat(e.target.value) || 0 }))} className="mt-1" />
            </div>
            <div>
              <Label>JTD Costs ($)</Label>
              <Input type="number" value={rowForm.jtd_costs} onChange={(e) => setRowForm(f => ({ ...f, jtd_costs: parseFloat(e.target.value) || 0 }))} className="mt-1" />
            </div>
            <div>
              <Label>Profit/Loss ($)</Label>
              <Input type="number" value={rowForm.profit_loss} onChange={(e) => setRowForm(f => ({ ...f, profit_loss: parseFloat(e.target.value) || 0 }))} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingRow(null)}>Cancel</Button>
            <Button onClick={handleSaveRow} disabled={savingRow} className="steel-gradient text-white border-0">
              {savingRow ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editingContract} onOpenChange={setEditingContract}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Contract Summary</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            {CONTRACT_FIELDS.map(f => (
              <div key={f.key}>
                <Label>{f.label}</Label>
                <Input type="number" value={contractForm[f.key] ?? 0} onChange={(e) => setContractForm(prev => ({ ...prev, [f.key]: parseFloat(e.target.value) || 0 }))} className="mt-1" />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingContract(false)}>Cancel</Button>
            <Button onClick={handleSaveContract} disabled={savingContract} className="steel-gradient text-white border-0">
              {savingContract ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editingVendor} onOpenChange={setEditingVendor}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Vendor</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Name</Label>
              <Input value={vendorForm.name} onChange={(e) => setVendorForm(f => ({ ...f, name: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Vendor Type</Label>
              <Select value={vendorForm.vendor_type} onValueChange={(v) => setVendorForm(f => ({ ...f, vendor_type: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VENDOR_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Contact Name</Label>
              <Input value={vendorForm.contact_name} onChange={(e) => setVendorForm(f => ({ ...f, contact_name: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={vendorForm.phone} onChange={(e) => setVendorForm(f => ({ ...f, phone: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Email</Label>
              <Input value={vendorForm.email} onChange={(e) => setVendorForm(f => ({ ...f, email: e.target.value }))} className="mt-1" />
            </div>
            <div className="col-span-2 rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">Vendor Portal Access</h4>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-3.5 h-3.5"
                    checked={vendorForm.portal_enabled}
                    onChange={(e) => setVendorForm(f => ({ ...f, portal_enabled: e.target.checked }))}
                  />
                  Enabled
                </label>
              </div>
              <p className="text-xs text-muted-foreground">Login credentials for this vendor's Vendor Portal — share the portal link from Admin &gt; Integrations.</p>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Portal Email</Label><Input type="email" value={vendorForm.portal_email} onChange={(e) => setVendorForm(f => ({ ...f, portal_email: e.target.value }))} className="mt-1" placeholder="portal login email" /></div>
                <div><Label className="text-xs">Portal Password</Label><Input type="password" value={vendorForm.portal_password} onChange={(e) => setVendorForm(f => ({ ...f, portal_password: e.target.value }))} className="mt-1" placeholder="portal login password" /></div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingVendor(false)}>Cancel</Button>
            <Button onClick={handleSaveVendor} className="steel-gradient text-white border-0">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingBill} onOpenChange={(open) => { if (!open) { setEditingBill(null); resetInvoiceAiState(); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingBill === 'new' ? 'Add Vendor Bill' : 'Edit Vendor Bill'}</DialogTitle></DialogHeader>

          <div className="rounded-lg border border-dashed border-border p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-sm flex items-center gap-1.5"><Brain className="w-4 h-4 text-primary" />Read Invoice (AI)</Label>
              {invoiceFile && (
                <Button size="sm" onClick={runInvoiceParse} disabled={parsingInvoice} className="steel-gradient text-white border-0">
                  {parsingInvoice ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Parsing…</> : <><Brain className="w-3.5 h-3.5 mr-1.5" />Parse Invoice</>}
                </Button>
              )}
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => handleInvoiceFileSelected(e.target.files?.[0])} />
              <UploadCloud className="w-4 h-4 flex-shrink-0" />
              <span className="truncate">{invoiceFile ? invoiceFile.name : 'Upload a vendor invoice (PDF or image) to auto-fill this form'}</span>
            </label>
            {invoiceParseError && (
              <div className="flex items-center justify-between gap-2 text-xs text-red-600 dark:text-red-400">
                <span>{invoiceParseError}</span>
                <Button size="sm" variant="outline" onClick={runInvoiceParse}>Retry</Button>
              </div>
            )}
            {aiInvoice && !billForm.vendor_id && (
              <p className="text-xs text-amber-600">Extracted vendor "{aiInvoice.vendor_name || 'unknown'}" — no exact match found. Select the vendor manually below.</p>
            )}
          </div>

          <div className={aiInvoice?.line_items?.length > 0 ? 'grid grid-cols-[1fr_240px] gap-4' : ''}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Vendor</Label>
                <Select value={billForm.vendor_id} onValueChange={(v) => setBillForm(f => ({ ...f, vendor_id: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select vendor" /></SelectTrigger>
                  <SelectContent>
                    {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Purchase Order</Label>
                <Select value={billForm.po_id} onValueChange={(v) => setBillForm(f => ({ ...f, po_id: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select PO" /></SelectTrigger>
                  <SelectContent>
                    {purchaseOrders.map(po => <SelectItem key={po.id} value={po.id}>{po.po_number} — ${(po.budgeted_cost || 0).toLocaleString()}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Invoice Number</Label>
                <Input value={billForm.invoice_number} onChange={(e) => setBillForm(f => ({ ...f, invoice_number: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label>Invoice Date</Label>
                <Input type="date" value={billForm.invoice_date} onChange={(e) => setBillForm(f => ({ ...f, invoice_date: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label>Due Date</Label>
                <Input type="date" value={billForm.due_date} onChange={(e) => setBillForm(f => ({ ...f, due_date: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label>Gross Amount ($)</Label>
                <Input type="number" value={billForm.gross_amount} onChange={(e) => setBillForm(f => ({ ...f, gross_amount: parseFloat(e.target.value) || 0 }))} className="mt-1" />
              </div>
              <div className="col-span-2 flex items-center gap-6 mt-2">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={billForm.conditional_waiver_signed} onCheckedChange={(v) => setBillForm(f => ({ ...f, conditional_waiver_signed: !!v }))} />
                  Conditional Waiver Signed
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={billForm.unconditional_waiver_received} onCheckedChange={(v) => setBillForm(f => ({ ...f, unconditional_waiver_received: !!v }))} />
                  Unconditional Waiver Received
                </label>
              </div>
            </div>

            {aiInvoice?.line_items?.length > 0 && (
              <div className="rounded-lg border border-border p-3 max-h-72 overflow-y-auto">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Itemized Lines (from invoice)</p>
                <div className="space-y-2">
                  {aiInvoice.line_items.map((li, i) => (
                    <div key={i} className="text-xs border-b border-border/50 pb-1.5">
                      <p className="font-medium">{li.description || '—'}</p>
                      <p className="text-muted-foreground">{li.quantity ?? '—'} × ${Number(li.unit_cost || 0).toLocaleString()}</p>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">Reference only — not saved as line records.</p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditingBill(null); resetInvoiceAiState(); }}>Cancel</Button>
            <Button onClick={handleSaveBill} disabled={savingBill} className="steel-gradient text-white border-0">{savingBill ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingSov} onOpenChange={(open) => !open && setEditingSov(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingSov === 'new' ? 'Add SOV Line' : 'Edit SOV Line'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Item Description</Label>
              <Input value={sovForm.item_description} onChange={(e) => setSovForm(f => ({ ...f, item_description: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Cost Code (optional)</Label>
              <Input value={sovForm.cost_code} onChange={(e) => setSovForm(f => ({ ...f, cost_code: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Original Scheduled Value ($)</Label>
              <Input type="number" value={sovForm.original_scheduled_value} onChange={(e) => setSovForm(f => ({ ...f, original_scheduled_value: parseFloat(e.target.value) || 0 }))} className="mt-1" />
            </div>
            <div>
              <Label>% Complete</Label>
              <Input type="number" value={sovForm.completion_percentage} onChange={(e) => setSovForm(f => ({ ...f, completion_percentage: parseFloat(e.target.value) || 0 }))} className="mt-1" />
            </div>
            <div>
              <Label>Current Billed Amount ($)</Label>
              <Input type="number" value={sovForm.current_billed_amount} onChange={(e) => setSovForm(f => ({ ...f, current_billed_amount: parseFloat(e.target.value) || 0 }))} className="mt-1" />
            </div>
            <div>
              <Label>Retainage Rate (%)</Label>
              <Input type="number" step="0.01" value={sovForm.retainage_rate * 100} onChange={(e) => setSovForm(f => ({ ...f, retainage_rate: (parseFloat(e.target.value) || 0) / 100 }))} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingSov(null)}>Cancel</Button>
            <Button onClick={handleSaveSov} className="steel-gradient text-white border-0">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingInvoice} onOpenChange={(open) => !open && setEditingInvoice(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingInvoice === 'new' ? 'Add Progress Billing' : 'Edit Progress Billing'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Billing Period</Label>
              <Input value={invoiceForm.billing_period} onChange={(e) => setInvoiceForm(f => ({ ...f, billing_period: e.target.value }))} className="mt-1" placeholder="e.g. 2026-07" />
            </div>
            <div className="col-span-2">
              <Label>Expected Payment Date</Label>
              <Input type="date" value={invoiceForm.expected_payment_date} onChange={(e) => setInvoiceForm(f => ({ ...f, expected_payment_date: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Gross Amount ($)</Label>
              <Input type="number" value={invoiceForm.gross_amount} onChange={(e) => setInvoiceForm(f => ({ ...f, gross_amount: parseFloat(e.target.value) || 0 }))} className="mt-1" />
            </div>
            <div>
              <Label>Retainage Held ($)</Label>
              <Input type="number" value={invoiceForm.retainage_held} onChange={(e) => setInvoiceForm(f => ({ ...f, retainage_held: parseFloat(e.target.value) || 0 }))} className="mt-1" />
            </div>
            <div className="col-span-2">
              <Label>Payment Status</Label>
              <Select value={invoiceForm.payment_status} onValueChange={(v) => setInvoiceForm(f => ({ ...f, payment_status: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BILLING_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingInvoice(null)}>Cancel</Button>
            <Button onClick={handleSaveInvoice} className="steel-gradient text-white border-0">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingLedger} onOpenChange={(open) => !open && setEditingLedger(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Ledger Entry</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Cost Code</Label>
              <Input value={ledgerForm.cost_code} onChange={(e) => setLedgerForm(f => ({ ...f, cost_code: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Cost Class</Label>
              <Select value={ledgerForm.cost_class} onValueChange={(v) => setLedgerForm(f => ({ ...f, cost_class: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LEDGER_COST_CLASSES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Amount ($)</Label>
              <Input type="number" value={ledgerForm.amount} onChange={(e) => setLedgerForm(f => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} className="mt-1" />
            </div>
            <div>
              <Label>Transaction Date</Label>
              <Input type="date" value={ledgerForm.transaction_date} onChange={(e) => setLedgerForm(f => ({ ...f, transaction_date: e.target.value }))} className="mt-1" />
            </div>
            <div className="col-span-2">
              <Label>Description</Label>
              <Input value={ledgerForm.description} onChange={(e) => setLedgerForm(f => ({ ...f, description: e.target.value }))} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingLedger(null)}>Cancel</Button>
            <Button onClick={handleSaveLedger} className="steel-gradient text-white border-0">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LedgerDrilldownModal
        open={ledgerModal.open}
        onOpenChange={closeLedgerDrilldown}
        title={ledgerModal.title}
        entries={ledgerModal.entries}
        emptyMessage={ledgerModal.emptyMessage}
      />

      <VendorBillDetailModal
        open={!!viewingBillId}
        onOpenChange={(open) => !open && setViewingBillId(null)}
        billId={viewingBillId}
        onViewPO={(poId) => setViewingPOId(poId)}
      />

      <InvoiceReceivableDetailModal
        open={!!viewingInvoiceId}
        onOpenChange={(open) => !open && setViewingInvoiceId(null)}
        invoiceId={viewingInvoiceId}
      />

      <PurchaseOrderDetailModal
        open={!!viewingPOId}
        onOpenChange={(open) => !open && setViewingPOId(null)}
        poId={viewingPOId}
      />
    </div>
  );
}
