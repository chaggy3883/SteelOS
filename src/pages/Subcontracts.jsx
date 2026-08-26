import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { db } from '@/api/apiClient';
import {
  FileSignature, Plus, CheckCircle2, XCircle, DollarSign, ShieldCheck,
  Banknote, FileCheck2, AlertTriangle, HandCoins,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { normalizeRoleName } from '@/components/dashboard/rbacConfig';
import { hasFinanceOverrideAccess } from '@/lib/financeAccess';
import { isPeriodLocked, periodLockedMessage } from '@/lib/periodLock';
import { logFinancialOverride } from '@/lib/financialAudit';
import { recordPayment } from '@/lib/paymentEngine';

const SC_STATUSES = ['draft', 'executed', 'active', 'complete', 'terminated'];
const SCOPE_OPTIONS = ['erection', 'painting', 'fireproofing', 'concrete', 'misc'];
const PAY_APP_STATUSES = ['received', 'under_review', 'approved', 'paid', 'disputed'];
// LienWaiver.waiver_type's own enum — distinct from SubcontractPayApp's
// separate lien_waiver_type field (none/conditional/unconditional), which is
// rendered with plain titleCase() instead since it has no _progress/_final
// distinction to label.
const WAIVER_TYPE_LABELS = {
  conditional_progress: 'Conditional Progress',
  unconditional_progress: 'Unconditional Progress',
  conditional_final: 'Conditional Final',
  unconditional_final: 'Unconditional Final',
};
const WAIVER_STATUS_STYLES = {
  pending: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  received: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  verified: 'bg-green-500/10 text-green-600 border-green-500/20',
  filed: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
};

const titleCase = (s) => (s ? String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : s);
const todayStr = () => new Date().toISOString().slice(0, 10);
const money = (n) => `$${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const emptySubcontractForm = () => ({
  project_id: '', vendor_id: '', subcontractor_name: '', scope_description: '',
  subcontract_number: '', cost_code: '', contract_value: 0, scope_of_work: 'erection',
  retention_pct: 0.10, executed_date: '', start_date: '', completion_date: '',
  insurance_verified: false, insurance_expiry_date: '', w9_on_file: false,
  bonded: false, bond_amount: 0, notes: '',
});

const emptyPayAppForm = () => ({
  subcontract_id: '', pay_app_number: 1, period_start: '', period_end: '',
  amount_requested: 0,
});

const emptyWaiverForm = () => ({
  subcontract_id: '', pay_app_id: '', waiver_type: 'conditional_progress',
  amount: 0, through_date: '', date_received: '', is_notarized: false,
});

export default function Subcontracts() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const initialProjectFilter = searchParams.get('project') || 'all';
  const identity = user?.full_name || user?.email || 'Unknown';
  const canOverrideFinanceLock = hasFinanceOverrideAccess((user?.roles || []).map(normalizeRoleName));

  const [subcontracts, setSubcontracts] = useState([]);
  const [payApps, setPayApps] = useState([]);
  const [waivers, setWaivers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [certifiedPayrollSubmissions, setCertifiedPayrollSubmissions] = useState([]);
  const [costCodes, setCostCodes] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [scList, paList, lwList, projList, vendorList, cprList, costCodeList, paymentList] = await Promise.all([
        db.entities.Subcontract.list('-created_date', 200),
        db.entities.SubcontractPayApp.list('-created_date', 500),
        db.entities.LienWaiver.list('-created_date', 500),
        db.entities.Project.filter({ is_archived: false }, 'name', 100),
        db.entities.Vendor.filter({ is_active: true }, 'name', 200),
        db.entities.CertifiedPayrollSubmission.list('-week_ending_date', 1000),
        db.entities.CostCode.filter({ is_active: true }, 'code_name', 200),
        db.entities.Payment.filter({ related_entity_type: 'SubcontractPayApp' }, '-payment_date', 2000),
      ]);
      setSubcontracts(scList);
      setPayApps(paList);
      setWaivers(lwList);
      setProjects(projList);
      setVendors(vendorList);
      setCertifiedPayrollSubmissions(cprList);
      setPayments(paymentList);
      setCostCodes(costCodeList);
    } catch (e) {
      console.error('Failed to load subcontract data', e);
    } finally {
      setLoading(false);
    }
  };

  const projectById = (id) => projects.find((p) => p.id === id);
  const subcontractById = (id) => subcontracts.find((s) => s.id === id);

  // Certified payroll (WH-347) is only a concept on prevailing wage projects.
  // 'missing' — no submission overlaps this pay app's period; 'deficient' —
  // one does but Hancock flagged it; 'ok' — a clean submission covers it.
  const getCprStatus = (payApp) => {
    const proj = projectById(payApp.project_id);
    if (!proj?.is_prevailing_wage) return null;
    const sc = subcontractById(payApp.subcontract_id);
    const matches = certifiedPayrollSubmissions.filter((s) => {
      if (s.project_id !== payApp.project_id) return false;
      if (s.subcontract_id !== payApp.subcontract_id && s.subcontractor_name !== sc?.subcontractor_name) return false;
      if (payApp.period_start && payApp.period_end) {
        return s.week_ending_date >= payApp.period_start && s.week_ending_date <= payApp.period_end;
      }
      return true;
    });
    if (matches.length === 0) return 'missing';
    if (matches.some((s) => s.status === 'deficient')) return 'deficient';
    return 'ok';
  };

  // ============ TAB 1 — Subcontracts ============
  const [scProjectFilter, setScProjectFilter] = useState(initialProjectFilter);
  const [scStatusFilter, setScStatusFilter] = useState('all');
  const [scScopeFilter, setScScopeFilter] = useState('all');
  const [newSubcontractOpen, setNewSubcontractOpen] = useState(false);
  const [subcontractForm, setSubcontractForm] = useState(emptySubcontractForm());
  const [savingSubcontract, setSavingSubcontract] = useState(false);
  const [selectedSubcontract, setSelectedSubcontract] = useState(null);
  const [editingSubcontract, setEditingSubcontract] = useState(false);
  const [editSubcontractForm, setEditSubcontractForm] = useState({});
  const [savingSubcontractEdit, setSavingSubcontractEdit] = useState(false);

  const filteredSubcontracts = subcontracts.filter((s) => {
    if (scProjectFilter !== 'all' && s.project_id !== scProjectFilter) return false;
    if (scStatusFilter !== 'all' && s.status !== scStatusFilter) return false;
    if (scScopeFilter !== 'all' && s.scope_of_work !== scScopeFilter) return false;
    return true;
  });

  const scStats = {
    activeCount: subcontracts.filter((s) => s.status === 'active').length,
    totalCommitted: subcontracts.filter((s) => s.status !== 'terminated').reduce((sum, s) => sum + (s.contract_value || 0), 0),
    totalPaid: payApps.filter((p) => p.status === 'paid').reduce((sum, p) => sum + (p.amount_approved || 0), 0),
    retentionHeld: payApps.reduce((sum, p) => sum + (p.retention_held || 0), 0),
  };

  const handleVendorPick = (vendorId) => {
    const v = vendors.find((v) => v.id === vendorId);
    setSubcontractForm((f) => ({ ...f, vendor_id: vendorId, subcontractor_name: v?.name || f.subcontractor_name }));
  };

  const handleCreateSubcontract = async () => {
    if (!subcontractForm.project_id || !subcontractForm.subcontractor_name.trim()) return;
    setSavingSubcontract(true);
    try {
      const seq = subcontracts.length + 1;
      const created = await db.entities.Subcontract.create({
        ...subcontractForm,
        subcontractor_name: subcontractForm.subcontractor_name.trim(),
        subcontract_number: subcontractForm.subcontract_number.trim() || `SC-${new Date().getFullYear()}-${String(seq).padStart(3, '0')}`,
        status: 'draft',
      });
      setSubcontracts((prev) => [created, ...prev]);
      toast({ title: 'Subcontract created' });
      setNewSubcontractOpen(false);
      setSubcontractForm(emptySubcontractForm());
    } catch (e) {
      toast({ title: 'Unable to create subcontract', variant: 'destructive' });
    } finally {
      setSavingSubcontract(false);
    }
  };

  const startEditingSubcontract = () => {
    setEditSubcontractForm({
      subcontractor_name: selectedSubcontract.subcontractor_name || '',
      scope_description: selectedSubcontract.scope_description || '',
      subcontract_number: selectedSubcontract.subcontract_number || '',
      cost_code: selectedSubcontract.cost_code || '',
      contract_value: selectedSubcontract.contract_value || 0,
      status: selectedSubcontract.status || 'draft',
      scope_of_work: selectedSubcontract.scope_of_work || 'erection',
      retention_pct: selectedSubcontract.retention_pct ?? 0.10,
      executed_date: selectedSubcontract.executed_date || '',
      start_date: selectedSubcontract.start_date || '',
      completion_date: selectedSubcontract.completion_date || '',
      insurance_verified: selectedSubcontract.insurance_verified || false,
      insurance_expiry_date: selectedSubcontract.insurance_expiry_date || '',
      w9_on_file: selectedSubcontract.w9_on_file || false,
      bonded: selectedSubcontract.bonded || false,
      bond_amount: selectedSubcontract.bond_amount || 0,
      notes: selectedSubcontract.notes || '',
    });
    setEditingSubcontract(true);
  };

  const handleSaveSubcontractEdit = async () => {
    if (!selectedSubcontract) return;
    setSavingSubcontractEdit(true);
    try {
      const updated = await db.entities.Subcontract.update(selectedSubcontract.id, editSubcontractForm);
      setSubcontracts((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      setSelectedSubcontract(updated);
      setEditingSubcontract(false);
      toast({ title: 'Subcontract updated' });
    } catch (e) {
      toast({ title: 'Unable to save changes', variant: 'destructive' });
    } finally {
      setSavingSubcontractEdit(false);
    }
  };

  // ============ TAB 2 — Pay Applications ============
  const [paSubcontractFilter, setPaSubcontractFilter] = useState('all');
  const [paProjectFilter, setPaProjectFilter] = useState('all');
  const [paStatusFilter, setPaStatusFilter] = useState('all');
  const [newPayAppOpen, setNewPayAppOpen] = useState(false);
  const [payAppForm, setPayAppForm] = useState(emptyPayAppForm());
  const [savingPayApp, setSavingPayApp] = useState(false);
  const [selectedPayApp, setSelectedPayApp] = useState(null);
  const [editingPayApp, setEditingPayApp] = useState(false);
  const [editPayAppForm, setEditPayAppForm] = useState({});
  const [savingPayAppEdit, setSavingPayAppEdit] = useState(false);
  const [payAppActionLoading, setPayAppActionLoading] = useState(null);

  const filteredPayApps = payApps.filter((p) => {
    if (paSubcontractFilter !== 'all' && p.subcontract_id !== paSubcontractFilter) return false;
    if (paProjectFilter !== 'all' && p.project_id !== paProjectFilter) return false;
    if (paStatusFilter !== 'all' && p.status !== paStatusFilter) return false;
    return true;
  });

  // Posts the sub's cost to job costing — called both from the quick "Mark
  // Paid" action and from the full edit form whenever a save transitions
  // status into 'paid', so there's exactly one code path that can create
  // this ledger entry no matter which UI action triggered the transition.
  const createSubLedgerEntry = async (payApp) => {
    const sc = subcontractById(payApp.subcontract_id);
    // Prefer the subcontract's real CostCode (matches the job costing axis
    // Meeting Mode and other job-cost reporting group by) — fall back to the
    // old subcontract-number pseudo-code only for subcontracts created
    // before this field existed, so their historical ledger entries don't
    // change retroactively.
    await db.entities.JobCostLedgerEntry.create({
      project_id: payApp.project_id,
      cost_code: sc?.cost_code || sc?.subcontract_number || 'SUBCONTRACT',
      cost_class: 'SUB',
      amount: payApp.amount_approved || 0,
      transaction_date: todayStr(),
      source_type: 'subcontract',
      source_id: payApp.id,
      description: `${sc?.subcontractor_name || 'Subcontractor'} Pay App #${payApp.pay_app_number}`,
    });
  };

  const handleCreatePayApp = async () => {
    if (!payAppForm.subcontract_id || !payAppForm.pay_app_number) return;
    setSavingPayApp(true);
    try {
      const sc = subcontractById(payAppForm.subcontract_id);
      const created = await db.entities.SubcontractPayApp.create({
        ...payAppForm,
        project_id: sc?.project_id || '',
        status: 'received',
        date_received: todayStr(),
      });
      setPayApps((prev) => [created, ...prev]);
      toast({ title: 'Pay application recorded' });
      setNewPayAppOpen(false);
      setPayAppForm(emptyPayAppForm());
    } catch (e) {
      toast({ title: 'Unable to record pay application', variant: 'destructive' });
    } finally {
      setSavingPayApp(false);
    }
  };

  const startEditingPayApp = () => {
    setEditPayAppForm({
      pay_app_number: selectedPayApp.pay_app_number || 1,
      period_start: selectedPayApp.period_start || '',
      period_end: selectedPayApp.period_end || '',
      amount_requested: selectedPayApp.amount_requested || 0,
      amount_approved: selectedPayApp.amount_approved || 0,
      retention_held: selectedPayApp.retention_held || 0,
      status: selectedPayApp.status || 'received',
      date_received: selectedPayApp.date_received || '',
      date_approved: selectedPayApp.date_approved || '',
      date_paid: selectedPayApp.date_paid || '',
      lien_waiver_received: selectedPayApp.lien_waiver_received || false,
      lien_waiver_type: selectedPayApp.lien_waiver_type || 'none',
      notes: selectedPayApp.notes || '',
    });
    setEditingPayApp(true);
  };

  const handleSavePayAppEdit = async () => {
    if (!selectedPayApp) return;
    setSavingPayAppEdit(true);
    try {
      const wasPaid = selectedPayApp.status === 'paid';
      const updated = await db.entities.SubcontractPayApp.update(selectedPayApp.id, editPayAppForm);
      if (!wasPaid && updated.status === 'paid') {
        await createSubLedgerEntry(updated);
      }
      setPayApps((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setSelectedPayApp(updated);
      setEditingPayApp(false);
      toast({ title: 'Pay application updated', description: !wasPaid && updated.status === 'paid' ? 'Posted to job costing.' : undefined });
    } catch (e) {
      toast({ title: 'Unable to save changes', variant: 'destructive' });
    } finally {
      setSavingPayAppEdit(false);
    }
  };

  const handleQuickApprove = async (payApp) => {
    const cprStatus = getCprStatus(payApp);
    if (cprStatus === 'missing' || cprStatus === 'deficient') {
      const proceed = window.confirm(
        cprStatus === 'missing'
          ? 'This is a prevailing wage project and no certified payroll (WH-347) submission is on file for this pay period. Approve anyway?'
          : 'This is a prevailing wage project and the certified payroll submission for this pay period is marked deficient. Approve anyway?'
      );
      if (!proceed) return;
    }
    setPayAppActionLoading(payApp.id);
    try {
      const updated = await db.entities.SubcontractPayApp.update(payApp.id, {
        status: 'approved',
        amount_approved: payApp.amount_approved || payApp.amount_requested || 0,
        date_approved: todayStr(),
      });
      setPayApps((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      if (selectedPayApp?.id === updated.id) setSelectedPayApp(updated);
      toast({ title: 'Pay application approved' });
    } catch (e) {
      toast({ title: 'Unable to approve', variant: 'destructive' });
    } finally {
      setPayAppActionLoading(null);
    }
  };

  // Stage 6 (AP retainage release) — creates ONE Payment covering every
  // retention_held dollar accumulated across every pay app on this
  // subcontract, tagged is_retainage_release so it's never mistaken for an
  // ordinary payment and never released twice. Only available once the
  // subcontract itself is marked complete.
  const handleReleaseRetainage = async (payApp) => {
    const subcontract = subcontractById(payApp.subcontract_id);
    const totalRetention = payApps.filter((p) => p.subcontract_id === payApp.subcontract_id).reduce((s, p) => s + (Number(p.retention_held) || 0), 0);
    if (totalRetention <= 0) { toast({ title: 'No retention held for this subcontract', variant: 'destructive' }); return; }
    const alreadyReleased = payments.some((p) => p.is_retainage_release && payApps.some((pa) => pa.id === p.related_entity_id && pa.subcontract_id === payApp.subcontract_id));
    if (alreadyReleased) { toast({ title: 'Retainage has already been released for this subcontract', variant: 'destructive' }); return; }

    const proceed = window.confirm(`Release ${money(totalRetention)} in held retainage to ${subcontract?.subcontractor_name || 'this subcontractor'}? This creates a payment record and cannot be undone.`);
    if (!proceed) return;

    const paymentDate = todayStr();
    const locked = await isPeriodLocked(paymentDate);
    let overrideReason = null;
    if (locked) {
      if (!canOverrideFinanceLock) { toast({ title: periodLockedMessage(paymentDate), variant: 'destructive' }); return; }
      overrideReason = window.prompt(`${periodLockedMessage(paymentDate)} Enter a reason to override and continue.`);
      if (!overrideReason || !overrideReason.trim()) { toast({ title: 'A reason is required', variant: 'destructive' }); return; }
    }

    setPayAppActionLoading(payApp.id);
    try {
      await recordPayment({
        direction: 'payable', relatedEntityType: 'SubcontractPayApp', relatedEntityId: payApp.id,
        amount: totalRetention, paymentDate, paymentMethod: 'other', notes: 'Retainage release',
        createdBy: identity, owedAmount: totalRetention, isRetainageRelease: true,
      });
      if (overrideReason) {
        await logFinancialOverride({ entityType: 'SubcontractPayApp', entityId: payApp.id, action: 'update', reason: `Closed-period override — retainage release: ${overrideReason.trim()}`, changedBy: user });
      }
      const freshPayments = await db.entities.Payment.filter({ related_entity_type: 'SubcontractPayApp' }, '-payment_date', 2000);
      setPayments(freshPayments);
      toast({ title: 'Retainage released', description: `${money(totalRetention)} recorded as paid.` });
    } catch (e) {
      toast({ title: 'Unable to release retainage', variant: 'destructive' });
    } finally {
      setPayAppActionLoading(null);
    }
  };

  const handleQuickMarkPaid = async (payApp) => {
    setPayAppActionLoading(payApp.id);
    try {
      const updated = await db.entities.SubcontractPayApp.update(payApp.id, { status: 'paid', date_paid: todayStr() });
      await createSubLedgerEntry(updated);
      setPayApps((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      if (selectedPayApp?.id === updated.id) setSelectedPayApp(updated);
      toast({ title: 'Pay application marked paid', description: 'Posted to job costing.' });
    } catch (e) {
      toast({ title: 'Unable to mark paid', variant: 'destructive' });
    } finally {
      setPayAppActionLoading(null);
    }
  };

  // ============ TAB 3 — Lien Waivers ============
  const [lwTypeFilter, setLwTypeFilter] = useState('all');
  const [lwProjectFilter, setLwProjectFilter] = useState('all');
  const [lwStatusFilter, setLwStatusFilter] = useState('all');
  const [newWaiverOpen, setNewWaiverOpen] = useState(false);
  const [waiverForm, setWaiverForm] = useState(emptyWaiverForm());
  const [savingWaiver, setSavingWaiver] = useState(false);
  const [selectedWaiver, setSelectedWaiver] = useState(null);
  const [editingWaiver, setEditingWaiver] = useState(false);
  const [editWaiverForm, setEditWaiverForm] = useState({});
  const [savingWaiverEdit, setSavingWaiverEdit] = useState(false);

  const filteredWaivers = waivers.filter((w) => {
    if (lwTypeFilter !== 'all' && w.waiver_type !== lwTypeFilter) return false;
    if (lwProjectFilter !== 'all' && w.project_id !== lwProjectFilter) return false;
    if (lwStatusFilter !== 'all' && w.status !== lwStatusFilter) return false;
    return true;
  });

  const waiverFormSubPayApps = payApps.filter((p) => p.subcontract_id === waiverForm.subcontract_id);

  const handleCreateWaiver = async () => {
    if (!waiverForm.subcontract_id || !waiverForm.waiver_type) return;
    setSavingWaiver(true);
    try {
      const sc = subcontractById(waiverForm.subcontract_id);
      const created = await db.entities.LienWaiver.create({
        ...waiverForm,
        project_id: sc?.project_id || '',
        status: 'received',
        date_received: waiverForm.date_received || todayStr(),
      });
      setWaivers((prev) => [created, ...prev]);
      toast({ title: 'Lien waiver recorded' });
      setNewWaiverOpen(false);
      setWaiverForm(emptyWaiverForm());
    } catch (e) {
      toast({ title: 'Unable to record lien waiver', variant: 'destructive' });
    } finally {
      setSavingWaiver(false);
    }
  };

  const startEditingWaiver = () => {
    setEditWaiverForm({
      waiver_type: selectedWaiver.waiver_type || 'conditional_progress',
      amount: selectedWaiver.amount || 0,
      through_date: selectedWaiver.through_date || '',
      date_received: selectedWaiver.date_received || '',
      date_notarized: selectedWaiver.date_notarized || '',
      is_notarized: selectedWaiver.is_notarized || false,
      status: selectedWaiver.status || 'pending',
      notes: selectedWaiver.notes || '',
    });
    setEditingWaiver(true);
  };

  const handleSaveWaiverEdit = async () => {
    if (!selectedWaiver) return;
    setSavingWaiverEdit(true);
    try {
      const updated = await db.entities.LienWaiver.update(selectedWaiver.id, editWaiverForm);
      setWaivers((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
      setSelectedWaiver(updated);
      setEditingWaiver(false);
      toast({ title: 'Lien waiver updated' });
    } catch (e) {
      toast({ title: 'Unable to save changes', variant: 'destructive' });
    } finally {
      setSavingWaiverEdit(false);
    }
  };

  // For every subcontract with at least one paid pay app, flag any paid pay
  // app that has no lien waiver record pointing back at it — a hard
  // compliance gap (money went out the door with no waiver on file), not
  // just a soft filter.
  const complianceRows = subcontracts
    .map((sc) => {
      const scPayApps = payApps.filter((p) => p.subcontract_id === sc.id);
      const paidPayApps = scPayApps.filter((p) => p.status === 'paid');
      const missingPayApps = paidPayApps.filter((p) => !waivers.some((w) => w.pay_app_id === p.id));
      return { subcontract: sc, paidCount: paidPayApps.length, missingPayApps };
    })
    .filter((r) => r.paidCount > 0);

  if (loading) {
    return (
      <div className="p-6 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />)}
      </div>
    );
  }

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader
        title="Subcontracts"
        subtitle="Subcontracts Hancock Steel issues to erection crews and other trade subs — scope through final payment"
        icon={FileSignature}
      />

      <Tabs defaultValue="subcontracts">
        <TabsList className="mb-4">
          <TabsTrigger value="subcontracts">Subcontracts</TabsTrigger>
          <TabsTrigger value="payapps">Pay Applications</TabsTrigger>
          <TabsTrigger value="waivers">Lien Waivers</TabsTrigger>
        </TabsList>

        {/* ============ TAB 1 ============ */}
        <TabsContent value="subcontracts">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {[
              { label: 'Active Subcontracts', value: scStats.activeCount, icon: FileSignature, color: 'text-blue-500' },
              { label: 'Total Committed Value', value: money(scStats.totalCommitted), icon: DollarSign, color: 'text-primary' },
              { label: 'Total Paid to Date', value: money(scStats.totalPaid), icon: Banknote, color: 'text-green-500' },
              { label: 'Retention Held', value: money(scStats.retentionHeld), icon: ShieldCheck, color: 'text-orange-500' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="steel-card p-4">
                <div className="flex items-center gap-2 mb-1"><Icon className={`w-4 h-4 ${color}`} /><p className="text-xs text-muted-foreground">{label}</p></div>
                <p className={`text-2xl font-bold ${color}`}>{value}</p>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <div className="flex gap-3 flex-wrap">
              <Select value={scProjectFilter} onValueChange={setScProjectFilter}>
                <SelectTrigger className="w-52"><SelectValue placeholder="All Projects" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Projects</SelectItem>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.project_number} — {p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={scStatusFilter} onValueChange={setScStatusFilter}>
                <SelectTrigger className="w-40"><SelectValue placeholder="All Statuses" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {SC_STATUSES.map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={scScopeFilter} onValueChange={setScScopeFilter}>
                <SelectTrigger className="w-40"><SelectValue placeholder="All Scopes" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Scopes</SelectItem>
                  {SCOPE_OPTIONS.map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <Dialog open={newSubcontractOpen} onOpenChange={setNewSubcontractOpen}>
              <DialogTrigger asChild>
                <Button className="steel-gradient text-white border-0"><Plus className="w-4 h-4 mr-2" />New Subcontract</Button>
              </DialogTrigger>
              <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
                <DialogHeader><DialogTitle>Create Subcontract</DialogTitle></DialogHeader>
                <div className="space-y-3 py-2">
                  <div>
                    <Label>Project *</Label>
                    <Select value={subcontractForm.project_id} onValueChange={(v) => setSubcontractForm((f) => ({ ...f, project_id: v }))}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Select project" /></SelectTrigger>
                      <SelectContent>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.project_number} — {p.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Vendor (CRM)</Label>
                    <Select value={subcontractForm.vendor_id} onValueChange={handleVendorPick}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Link to a vendor (optional)" /></SelectTrigger>
                      <SelectContent>{vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>Subcontractor Name *</Label><Input value={subcontractForm.subcontractor_name} onChange={(e) => setSubcontractForm((f) => ({ ...f, subcontractor_name: e.target.value }))} className="mt-1" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Subcontract Number</Label>
                      <Input value={subcontractForm.subcontract_number} onChange={(e) => setSubcontractForm((f) => ({ ...f, subcontract_number: e.target.value }))} className="mt-1" placeholder="Auto-generated if blank" />
                    </div>
                    <div>
                      <Label>Scope of Work</Label>
                      <Select value={subcontractForm.scope_of_work} onValueChange={(v) => setSubcontractForm((f) => ({ ...f, scope_of_work: v }))}>
                        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>{SCOPE_OPTIONS.map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Cost Code</Label>
                      <Select value={subcontractForm.cost_code} onValueChange={(v) => setSubcontractForm((f) => ({ ...f, cost_code: v }))}>
                        <SelectTrigger className="mt-1"><SelectValue placeholder="For job cost rollup" /></SelectTrigger>
                        <SelectContent>{costCodes.map((c) => <SelectItem key={c.id} value={c.code_name}>{c.code_name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Contract Value</Label>
                      <Input type="number" min={0} value={subcontractForm.contract_value} onChange={(e) => setSubcontractForm((f) => ({ ...f, contract_value: Number(e.target.value) || 0 }))} className="mt-1" />
                    </div>
                    <div>
                      <Label>Retention %</Label>
                      <Input type="number" min={0} max={1} step="0.01" value={subcontractForm.retention_pct} onChange={(e) => setSubcontractForm((f) => ({ ...f, retention_pct: Number(e.target.value) || 0 }))} className="mt-1" />
                    </div>
                    <div>
                      <Label>Executed Date</Label>
                      <Input type="date" value={subcontractForm.executed_date} onChange={(e) => setSubcontractForm((f) => ({ ...f, executed_date: e.target.value }))} className="mt-1" />
                    </div>
                    <div>
                      <Label>Start Date</Label>
                      <Input type="date" value={subcontractForm.start_date} onChange={(e) => setSubcontractForm((f) => ({ ...f, start_date: e.target.value }))} className="mt-1" />
                    </div>
                  </div>
                  <div><Label>Scope Description</Label><Textarea value={subcontractForm.scope_description} onChange={(e) => setSubcontractForm((f) => ({ ...f, scope_description: e.target.value }))} className="mt-1" rows={3} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex items-center justify-between rounded-lg border border-border p-3">
                      <Label className="text-sm">Insurance Verified</Label>
                      <Switch checked={subcontractForm.insurance_verified} onCheckedChange={(c) => setSubcontractForm((f) => ({ ...f, insurance_verified: c }))} />
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-border p-3">
                      <Label className="text-sm">W-9 on File</Label>
                      <Switch checked={subcontractForm.w9_on_file} onCheckedChange={(c) => setSubcontractForm((f) => ({ ...f, w9_on_file: c }))} />
                    </div>
                  </div>
                  <Button onClick={handleCreateSubcontract} disabled={savingSubcontract || !subcontractForm.project_id || !subcontractForm.subcontractor_name.trim()} className="w-full steel-gradient text-white border-0">
                    {savingSubcontract ? 'Creating...' : 'Create Subcontract'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="steel-card overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left py-2 px-3">SC Number</th>
                  <th className="text-left py-2 px-3">Subcontractor</th>
                  <th className="text-left py-2 px-3">Project</th>
                  <th className="text-left py-2 px-3">Scope</th>
                  <th className="text-right py-2 px-3">Contract Value</th>
                  <th className="text-left py-2 px-3">Status</th>
                  <th className="text-center py-2 px-3">Insurance</th>
                  <th className="text-center py-2 px-3">W-9</th>
                  <th className="text-right py-2 px-3">Retention %</th>
                </tr>
              </thead>
              <tbody>
                {filteredSubcontracts.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-12 text-sm text-muted-foreground">No subcontracts found</td></tr>
                ) : filteredSubcontracts.map((s) => {
                  const proj = projectById(s.project_id);
                  return (
                    <tr key={s.id} onClick={() => { setSelectedSubcontract(s); setEditingSubcontract(false); }} className="border-b border-border/50 hover:bg-muted/50 cursor-pointer">
                      <td className="py-2 px-3 font-mono font-medium">{s.subcontract_number || '—'}</td>
                      <td className="py-2 px-3 font-medium">{s.subcontractor_name}</td>
                      <td className="py-2 px-3 text-muted-foreground">{proj ? `${proj.project_number} — ${proj.name}` : '—'}</td>
                      <td className="py-2 px-3">{titleCase(s.scope_of_work)}</td>
                      <td className="py-2 px-3 text-right font-mono">{money(s.contract_value)}</td>
                      <td className="py-2 px-3"><StatusBadge status={s.status} label={titleCase(s.status)} /></td>
                      <td className="py-2 px-3 text-center">{s.insurance_verified ? <CheckCircle2 className="w-4 h-4 text-green-500 inline" /> : <XCircle className="w-4 h-4 text-red-500 inline" />}</td>
                      <td className="py-2 px-3 text-center">{s.w9_on_file ? <CheckCircle2 className="w-4 h-4 text-green-500 inline" /> : <XCircle className="w-4 h-4 text-red-500 inline" />}</td>
                      <td className="py-2 px-3 text-right">{((s.retention_pct ?? 0.10) * 100).toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* ============ TAB 2 ============ */}
        <TabsContent value="payapps">
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <div className="flex gap-3 flex-wrap">
              <Select value={paSubcontractFilter} onValueChange={setPaSubcontractFilter}>
                <SelectTrigger className="w-56"><SelectValue placeholder="All Subcontracts" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Subcontracts</SelectItem>
                  {subcontracts.map((s) => <SelectItem key={s.id} value={s.id}>{s.subcontract_number} — {s.subcontractor_name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={paProjectFilter} onValueChange={setPaProjectFilter}>
                <SelectTrigger className="w-52"><SelectValue placeholder="All Projects" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Projects</SelectItem>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.project_number} — {p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={paStatusFilter} onValueChange={setPaStatusFilter}>
                <SelectTrigger className="w-40"><SelectValue placeholder="All Statuses" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {PAY_APP_STATUSES.map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <Dialog open={newPayAppOpen} onOpenChange={setNewPayAppOpen}>
              <DialogTrigger asChild>
                <Button className="steel-gradient text-white border-0"><Plus className="w-4 h-4 mr-2" />Record Pay App</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Record Pay Application</DialogTitle></DialogHeader>
                <div className="space-y-3 py-2">
                  <div>
                    <Label>Subcontract *</Label>
                    <Select value={payAppForm.subcontract_id} onValueChange={(v) => setPayAppForm((f) => ({ ...f, subcontract_id: v }))}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Select subcontract" /></SelectTrigger>
                      <SelectContent>{subcontracts.map((s) => <SelectItem key={s.id} value={s.id}>{s.subcontract_number} — {s.subcontractor_name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Pay App #</Label><Input type="number" min={1} value={payAppForm.pay_app_number} onChange={(e) => setPayAppForm((f) => ({ ...f, pay_app_number: Number(e.target.value) || 1 }))} className="mt-1" /></div>
                    <div><Label>Amount Requested</Label><Input type="number" min={0} value={payAppForm.amount_requested} onChange={(e) => setPayAppForm((f) => ({ ...f, amount_requested: Number(e.target.value) || 0 }))} className="mt-1" /></div>
                    <div><Label>Period Start</Label><Input type="date" value={payAppForm.period_start} onChange={(e) => setPayAppForm((f) => ({ ...f, period_start: e.target.value }))} className="mt-1" /></div>
                    <div><Label>Period End</Label><Input type="date" value={payAppForm.period_end} onChange={(e) => setPayAppForm((f) => ({ ...f, period_end: e.target.value }))} className="mt-1" /></div>
                  </div>
                  <Button onClick={handleCreatePayApp} disabled={savingPayApp || !payAppForm.subcontract_id} className="w-full steel-gradient text-white border-0">
                    {savingPayApp ? 'Recording...' : 'Record Pay Application'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="steel-card overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left py-2 px-3">SC Number</th>
                  <th className="text-left py-2 px-3">Sub Name</th>
                  <th className="text-left py-2 px-3">Pay App #</th>
                  <th className="text-left py-2 px-3">Period</th>
                  <th className="text-right py-2 px-3">Requested</th>
                  <th className="text-right py-2 px-3">Approved</th>
                  <th className="text-left py-2 px-3">Status</th>
                  <th className="text-left py-2 px-3">Lien Waiver</th>
                  <th className="text-left py-2 px-3">CPR</th>
                </tr>
              </thead>
              <tbody>
                {filteredPayApps.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-12 text-sm text-muted-foreground">No pay applications found</td></tr>
                ) : filteredPayApps.map((p) => {
                  const sc = subcontractById(p.subcontract_id);
                  const cprStatus = getCprStatus(p);
                  return (
                    <tr key={p.id} onClick={() => { setSelectedPayApp(p); setEditingPayApp(false); }} className="border-b border-border/50 hover:bg-muted/50 cursor-pointer">
                      <td className="py-2 px-3 font-mono font-medium">{sc?.subcontract_number || '—'}</td>
                      <td className="py-2 px-3">{sc?.subcontractor_name || '—'}</td>
                      <td className="py-2 px-3">#{p.pay_app_number}</td>
                      <td className="py-2 px-3 text-xs text-muted-foreground">{p.period_start || '—'} – {p.period_end || '—'}</td>
                      <td className="py-2 px-3 text-right font-mono">{money(p.amount_requested)}</td>
                      <td className="py-2 px-3 text-right font-mono">{money(p.amount_approved)}</td>
                      <td className="py-2 px-3"><StatusBadge status={p.status} label={titleCase(p.status)} /></td>
                      <td className="py-2 px-3">
                        {p.lien_waiver_received ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-green-500/10 text-green-600 border-green-500/20"><CheckCircle2 className="w-3 h-3 mr-1" />{titleCase(p.lien_waiver_type)}</span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-red-500/10 text-red-500 border-red-500/20"><XCircle className="w-3 h-3 mr-1" />None</span>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        {cprStatus == null ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <div className="flex items-center gap-1 flex-wrap">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border bg-purple-500/10 text-purple-600 border-purple-500/20">CPR Required</span>
                            {cprStatus === 'missing' && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border bg-red-500/10 text-red-500 border-red-500/20"><AlertTriangle className="w-3 h-3" />Missing</span>}
                            {cprStatus === 'deficient' && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border bg-red-500/10 text-red-500 border-red-500/20"><AlertTriangle className="w-3 h-3" />Deficient</span>}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* ============ TAB 3 ============ */}
        <TabsContent value="waivers">
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <div className="flex gap-3 flex-wrap">
              <Select value={lwTypeFilter} onValueChange={setLwTypeFilter}>
                <SelectTrigger className="w-52"><SelectValue placeholder="All Types" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {Object.keys(WAIVER_TYPE_LABELS).map((k) => <SelectItem key={k} value={k}>{WAIVER_TYPE_LABELS[k]}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={lwProjectFilter} onValueChange={setLwProjectFilter}>
                <SelectTrigger className="w-52"><SelectValue placeholder="All Projects" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Projects</SelectItem>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.project_number} — {p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={lwStatusFilter} onValueChange={setLwStatusFilter}>
                <SelectTrigger className="w-40"><SelectValue placeholder="All Statuses" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {Object.keys(WAIVER_STATUS_STYLES).map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <Dialog open={newWaiverOpen} onOpenChange={setNewWaiverOpen}>
              <DialogTrigger asChild>
                <Button className="steel-gradient text-white border-0"><Plus className="w-4 h-4 mr-2" />Record Lien Waiver</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Record Lien Waiver</DialogTitle></DialogHeader>
                <div className="space-y-3 py-2">
                  <div>
                    <Label>Subcontract *</Label>
                    <Select value={waiverForm.subcontract_id} onValueChange={(v) => setWaiverForm((f) => ({ ...f, subcontract_id: v, pay_app_id: '' }))}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Select subcontract" /></SelectTrigger>
                      <SelectContent>{subcontracts.map((s) => <SelectItem key={s.id} value={s.id}>{s.subcontract_number} — {s.subcontractor_name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Pay Application (optional)</Label>
                    <Select value={waiverForm.pay_app_id} onValueChange={(v) => setWaiverForm((f) => ({ ...f, pay_app_id: v }))} disabled={!waiverForm.subcontract_id}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Link to a pay app (optional)" /></SelectTrigger>
                      <SelectContent>{waiverFormSubPayApps.map((p) => <SelectItem key={p.id} value={p.id}>Pay App #{p.pay_app_number} — {money(p.amount_requested)}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Waiver Type *</Label>
                    <Select value={waiverForm.waiver_type} onValueChange={(v) => setWaiverForm((f) => ({ ...f, waiver_type: v }))}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.keys(WAIVER_TYPE_LABELS).map((k) => <SelectItem key={k} value={k}>{WAIVER_TYPE_LABELS[k]}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Amount</Label><Input type="number" min={0} value={waiverForm.amount} onChange={(e) => setWaiverForm((f) => ({ ...f, amount: Number(e.target.value) || 0 }))} className="mt-1" /></div>
                    <div><Label>Through Date</Label><Input type="date" value={waiverForm.through_date} onChange={(e) => setWaiverForm((f) => ({ ...f, through_date: e.target.value }))} className="mt-1" /></div>
                    <div><Label>Date Received</Label><Input type="date" value={waiverForm.date_received} onChange={(e) => setWaiverForm((f) => ({ ...f, date_received: e.target.value }))} className="mt-1" /></div>
                    <div className="flex items-center justify-between rounded-lg border border-border p-3">
                      <Label className="text-sm">Notarized</Label>
                      <Switch checked={waiverForm.is_notarized} onCheckedChange={(c) => setWaiverForm((f) => ({ ...f, is_notarized: c }))} />
                    </div>
                  </div>
                  <Button onClick={handleCreateWaiver} disabled={savingWaiver || !waiverForm.subcontract_id} className="w-full steel-gradient text-white border-0">
                    {savingWaiver ? 'Recording...' : 'Record Lien Waiver'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {complianceRows.length > 0 && (
            <div className="steel-card p-4 mb-4">
              <h3 className="font-semibold text-sm mb-3 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-orange-500" />Lien Waiver Compliance</h3>
              <div className="space-y-2">
                {complianceRows.map(({ subcontract, paidCount, missingPayApps }) => (
                  <div key={subcontract.id} className="flex items-center justify-between text-sm p-2 rounded-lg hover:bg-muted/40">
                    <div>
                      <span className="font-medium">{subcontract.subcontractor_name}</span>
                      <span className="text-xs text-muted-foreground ml-2">{paidCount} paid pay app{paidCount === 1 ? '' : 's'}</span>
                    </div>
                    {missingPayApps.length > 0 ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-red-500/10 text-red-500 border-red-500/20">
                        Missing — Pay App{missingPayApps.length === 1 ? '' : 's'} {missingPayApps.map((p) => `#${p.pay_app_number}`).join(', ')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-green-500/10 text-green-600 border-green-500/20"><CheckCircle2 className="w-3 h-3 mr-1" />Compliant</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="steel-card overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left py-2 px-3">Sub Name</th>
                  <th className="text-left py-2 px-3">Project</th>
                  <th className="text-left py-2 px-3">Type</th>
                  <th className="text-right py-2 px-3">Amount</th>
                  <th className="text-left py-2 px-3">Through Date</th>
                  <th className="text-left py-2 px-3">Received Date</th>
                  <th className="text-center py-2 px-3">Notarized</th>
                  <th className="text-left py-2 px-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredWaivers.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-12 text-sm text-muted-foreground">No lien waivers found</td></tr>
                ) : filteredWaivers.map((w) => {
                  const sc = subcontractById(w.subcontract_id);
                  const proj = projectById(w.project_id);
                  return (
                    <tr key={w.id} onClick={() => { setSelectedWaiver(w); setEditingWaiver(false); }} className="border-b border-border/50 hover:bg-muted/50 cursor-pointer">
                      <td className="py-2 px-3 font-medium">{sc?.subcontractor_name || '—'}</td>
                      <td className="py-2 px-3 text-muted-foreground">{proj ? `${proj.project_number} — ${proj.name}` : '—'}</td>
                      <td className="py-2 px-3">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-purple-500/10 text-purple-500 border-purple-500/20">{WAIVER_TYPE_LABELS[w.waiver_type] || w.waiver_type}</span>
                      </td>
                      <td className="py-2 px-3 text-right font-mono">{money(w.amount)}</td>
                      <td className="py-2 px-3 text-xs text-muted-foreground">{w.through_date || '—'}</td>
                      <td className="py-2 px-3 text-xs text-muted-foreground">{w.date_received || '—'}</td>
                      <td className="py-2 px-3 text-center">{w.is_notarized ? <CheckCircle2 className="w-4 h-4 text-green-500 inline" /> : <XCircle className="w-4 h-4 text-muted-foreground inline" />}</td>
                      <td className="py-2 px-3">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${WAIVER_STATUS_STYLES[w.status] || WAIVER_STATUS_STYLES.pending}`}>{titleCase(w.status)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>

      {/* ============ Subcontract detail dialog ============ */}
      <Dialog open={!!selectedSubcontract} onOpenChange={(o) => { if (!o) { setSelectedSubcontract(null); setEditingSubcontract(false); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selectedSubcontract && !editingSubcontract && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-primary">{selectedSubcontract.subcontract_number}</span>
                  <span>{selectedSubcontract.subcontractor_name}</span>
                </DialogTitle>
              </DialogHeader>
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge status={selectedSubcontract.status} label={titleCase(selectedSubcontract.status)} />
                <span className="text-xs text-muted-foreground">{titleCase(selectedSubcontract.scope_of_work)}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  { label: 'Project', value: projectById(selectedSubcontract.project_id) ? `${projectById(selectedSubcontract.project_id).project_number} — ${projectById(selectedSubcontract.project_id).name}` : '—' },
                  { label: 'Contract Value', value: money(selectedSubcontract.contract_value) },
                  { label: 'Retention %', value: `${((selectedSubcontract.retention_pct ?? 0.10) * 100).toFixed(1)}%` },
                  { label: 'Executed Date', value: selectedSubcontract.executed_date || '—' },
                  { label: 'Start Date', value: selectedSubcontract.start_date || '—' },
                  { label: 'Completion Date', value: selectedSubcontract.completion_date || '—' },
                  { label: 'Insurance Verified', value: selectedSubcontract.insurance_verified ? 'Yes' : 'No' },
                  { label: 'Insurance Expiry', value: selectedSubcontract.insurance_expiry_date || '—' },
                  { label: 'W-9 on File', value: selectedSubcontract.w9_on_file ? 'Yes' : 'No' },
                  { label: 'Bonded', value: selectedSubcontract.bonded ? `Yes — ${money(selectedSubcontract.bond_amount)}` : 'No' },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="font-medium">{value}</p>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Scope Description</p>
                <p className="text-sm mt-1 whitespace-pre-wrap">{selectedSubcontract.scope_description || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Notes</p>
                <p className="text-sm mt-1 whitespace-pre-wrap">{selectedSubcontract.notes || 'No notes'}</p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setSelectedSubcontract(null)}>Close</Button>
                <Button onClick={startEditingSubcontract} className="steel-gradient text-white border-0">Edit</Button>
              </div>
            </>
          )}

          {selectedSubcontract && editingSubcontract && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className="font-mono text-primary">{selectedSubcontract.subcontract_number}</span>
                  <span className="text-sm text-muted-foreground font-normal">Edit Subcontract</span>
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div><Label>Subcontractor Name</Label><Input value={editSubcontractForm.subcontractor_name} onChange={(e) => setEditSubcontractForm((f) => ({ ...f, subcontractor_name: e.target.value }))} className="mt-1" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Status</Label>
                    <Select value={editSubcontractForm.status} onValueChange={(v) => setEditSubcontractForm((f) => ({ ...f, status: v }))}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>{SC_STATUSES.map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Scope of Work</Label>
                    <Select value={editSubcontractForm.scope_of_work} onValueChange={(v) => setEditSubcontractForm((f) => ({ ...f, scope_of_work: v }))}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>{SCOPE_OPTIONS.map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>Subcontract Number</Label><Input value={editSubcontractForm.subcontract_number} onChange={(e) => setEditSubcontractForm((f) => ({ ...f, subcontract_number: e.target.value }))} className="mt-1" /></div>
                  <div>
                    <Label>Cost Code</Label>
                    <Select value={editSubcontractForm.cost_code} onValueChange={(v) => setEditSubcontractForm((f) => ({ ...f, cost_code: v }))}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="For job cost rollup" /></SelectTrigger>
                      <SelectContent>{costCodes.map((c) => <SelectItem key={c.id} value={c.code_name}>{c.code_name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>Contract Value</Label><Input type="number" min={0} value={editSubcontractForm.contract_value} onChange={(e) => setEditSubcontractForm((f) => ({ ...f, contract_value: Number(e.target.value) || 0 }))} className="mt-1" /></div>
                  <div><Label>Retention %</Label><Input type="number" min={0} max={1} step="0.01" value={editSubcontractForm.retention_pct} onChange={(e) => setEditSubcontractForm((f) => ({ ...f, retention_pct: Number(e.target.value) || 0 }))} className="mt-1" /></div>
                  <div><Label>Bond Amount</Label><Input type="number" min={0} value={editSubcontractForm.bond_amount} onChange={(e) => setEditSubcontractForm((f) => ({ ...f, bond_amount: Number(e.target.value) || 0 }))} className="mt-1" /></div>
                  <div><Label>Executed Date</Label><Input type="date" value={editSubcontractForm.executed_date} onChange={(e) => setEditSubcontractForm((f) => ({ ...f, executed_date: e.target.value }))} className="mt-1" /></div>
                  <div><Label>Start Date</Label><Input type="date" value={editSubcontractForm.start_date} onChange={(e) => setEditSubcontractForm((f) => ({ ...f, start_date: e.target.value }))} className="mt-1" /></div>
                  <div><Label>Completion Date</Label><Input type="date" value={editSubcontractForm.completion_date} onChange={(e) => setEditSubcontractForm((f) => ({ ...f, completion_date: e.target.value }))} className="mt-1" /></div>
                  <div><Label>Insurance Expiry</Label><Input type="date" value={editSubcontractForm.insurance_expiry_date} onChange={(e) => setEditSubcontractForm((f) => ({ ...f, insurance_expiry_date: e.target.value }))} className="mt-1" /></div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="flex items-center justify-between rounded-lg border border-border p-3">
                    <Label className="text-sm">Insurance Verified</Label>
                    <Switch checked={editSubcontractForm.insurance_verified} onCheckedChange={(c) => setEditSubcontractForm((f) => ({ ...f, insurance_verified: c }))} />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border p-3">
                    <Label className="text-sm">W-9 on File</Label>
                    <Switch checked={editSubcontractForm.w9_on_file} onCheckedChange={(c) => setEditSubcontractForm((f) => ({ ...f, w9_on_file: c }))} />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border p-3">
                    <Label className="text-sm">Bonded</Label>
                    <Switch checked={editSubcontractForm.bonded} onCheckedChange={(c) => setEditSubcontractForm((f) => ({ ...f, bonded: c }))} />
                  </div>
                </div>
                <div><Label>Scope Description</Label><Textarea value={editSubcontractForm.scope_description} onChange={(e) => setEditSubcontractForm((f) => ({ ...f, scope_description: e.target.value }))} className="mt-1" rows={3} /></div>
                <div><Label>Notes</Label><Textarea value={editSubcontractForm.notes} onChange={(e) => setEditSubcontractForm((f) => ({ ...f, notes: e.target.value }))} className="mt-1" rows={2} /></div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setEditingSubcontract(false)}>Cancel</Button>
                  <Button onClick={handleSaveSubcontractEdit} disabled={savingSubcontractEdit} className="steel-gradient text-white border-0">
                    {savingSubcontractEdit ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ============ Pay App detail dialog ============ */}
      <Dialog open={!!selectedPayApp} onOpenChange={(o) => { if (!o) { setSelectedPayApp(null); setEditingPayApp(false); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selectedPayApp && !editingPayApp && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-primary">{subcontractById(selectedPayApp.subcontract_id)?.subcontract_number}</span>
                  <span>Pay App #{selectedPayApp.pay_app_number}</span>
                </DialogTitle>
              </DialogHeader>
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge status={selectedPayApp.status} label={titleCase(selectedPayApp.status)} />
                <span className="text-xs text-muted-foreground">{subcontractById(selectedPayApp.subcontract_id)?.subcontractor_name}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  { label: 'Period', value: `${selectedPayApp.period_start || '—'} – ${selectedPayApp.period_end || '—'}` },
                  { label: 'Amount Requested', value: money(selectedPayApp.amount_requested) },
                  { label: 'Amount Approved', value: money(selectedPayApp.amount_approved) },
                  { label: 'Retention Held', value: money(selectedPayApp.retention_held) },
                  { label: 'Date Received', value: selectedPayApp.date_received || '—' },
                  { label: 'Date Approved', value: selectedPayApp.date_approved || '—' },
                  { label: 'Date Paid', value: selectedPayApp.date_paid || '—' },
                  { label: 'Lien Waiver', value: selectedPayApp.lien_waiver_received ? titleCase(selectedPayApp.lien_waiver_type) : 'Not received' },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="font-medium">{value}</p>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Notes</p>
                <p className="text-sm mt-1 whitespace-pre-wrap">{selectedPayApp.notes || 'No notes'}</p>
              </div>
              <div className="flex justify-end gap-2 pt-2 flex-wrap">
                <Button variant="outline" onClick={() => setSelectedPayApp(null)}>Close</Button>
                {selectedPayApp.status !== 'approved' && selectedPayApp.status !== 'paid' && (
                  <Button variant="outline" className="text-blue-600 border-blue-500/30 hover:bg-blue-500/10" disabled={payAppActionLoading === selectedPayApp.id} onClick={() => handleQuickApprove(selectedPayApp)}>
                    <FileCheck2 className="w-4 h-4 mr-1.5" />{payAppActionLoading === selectedPayApp.id ? 'Approving…' : 'Approve'}
                  </Button>
                )}
                {selectedPayApp.status !== 'paid' && (
                  <Button variant="outline" className="text-green-600 border-green-500/30 hover:bg-green-500/10" disabled={payAppActionLoading === selectedPayApp.id} onClick={() => handleQuickMarkPaid(selectedPayApp)}>
                    <HandCoins className="w-4 h-4 mr-1.5" />{payAppActionLoading === selectedPayApp.id ? 'Posting…' : 'Mark Paid'}
                  </Button>
                )}
                {subcontractById(selectedPayApp.subcontract_id)?.status === 'complete' && (
                  <Button
                    variant="outline"
                    className="text-purple-600 border-purple-500/30 hover:bg-purple-500/10"
                    disabled={payAppActionLoading === selectedPayApp.id}
                    onClick={() => handleReleaseRetainage(selectedPayApp)}
                  >
                    <Banknote className="w-4 h-4 mr-1.5" />{payAppActionLoading === selectedPayApp.id ? 'Releasing…' : 'Release Retainage'}
                  </Button>
                )}
                <Button onClick={startEditingPayApp} className="steel-gradient text-white border-0">Edit</Button>
              </div>
            </>
          )}

          {selectedPayApp && editingPayApp && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className="font-mono text-primary">{subcontractById(selectedPayApp.subcontract_id)?.subcontract_number}</span>
                  <span className="text-sm text-muted-foreground font-normal">Edit Pay App #{selectedPayApp.pay_app_number}</span>
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Status</Label>
                    <Select value={editPayAppForm.status} onValueChange={(v) => setEditPayAppForm((f) => ({ ...f, status: v }))}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>{PAY_APP_STATUSES.map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Lien Waiver Type</Label>
                    <Select value={editPayAppForm.lien_waiver_type} onValueChange={(v) => setEditPayAppForm((f) => ({ ...f, lien_waiver_type: v, lien_waiver_received: v !== 'none' }))}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="conditional">Conditional</SelectItem>
                        <SelectItem value="unconditional">Unconditional</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Amount Requested</Label><Input type="number" min={0} value={editPayAppForm.amount_requested} onChange={(e) => setEditPayAppForm((f) => ({ ...f, amount_requested: Number(e.target.value) || 0 }))} className="mt-1" /></div>
                  <div><Label>Amount Approved</Label><Input type="number" min={0} value={editPayAppForm.amount_approved} onChange={(e) => setEditPayAppForm((f) => ({ ...f, amount_approved: Number(e.target.value) || 0 }))} className="mt-1" /></div>
                  <div><Label>Retention Held</Label><Input type="number" min={0} value={editPayAppForm.retention_held} onChange={(e) => setEditPayAppForm((f) => ({ ...f, retention_held: Number(e.target.value) || 0 }))} className="mt-1" /></div>
                  <div><Label>Period Start</Label><Input type="date" value={editPayAppForm.period_start} onChange={(e) => setEditPayAppForm((f) => ({ ...f, period_start: e.target.value }))} className="mt-1" /></div>
                  <div><Label>Period End</Label><Input type="date" value={editPayAppForm.period_end} onChange={(e) => setEditPayAppForm((f) => ({ ...f, period_end: e.target.value }))} className="mt-1" /></div>
                  <div><Label>Date Received</Label><Input type="date" value={editPayAppForm.date_received} onChange={(e) => setEditPayAppForm((f) => ({ ...f, date_received: e.target.value }))} className="mt-1" /></div>
                  <div><Label>Date Approved</Label><Input type="date" value={editPayAppForm.date_approved} onChange={(e) => setEditPayAppForm((f) => ({ ...f, date_approved: e.target.value }))} className="mt-1" /></div>
                  <div><Label>Date Paid</Label><Input type="date" value={editPayAppForm.date_paid} onChange={(e) => setEditPayAppForm((f) => ({ ...f, date_paid: e.target.value }))} className="mt-1" /></div>
                </div>
                <div><Label>Notes</Label><Textarea value={editPayAppForm.notes} onChange={(e) => setEditPayAppForm((f) => ({ ...f, notes: e.target.value }))} className="mt-1" rows={2} /></div>
                <p className="text-xs text-muted-foreground">Setting status to Paid here will also post a job cost ledger entry, same as the quick "Mark Paid" action.</p>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setEditingPayApp(false)}>Cancel</Button>
                  <Button onClick={handleSavePayAppEdit} disabled={savingPayAppEdit} className="steel-gradient text-white border-0">
                    {savingPayAppEdit ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ============ Lien Waiver detail dialog ============ */}
      <Dialog open={!!selectedWaiver} onOpenChange={(o) => { if (!o) { setSelectedWaiver(null); setEditingWaiver(false); } }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          {selectedWaiver && !editingWaiver && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  <span>{subcontractById(selectedWaiver.subcontract_id)?.subcontractor_name}</span>
                  <span className="text-sm text-muted-foreground font-normal">{WAIVER_TYPE_LABELS[selectedWaiver.waiver_type]}</span>
                </DialogTitle>
              </DialogHeader>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border w-fit ${WAIVER_STATUS_STYLES[selectedWaiver.status] || WAIVER_STATUS_STYLES.pending}`}>{titleCase(selectedWaiver.status)}</span>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  { label: 'Amount', value: money(selectedWaiver.amount) },
                  { label: 'Through Date', value: selectedWaiver.through_date || '—' },
                  { label: 'Date Received', value: selectedWaiver.date_received || '—' },
                  { label: 'Date Notarized', value: selectedWaiver.date_notarized || '—' },
                  { label: 'Notarized', value: selectedWaiver.is_notarized ? 'Yes' : 'No' },
                  { label: 'Pay App', value: (() => { const p = payApps.find((p) => p.id === selectedWaiver.pay_app_id); return p ? `#${p.pay_app_number}` : '—'; })() },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="font-medium">{value}</p>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Notes</p>
                <p className="text-sm mt-1 whitespace-pre-wrap">{selectedWaiver.notes || 'No notes'}</p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setSelectedWaiver(null)}>Close</Button>
                <Button onClick={startEditingWaiver} className="steel-gradient text-white border-0">Edit</Button>
              </div>
            </>
          )}

          {selectedWaiver && editingWaiver && (
            <>
              <DialogHeader><DialogTitle className="text-sm font-normal text-muted-foreground">Edit Lien Waiver</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Status</Label>
                  <Select value={editWaiverForm.status} onValueChange={(v) => setEditWaiverForm((f) => ({ ...f, status: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.keys(WAIVER_STATUS_STYLES).map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Waiver Type</Label>
                  <Select value={editWaiverForm.waiver_type} onValueChange={(v) => setEditWaiverForm((f) => ({ ...f, waiver_type: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.keys(WAIVER_TYPE_LABELS).map((k) => <SelectItem key={k} value={k}>{WAIVER_TYPE_LABELS[k]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Amount</Label><Input type="number" min={0} value={editWaiverForm.amount} onChange={(e) => setEditWaiverForm((f) => ({ ...f, amount: Number(e.target.value) || 0 }))} className="mt-1" /></div>
                  <div><Label>Through Date</Label><Input type="date" value={editWaiverForm.through_date} onChange={(e) => setEditWaiverForm((f) => ({ ...f, through_date: e.target.value }))} className="mt-1" /></div>
                  <div><Label>Date Received</Label><Input type="date" value={editWaiverForm.date_received} onChange={(e) => setEditWaiverForm((f) => ({ ...f, date_received: e.target.value }))} className="mt-1" /></div>
                  <div><Label>Date Notarized</Label><Input type="date" value={editWaiverForm.date_notarized} onChange={(e) => setEditWaiverForm((f) => ({ ...f, date_notarized: e.target.value }))} className="mt-1" /></div>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border p-3">
                  <Label className="text-sm">Notarized</Label>
                  <Switch checked={editWaiverForm.is_notarized} onCheckedChange={(c) => setEditWaiverForm((f) => ({ ...f, is_notarized: c }))} />
                </div>
                <div><Label>Notes</Label><Textarea value={editWaiverForm.notes} onChange={(e) => setEditWaiverForm((f) => ({ ...f, notes: e.target.value }))} className="mt-1" rows={2} /></div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setEditingWaiver(false)}>Cancel</Button>
                  <Button onClick={handleSaveWaiverEdit} disabled={savingWaiverEdit} className="steel-gradient text-white border-0">
                    {savingWaiverEdit ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
