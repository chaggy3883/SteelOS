import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { AlertTriangle, Truck, Warehouse, Plus, Gauge, Wrench, DollarSign, History, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';
import { resolveAssetRate } from '@/components/field-operations/EquipmentUsagePanel';
import PurchaseOrderDetailModal from '@/components/purchasing/PurchaseOrderDetailModal';
import RepairDetailDialog from '@/components/field-operations/RepairDetailDialog';

const ASSET_TYPES = ['Crane', 'Truck', 'Trailer', 'Rigging_Equipment', 'Other'];
const OWNERSHIP_STATUSES = ['Internal_Owned', 'Third_Party_Rented'];
const COST_RATE_TYPES = ['owned', 'rented', 'none'];
const emptyAssetForm = () => ({
  asset_name: '', asset_type: 'Crane', status: 'Internal_Owned', runtime_hours: '', maintenance_threshold_hours: '500',
  project_location_id: '', rental_vendor_id: '', rental_target_off_rent_date: '', linked_po_id: '',
});
const costRateFormFor = (asset) => ({
  cost_per_hour: asset?.cost_per_hour || 0,
  rental_rate_per_hour: asset?.rental_rate_per_hour || 0,
  cost_rate_type: asset?.cost_rate_type || 'none',
  default_cost_code: asset?.default_cost_code || 'EQP-001',
});

// Ownership-dependent fields shared by both create and the Edit Asset form —
// clearing rental_vendor_id/linked_po_id/etc. (and the PO-mismatch-override
// trail) the moment an asset ends up Internal_Owned, regardless of whether
// it was actually flipped from rented or just already owned.
const buildOwnershipFields = (form) => {
  const isRented = form.status === 'Third_Party_Rented';
  return {
    status: form.status,
    rental_vendor_id: isRented ? form.rental_vendor_id : '',
    rental_target_off_rent_date: isRented ? form.rental_target_off_rent_date : '',
    linked_po_id: isRented ? form.linked_po_id : '',
    ...(!isRented ? {
      is_marked_ready_for_pickup: false,
      po_vendor_mismatch_override: false,
      po_vendor_mismatch_reason: '',
      po_vendor_mismatch_overridden_by: '',
      po_vendor_mismatch_overridden_at: '',
    } : {}),
  };
};

const getOffRentOverdueDays = (asset) => {
  if (asset.status !== 'Third_Party_Rented' || !asset.rental_target_off_rent_date) return 0;
  const target = new Date(asset.rental_target_off_rent_date);
  const today = new Date();
  target.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  const days = Math.floor((today - target) / 86400000);
  return days > 0 ? days : 0;
};

export default function FleetRentalRegistry({ assets, projects, vendors, purchaseOrders = [], usageLogs = [], repairLogs = [], canManageFleet, canOverridePoMismatch = false, currentUser, onTogglePickup, onReload }) {
  const { toast } = useToast();
  const [showAddForm, setShowAddForm] = useState(false);
  const [assetForm, setAssetForm] = useState(emptyAssetForm());
  const [saving, setSaving] = useState(false);
  const [logHoursAsset, setLogHoursAsset] = useState(null);
  const [logHoursValue, setLogHoursValue] = useState('');
  const [detailAsset, setDetailAsset] = useState(null);
  const [costRateForm, setCostRateForm] = useState(costRateFormFor(null));
  const [savingCostRate, setSavingCostRate] = useState(false);
  const [editingAsset, setEditingAsset] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [overridePrompt, setOverridePrompt] = useState(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [confirmingOverride, setConfirmingOverride] = useState(false);
  const [detailPoId, setDetailPoId] = useState(null);
  const [showPoDetail, setShowPoDetail] = useState(false);
  const [viewingRepair, setViewingRepair] = useState(null);
  const [showRepairDetail, setShowRepairDetail] = useState(false);
  const [confirmingReturn, setConfirmingReturn] = useState(null);
  const [returnDate, setReturnDate] = useState('');
  const [savingReturn, setSavingReturn] = useState(false);

  const rentalVendors = useMemo(() => vendors.filter((v) => v.vendor_type === 'equipment_rental'), [vendors]);

  const projectName = (id) => projects.find((p) => p.id === id)?.name || '—';
  const vendorName = (id) => vendors.find((v) => v.id === id)?.name || '—';
  const poNumber = (id) => purchaseOrders.find((po) => po.id === id)?.po_number || '—';
  const isDueForMaintenance = (asset) => ((asset.runtime_hours || 0) - (asset.last_pm_runtime_hours || 0)) >= (asset.maintenance_threshold_hours || Infinity);

  // Section B — a Third_Party_Rented asset's linked PO vendor must match its
  // rental_vendor_id. Returns null when there's nothing to compare (owned,
  // no PO/vendor picked yet, or PO has no vendor of its own).
  const evaluateMismatch = (form) => {
    if (!form || form.status !== 'Third_Party_Rented' || !form.linked_po_id || !form.rental_vendor_id) return null;
    const po = purchaseOrders.find((p) => p.id === form.linked_po_id);
    if (!po || !po.vendor_id || po.vendor_id === form.rental_vendor_id) return null;
    return { poVendorId: po.vendor_id, poVendorName: vendorName(po.vendor_id), rentalVendorName: vendorName(form.rental_vendor_id) };
  };

  const createMismatch = evaluateMismatch(assetForm);
  const editMismatch = editingAsset ? evaluateMismatch(editForm) : null;

  useEffect(() => {
    if (showAddForm && createMismatch) {
      toast({ title: 'PO vendor does not match rental vendor', description: `PO vendor: ${createMismatch.poVendorName} vs selected rental vendor: ${createMismatch.rentalVendorName}`, variant: 'destructive' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createMismatch?.poVendorId, createMismatch?.rentalVendorName, showAddForm]);

  useEffect(() => {
    if (editingAsset && editMismatch) {
      toast({ title: 'PO vendor does not match rental vendor', description: `PO vendor: ${editMismatch.poVendorName} vs selected rental vendor: ${editMismatch.rentalVendorName}`, variant: 'destructive' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMismatch?.poVendorId, editMismatch?.rentalVendorName, editingAsset]);

  const handleAddAsset = async (overrideReasonText) => {
    if (!assetForm.asset_name.trim()) {
      toast({ title: 'Asset name is required', variant: 'destructive' });
      return;
    }
    if (assetForm.status === 'Third_Party_Rented' && !assetForm.linked_po_id) {
      toast({ title: 'A Purchase Order is required for rented equipment', description: 'Select an open PO before this asset can be committed or dispatched.', variant: 'destructive' });
      return;
    }
    const mismatch = evaluateMismatch(assetForm);
    if (mismatch && !overrideReasonText) {
      toast({ title: 'PO vendor does not match rental vendor', description: `PO vendor: ${mismatch.poVendorName} vs selected rental vendor: ${mismatch.rentalVendorName}`, variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await db.entities.erection_fleet_assets.create({
        asset_name: assetForm.asset_name.trim(),
        asset_type: assetForm.asset_type,
        runtime_hours: Number(assetForm.runtime_hours) || 0,
        last_pm_runtime_hours: 0,
        maintenance_threshold_hours: Number(assetForm.maintenance_threshold_hours) || 500,
        project_location_id: assetForm.project_location_id,
        is_marked_ready_for_pickup: false,
        ...buildOwnershipFields(assetForm),
        ...(mismatch && overrideReasonText ? {
          po_vendor_mismatch_override: true,
          po_vendor_mismatch_reason: overrideReasonText,
          po_vendor_mismatch_overridden_by: currentUser?.id || currentUser?.email || '',
          po_vendor_mismatch_overridden_at: new Date().toISOString(),
        } : {}),
      });
      await onReload();
      setShowAddForm(false);
      setAssetForm(emptyAssetForm());
      toast({ title: 'Fleet asset added' });
    } finally {
      setSaving(false);
    }
  };

  const handleLogHours = async () => {
    if (!logHoursAsset) return;
    setSaving(true);
    try {
      await db.entities.erection_fleet_assets.update(logHoursAsset.id, { runtime_hours: Number(logHoursValue) || 0 });
      await onReload();
      setLogHoursAsset(null);
      setLogHoursValue('');
      toast({ title: `${logHoursAsset.asset_name} runtime hours updated` });
    } finally {
      setSaving(false);
    }
  };

  const openDetail = (asset) => {
    setDetailAsset(asset);
    setCostRateForm(costRateFormFor(asset));
    setEditingAsset(false);
    setEditForm(null);
  };

  const handleSaveCostRate = async () => {
    if (!detailAsset) return;
    setSavingCostRate(true);
    try {
      await db.entities.erection_fleet_assets.update(detailAsset.id, {
        cost_per_hour: Number(costRateForm.cost_per_hour) || 0,
        rental_rate_per_hour: Number(costRateForm.rental_rate_per_hour) || 0,
        cost_rate_type: costRateForm.cost_rate_type,
        default_cost_code: costRateForm.default_cost_code.trim() || 'EQP-001',
      });
      await onReload();
      toast({ title: 'Cost rate saved' });
    } finally {
      setSavingCostRate(false);
    }
  };

  // Re-derived from the live `assets` prop (not the stale snapshot captured
  // when the dialog opened) so a just-saved cost rate shows immediately
  // without having to close and reopen the dialog.
  const liveDetailAsset = detailAsset ? (assets.find((a) => a.id === detailAsset.id) || detailAsset) : null;

  const openEdit = () => {
    const a = liveDetailAsset;
    if (!a) return;
    setEditForm({
      asset_name: a.asset_name || '',
      asset_type: a.asset_type || 'Crane',
      status: a.status || 'Internal_Owned',
      project_location_id: a.project_location_id || '',
      rental_vendor_id: a.rental_vendor_id || '',
      rental_target_off_rent_date: a.rental_target_off_rent_date || '',
      linked_po_id: a.linked_po_id || '',
      maintenance_threshold_hours: String(a.maintenance_threshold_hours || 500),
    });
    setEditingAsset(true);
  };

  const cancelEdit = () => {
    setEditingAsset(false);
    setEditForm(null);
  };

  const handleSaveAssetEdit = async (overrideReasonText) => {
    if (!detailAsset || !editForm) return;
    if (!editForm.asset_name.trim()) {
      toast({ title: 'Asset name is required', variant: 'destructive' });
      return;
    }
    if (editForm.status === 'Third_Party_Rented' && !editForm.linked_po_id) {
      toast({ title: 'A Purchase Order is required for rented equipment', description: 'Select an open PO before this asset can be committed or dispatched.', variant: 'destructive' });
      return;
    }
    const mismatch = evaluateMismatch(editForm);
    if (mismatch && !overrideReasonText) {
      toast({ title: 'PO vendor does not match rental vendor', description: `PO vendor: ${mismatch.poVendorName} vs selected rental vendor: ${mismatch.rentalVendorName}`, variant: 'destructive' });
      return;
    }
    setSavingEdit(true);
    try {
      const updated = await db.entities.erection_fleet_assets.update(detailAsset.id, {
        asset_name: editForm.asset_name.trim(),
        asset_type: editForm.asset_type,
        project_location_id: editForm.project_location_id,
        maintenance_threshold_hours: Number(editForm.maintenance_threshold_hours) || 500,
        ...buildOwnershipFields(editForm),
        ...(mismatch && overrideReasonText ? {
          po_vendor_mismatch_override: true,
          po_vendor_mismatch_reason: overrideReasonText,
          po_vendor_mismatch_overridden_by: currentUser?.id || currentUser?.email || '',
          po_vendor_mismatch_overridden_at: new Date().toISOString(),
        } : {}),
      });
      await onReload();
      setDetailAsset(updated);
      setEditingAsset(false);
      setEditForm(null);
      toast({ title: 'Asset updated' });
    } finally {
      setSavingEdit(false);
    }
  };

  const confirmOverride = async () => {
    if (!overridePrompt || overrideReason.trim().length < 10) return;
    setConfirmingOverride(true);
    try {
      if (overridePrompt.mode === 'create') {
        await handleAddAsset(overrideReason.trim());
      } else {
        await handleSaveAssetEdit(overrideReason.trim());
      }
      setOverridePrompt(null);
      setOverrideReason('');
    } finally {
      setConfirmingOverride(false);
    }
  };

  const openConfirmReturn = (asset) => {
    setConfirmingReturn(asset);
    setReturnDate(new Date().toISOString().slice(0, 10));
  };

  const handleConfirmReturn = async () => {
    if (!confirmingReturn || !returnDate) return;
    setSavingReturn(true);
    try {
      const updated = await db.entities.erection_fleet_assets.update(confirmingReturn.id, {
        ...buildOwnershipFields({ status: 'Internal_Owned' }),
        last_returned_date: returnDate,
      });
      await onReload();
      if (detailAsset?.id === confirmingReturn.id) setDetailAsset(updated);
      setConfirmingReturn(null);
      setReturnDate('');
      toast({ title: `${confirmingReturn.asset_name} confirmed returned` });
    } finally {
      setSavingReturn(false);
    }
  };

  const openPoDetail = (poId) => {
    if (!poId) return;
    setDetailPoId(poId);
    setShowPoDetail(true);
  };

  const detailUsageLogs = useMemo(
    () => (detailAsset ? usageLogs.filter((l) => l.asset_id === detailAsset.id).sort((a, b) => new Date(b.usage_date) - new Date(a.usage_date)) : []),
    [usageLogs, detailAsset]
  );

  const detailRepairLogs = useMemo(
    () => (detailAsset ? repairLogs.filter((r) => r.asset_id === detailAsset.id).sort((a, b) => new Date(b.repair_date) - new Date(a.repair_date)) : []),
    [repairLogs, detailAsset]
  );

  const detailCostSummary = useMemo(() => {
    const totalHours = detailUsageLogs.reduce((sum, l) => sum + (l.hours_used || 0), 0);
    const totalCostPosted = detailUsageLogs.filter((l) => l.posted_to_job_cost).reduce((sum, l) => sum + (l.total_cost || 0), 0);
    const byProject = new Map();
    detailUsageLogs.forEach((l) => {
      const entry = byProject.get(l.project_id) || { hours: 0, cost: 0 };
      entry.hours += l.hours_used || 0;
      entry.cost += l.total_cost || 0;
      byProject.set(l.project_id, entry);
    });
    return { totalHours, totalCostPosted, byProject: Array.from(byProject.entries()) };
  }, [detailUsageLogs]);

  const lifetimeRepairCost = useMemo(() => detailRepairLogs.reduce((sum, r) => sum + (r.cost_cents || 0), 0) / 100, [detailRepairLogs]);

  const overdueAssets = useMemo(
    () => assets
      .map((asset) => ({ asset, days: getOffRentOverdueDays(asset) }))
      .filter((x) => x.days > 0)
      .sort((a, b) => b.days - a.days),
    [assets]
  );

  const nextPmDueAtHrs = liveDetailAsset ? (liveDetailAsset.last_pm_runtime_hours || 0) + (liveDetailAsset.maintenance_threshold_hours || 0) : 0;
  const pmRemaining = liveDetailAsset ? nextPmDueAtHrs - (liveDetailAsset.runtime_hours || 0) : 0;

  return (
    <div className="space-y-3">
      {overdueAssets.length > 0 && (
        <div className="rounded-lg border-2 border-red-500/50 bg-red-500/5 p-4 space-y-2">
          <p className="text-sm font-semibold text-red-600 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />{overdueAssets.length} rented asset(s) past target off-rent date — accruing rental charges
          </p>
          <div className="space-y-1">
            {overdueAssets.map(({ asset, days }) => (
              <button
                key={asset.id}
                onClick={() => openDetail(asset)}
                className="flex items-center justify-between w-full text-sm px-2 py-1.5 rounded hover:bg-red-500/10 text-left"
              >
                <span className="font-medium">{asset.asset_name}</span>
                <span className="text-red-600 font-mono text-xs">{days} day{days === 1 ? '' : 's'} overdue</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {canManageFleet && (
        <div className="flex justify-end">
          <Button size="sm" className="gap-2 steel-gradient text-white border-0" onClick={() => setShowAddForm(true)}>
            <Plus className="w-3.5 h-3.5" />Add Equipment
          </Button>
        </div>
      )}

      <div className="steel-card p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Asset</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Ownership</TableHead>
              <TableHead>Purchase Order</TableHead>
              <TableHead>Project Location</TableHead>
              <TableHead>Runtime Hours</TableHead>
              <TableHead>Rental Off-Rent Target</TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {assets.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">No fleet assets on file.</TableCell>
              </TableRow>
            )}
            {assets.map((asset) => {
              const isRented = asset.status === 'Third_Party_Rented';
              const overdueDays = getOffRentOverdueDays(asset);
              return (
                <TableRow key={asset.id} onClick={() => openDetail(asset)} className="cursor-pointer">
                  <TableCell className="font-medium flex items-center gap-2">
                    {isRented ? <Warehouse className="w-4 h-4 text-muted-foreground" /> : <Truck className="w-4 h-4 text-muted-foreground" />}
                    {asset.asset_name}
                  </TableCell>
                  <TableCell className="text-sm">{asset.asset_type?.replace(/_/g, ' ')}</TableCell>
                  <TableCell>
                    <Badge variant={isRented ? 'outline' : 'secondary'}>{isRented ? 'Third-Party Rented' : 'Internal Owned'}</Badge>
                    {isRented && <p className="text-xs text-muted-foreground mt-0.5">{vendorName(asset.rental_vendor_id)}</p>}
                  </TableCell>
                  <TableCell>
                    {isRented ? (
                      <div className="space-y-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); openPoDetail(asset.linked_po_id); }}
                          disabled={!asset.linked_po_id}
                          className="font-mono text-sm text-primary hover:underline disabled:no-underline disabled:text-muted-foreground disabled:cursor-default"
                        >
                          {poNumber(asset.linked_po_id)}
                        </button>
                        {asset.po_vendor_mismatch_override && (
                          <Badge className="block w-fit bg-amber-500/15 text-amber-600 border-amber-500/30 text-[10px]">PO Override</Badge>
                        )}
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{projectName(asset.project_location_id)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-sm">{(asset.runtime_hours || 0).toLocaleString()}</span>
                      {isDueForMaintenance(asset) && (
                        <Badge variant="destructive" className="gap-1 text-[10px]"><Wrench className="w-3 h-3" />PM Due</Badge>
                      )}
                      {canManageFleet && (
                        <Button size="icon" variant="ghost" className="h-6 w-6" title="Log Hours" onClick={(e) => { e.stopPropagation(); setLogHoursAsset(asset); setLogHoursValue(String(asset.runtime_hours || 0)); }}>
                          <Gauge className="w-3.5 h-3.5 text-muted-foreground" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm font-mono">{isRented ? (asset.rental_target_off_rent_date || '—') : '—'}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-col items-end gap-1.5">
                      {overdueDays > 0 && (
                        <Badge variant="destructive" className="gap-1 text-[10px]">
                          <AlertTriangle className="w-3 h-3" />{overdueDays} DAYS PAST OFF-RENT
                        </Badge>
                      )}
                      {asset.is_marked_ready_for_pickup ? (
                        <>
                          <Badge className="bg-amber-500 text-black border-0 gap-1 animate-pulse">
                            <AlertTriangle className="w-3 h-3" />OFF-RENT TRIGGERED — CALL FOR PICKUP
                          </Badge>
                          {canManageFleet && (
                            <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); openConfirmReturn(asset); }}>
                              Equipment Called Off
                            </Button>
                          )}
                        </>
                      ) : isRented && canManageFleet ? (
                        <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onTogglePickup(asset); }}>Mark Ready for Pickup</Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={showAddForm} onOpenChange={setShowAddForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Fleet Equipment</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Asset Name</Label>
              <Input value={assetForm.asset_name} onChange={(e) => setAssetForm((f) => ({ ...f, asset_name: e.target.value }))} className="mt-1" placeholder="Crane 3 — Grove GMK4100" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Asset Type</Label>
                <Select value={assetForm.asset_type} onValueChange={(v) => setAssetForm((f) => ({ ...f, asset_type: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{ASSET_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Ownership</Label>
                <Select value={assetForm.status} onValueChange={(v) => setAssetForm((f) => ({ ...f, status: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{OWNERSHIP_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Runtime Hours (input)</Label>
                <Input type="number" value={assetForm.runtime_hours} onChange={(e) => setAssetForm((f) => ({ ...f, runtime_hours: e.target.value }))} className="mt-1" placeholder="0" />
              </div>
              <div>
                <Label>Maintenance Threshold (hrs)</Label>
                <Input type="number" value={assetForm.maintenance_threshold_hours} onChange={(e) => setAssetForm((f) => ({ ...f, maintenance_threshold_hours: e.target.value }))} className="mt-1" />
              </div>
            </div>
            <div>
              <Label>Project Location</Label>
              <Select value={assetForm.project_location_id} onValueChange={(v) => setAssetForm((f) => ({ ...f, project_location_id: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {assetForm.status === 'Third_Party_Rented' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Rental Vendor</Label>
                    <Select value={assetForm.rental_vendor_id} onValueChange={(v) => setAssetForm((f) => ({ ...f, rental_vendor_id: v }))}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Select vendor" /></SelectTrigger>
                      <SelectContent>{rentalVendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Target Off-Rent Date</Label>
                    <Input type="date" value={assetForm.rental_target_off_rent_date} onChange={(e) => setAssetForm((f) => ({ ...f, rental_target_off_rent_date: e.target.value }))} className="mt-1" />
                  </div>
                </div>
                <div>
                  <Label>Purchase Order <span className="text-red-500">*required for rented equipment</span></Label>
                  <Select value={assetForm.linked_po_id} onValueChange={(v) => setAssetForm((f) => ({ ...f, linked_po_id: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select an open PO" /></SelectTrigger>
                    <SelectContent>
                      {purchaseOrders.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No open POs available</div>}
                      {purchaseOrders.map((po) => <SelectItem key={po.id} value={po.id}>{po.po_number} — {vendorName(po.vendor_id)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {createMismatch && (
                  <p className="text-xs text-destructive">PO vendor ({createMismatch.poVendorName}) does not match rental vendor ({createMismatch.rentalVendorName}).</p>
                )}
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddForm(false)}>Cancel</Button>
            {createMismatch && canOverridePoMismatch && (
              <Button variant="outline" className="gap-1.5 border-amber-500/40 text-amber-600" onClick={() => setOverridePrompt({ mode: 'create', poVendorName: createMismatch.poVendorName, rentalVendorName: createMismatch.rentalVendorName })}>
                <ShieldAlert className="w-3.5 h-3.5" />Override (Accounting)
              </Button>
            )}
            <Button
              onClick={() => handleAddAsset()}
              disabled={saving || (assetForm.status === 'Third_Party_Rented' && !assetForm.linked_po_id) || !!createMismatch}
              className="steel-gradient text-white border-0"
            >
              {saving ? 'Saving…' : 'Add Equipment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!logHoursAsset} onOpenChange={(open) => !open && setLogHoursAsset(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Log Runtime Hours — {logHoursAsset?.asset_name}</DialogTitle></DialogHeader>
          <div>
            <Label>Current Runtime Hours</Label>
            <Input type="number" value={logHoursValue} onChange={(e) => setLogHoursValue(e.target.value)} className="mt-1" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLogHoursAsset(null)}>Cancel</Button>
            <Button onClick={handleLogHours} disabled={saving} className="steel-gradient text-white border-0">{saving ? 'Saving…' : 'Update Hours'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!overridePrompt} onOpenChange={(o) => { if (!o) { setOverridePrompt(null); setOverrideReason(''); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Accounting Override — PO Vendor Mismatch</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            PO vendor <span className="font-semibold text-foreground">{overridePrompt?.poVendorName}</span> does not match the selected rental vendor <span className="font-semibold text-foreground">{overridePrompt?.rentalVendorName}</span>. Provide a reason to proceed anyway.
          </p>
          <div>
            <Label>Override Reason (min 10 characters)</Label>
            <Textarea rows={3} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} className="mt-1" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOverridePrompt(null); setOverrideReason(''); }}>Cancel</Button>
            <Button
              onClick={confirmOverride}
              disabled={overrideReason.trim().length < 10 || confirmingOverride}
              className="bg-amber-600 hover:bg-amber-700 text-white border-0"
            >
              {confirmingOverride ? 'Saving…' : 'Confirm Override & Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detailAsset} onOpenChange={(open) => { if (!open) { setDetailAsset(null); setEditingAsset(false); setEditForm(null); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {detailAsset && (
            <>
              <DialogHeader className="flex-row items-center justify-between gap-3 pr-8 space-y-0">
                <DialogTitle>{detailAsset.asset_name}</DialogTitle>
                {canManageFleet && !editingAsset && (
                  <Button size="sm" variant="outline" onClick={openEdit}>Edit Asset</Button>
                )}
              </DialogHeader>

              {editingAsset && editForm ? (
                <div className="space-y-3">
                  <div>
                    <Label>Asset Name</Label>
                    <Input value={editForm.asset_name} onChange={(e) => setEditForm((f) => ({ ...f, asset_name: e.target.value }))} className="mt-1" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Asset Type</Label>
                      <Select value={editForm.asset_type} onValueChange={(v) => setEditForm((f) => ({ ...f, asset_type: v }))}>
                        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>{ASSET_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Ownership</Label>
                      <Select value={editForm.status} onValueChange={(v) => setEditForm((f) => ({ ...f, status: v }))}>
                        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>{OWNERSHIP_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Project Location</Label>
                      <Select value={editForm.project_location_id} onValueChange={(v) => setEditForm((f) => ({ ...f, project_location_id: v }))}>
                        <SelectTrigger className="mt-1"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                        <SelectContent>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Maintenance Threshold (hrs)</Label>
                      <Input type="number" value={editForm.maintenance_threshold_hours} onChange={(e) => setEditForm((f) => ({ ...f, maintenance_threshold_hours: e.target.value }))} className="mt-1" />
                    </div>
                  </div>
                  {editForm.status === 'Third_Party_Rented' && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label>Rental Vendor</Label>
                          <Select value={editForm.rental_vendor_id} onValueChange={(v) => setEditForm((f) => ({ ...f, rental_vendor_id: v }))}>
                            <SelectTrigger className="mt-1"><SelectValue placeholder="Select vendor" /></SelectTrigger>
                            <SelectContent>{rentalVendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Target Off-Rent Date</Label>
                          <Input type="date" value={editForm.rental_target_off_rent_date} onChange={(e) => setEditForm((f) => ({ ...f, rental_target_off_rent_date: e.target.value }))} className="mt-1" />
                        </div>
                      </div>
                      <div>
                        <Label>Purchase Order <span className="text-red-500">*required for rented equipment</span></Label>
                        <Select value={editForm.linked_po_id} onValueChange={(v) => setEditForm((f) => ({ ...f, linked_po_id: v }))}>
                          <SelectTrigger className="mt-1"><SelectValue placeholder="Select an open PO" /></SelectTrigger>
                          <SelectContent>
                            {purchaseOrders.map((po) => <SelectItem key={po.id} value={po.id}>{po.po_number} — {vendorName(po.vendor_id)}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      {editMismatch && (
                        <p className="text-xs text-destructive">PO vendor ({editMismatch.poVendorName}) does not match rental vendor ({editMismatch.rentalVendorName}).</p>
                      )}
                    </>
                  )}
                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={cancelEdit}>Cancel</Button>
                    {editMismatch && canOverridePoMismatch && (
                      <Button variant="outline" className="gap-1.5 border-amber-500/40 text-amber-600" onClick={() => setOverridePrompt({ mode: 'edit', poVendorName: editMismatch.poVendorName, rentalVendorName: editMismatch.rentalVendorName })}>
                        <ShieldAlert className="w-3.5 h-3.5" />Override (Accounting)
                      </Button>
                    )}
                    <Button
                      onClick={() => handleSaveAssetEdit()}
                      disabled={savingEdit || (editForm.status === 'Third_Party_Rented' && !editForm.linked_po_id) || !!editMismatch}
                      className="steel-gradient text-white border-0"
                    >
                      {savingEdit ? 'Saving…' : 'Save Changes'}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  {liveDetailAsset?.po_vendor_mismatch_override && (
                    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm space-y-1">
                      <p className="font-semibold text-amber-700 flex items-center gap-1.5"><ShieldAlert className="w-4 h-4" />PO Vendor Mismatch — Accounting Override</p>
                      <p className="text-muted-foreground">Reason: {liveDetailAsset.po_vendor_mismatch_reason || '—'}</p>
                      <p className="text-xs text-muted-foreground">
                        Overridden by {liveDetailAsset.po_vendor_mismatch_overridden_by || '—'} on {liveDetailAsset.po_vendor_mismatch_overridden_at ? new Date(liveDetailAsset.po_vendor_mismatch_overridden_at).toLocaleString() : '—'}
                      </p>
                    </div>
                  )}

                  <div>
                    <h4 className="font-semibold text-sm mb-2 flex items-center gap-2"><DollarSign className="w-4 h-4 text-primary" />Cost Rate</h4>
                    <p className="text-xs text-muted-foreground mb-2">
                      Effective rate applied to new usage logs: <span className="font-semibold text-foreground">${resolveAssetRate(liveDetailAsset).toLocaleString()}/hr</span>
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Cost Rate Type</Label>
                        <Select value={costRateForm.cost_rate_type} onValueChange={(v) => setCostRateForm((f) => ({ ...f, cost_rate_type: v }))}>
                          <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                          <SelectContent>{COST_RATE_TYPES.map((t) => <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-xs">Default Cost Code</Label>
                        <Input value={costRateForm.default_cost_code} onChange={(e) => setCostRateForm((f) => ({ ...f, default_cost_code: e.target.value }))} className="mt-1" />
                      </div>
                      <div>
                        <Label className="text-xs">Cost per Hour (owned)</Label>
                        <Input type="number" min={0} value={costRateForm.cost_per_hour} onChange={(e) => setCostRateForm((f) => ({ ...f, cost_per_hour: e.target.value }))} className="mt-1" />
                      </div>
                      <div>
                        <Label className="text-xs">Rental Rate per Hour (rented)</Label>
                        <Input type="number" min={0} value={costRateForm.rental_rate_per_hour} onChange={(e) => setCostRateForm((f) => ({ ...f, rental_rate_per_hour: e.target.value }))} className="mt-1" />
                      </div>
                    </div>
                    <div className="flex justify-end mt-2">
                      <Button size="sm" onClick={handleSaveCostRate} disabled={savingCostRate} className="steel-gradient text-white border-0">
                        {savingCostRate ? 'Saving…' : 'Save Cost Rate'}
                      </Button>
                    </div>
                  </div>

                  {liveDetailAsset?.status === 'Third_Party_Rented' && (
                    <div>
                      <h4 className="font-semibold text-sm mb-2 flex items-center gap-2"><DollarSign className="w-4 h-4 text-primary" />Rental Burn</h4>
                      {(() => {
                        const po = purchaseOrders.find((p) => p.id === liveDetailAsset.linked_po_id);
                        const poTotal = Number(po?.budgeted_cost || po?.actual_cost || 0);
                        const burned = detailCostSummary.totalCostPosted;
                        const pct = poTotal > 0 ? Math.round((burned / poTotal) * 100) : 0;
                        const barColor = pct >= 100 ? 'bg-red-500' : pct >= 90 ? 'bg-amber-500' : 'bg-primary';
                        const textColor = pct >= 100 ? 'text-red-600' : pct >= 90 ? 'text-amber-600' : 'text-foreground';
                        return (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">
                                ${burned.toLocaleString(undefined, { maximumFractionDigits: 0 })} posted of ${poTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })} PO ({poNumber(liveDetailAsset.linked_po_id)})
                              </span>
                              <span className={`font-semibold ${textColor}`}>{pct}%</span>
                            </div>
                            <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                            </div>
                            {pct >= 100 && (
                              <p className="text-xs text-red-600 font-medium">Rental cost has exceeded its PO — revise the PO before further usage is logged</p>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  <div>
                    <h4 className="font-semibold text-sm mb-2 flex items-center gap-2"><Gauge className="w-4 h-4 text-primary" />Cost Summary</h4>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div className="rounded-lg border border-border p-3">
                        <p className="text-xs text-muted-foreground">Total Hours Logged (all-time)</p>
                        <p className="text-lg font-bold">{detailCostSummary.totalHours.toLocaleString()}</p>
                      </div>
                      <div className="rounded-lg border border-border p-3">
                        <p className="text-xs text-muted-foreground">Total Cost Posted to Job Cost</p>
                        <p className="text-lg font-bold">${detailCostSummary.totalCostPosted.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                      </div>
                    </div>
                    {detailCostSummary.byProject.length > 0 && (
                      <div className="space-y-1">
                        {detailCostSummary.byProject.map(([projectId, { hours, cost }]) => (
                          <div key={projectId} className="flex items-center justify-between text-sm px-2 py-1.5 rounded hover:bg-muted/40">
                            <span>{projectName(projectId)}</span>
                            <span className="text-muted-foreground">{hours.toLocaleString()} hrs · ${cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <h4 className="font-semibold text-sm mb-2 flex items-center gap-2"><Wrench className="w-4 h-4 text-primary" />Maintenance History</h4>
                    <div className="grid grid-cols-3 gap-3 mb-3">
                      <div className="rounded-lg border border-border p-3">
                        <p className="text-xs text-muted-foreground">Next PM Due At</p>
                        <p className="text-lg font-bold">{nextPmDueAtHrs.toLocaleString()} hrs</p>
                      </div>
                      <div className="rounded-lg border border-border p-3">
                        <p className="text-xs text-muted-foreground">Remaining</p>
                        {pmRemaining >= 0 ? (
                          <p className="text-lg font-bold">{pmRemaining.toLocaleString()} hrs</p>
                        ) : (
                          <p className="text-lg font-bold text-red-600">OVERDUE by {Math.abs(pmRemaining).toLocaleString()} hrs</p>
                        )}
                      </div>
                      <div className="rounded-lg border border-border p-3">
                        <p className="text-xs text-muted-foreground">Lifetime Repair Cost</p>
                        <p className="text-lg font-bold">${lifetimeRepairCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                      </div>
                    </div>
                    {detailRepairLogs.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4 text-center">No repairs logged for this asset yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {detailRepairLogs.map((log) => (
                          <div
                            key={log.id}
                            onClick={() => { setViewingRepair(log); setShowRepairDetail(true); }}
                            className="flex items-center justify-between gap-2 rounded-lg border border-border p-2.5 text-sm cursor-pointer hover:bg-muted/50 transition-colors"
                          >
                            <div>
                              <p className="font-medium">{log.repair_category.replace(/_/g, ' ')}</p>
                              <p className="text-xs text-muted-foreground">{log.repair_date}{log.notes ? ` • ${log.notes}` : ''}</p>
                            </div>
                            <span className="font-mono text-sm flex-shrink-0">${((log.cost_cents || 0) / 100).toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <h4 className="font-semibold text-sm mb-2 flex items-center gap-2"><History className="w-4 h-4 text-primary" />Usage History</h4>
                    {detailUsageLogs.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4 text-center">No usage logged for this asset yet.</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Project</TableHead>
                            <TableHead className="text-right">Hours</TableHead>
                            <TableHead className="text-right">Cost</TableHead>
                            <TableHead>Posted</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {detailUsageLogs.map((log) => (
                            <TableRow key={log.id}>
                              <TableCell className="text-xs">{log.usage_date}</TableCell>
                              <TableCell className="text-sm">{projectName(log.project_id)}</TableCell>
                              <TableCell className="text-right font-mono">{log.hours_used}</TableCell>
                              <TableCell className="text-right font-mono">${(log.total_cost || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                              <TableCell>{log.posted_to_job_cost ? <Badge variant="secondary" className="text-[10px]">Posted</Badge> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>

                  <DialogFooter>
                    <Button variant="outline" onClick={() => setDetailAsset(null)}>Close</Button>
                  </DialogFooter>
                </>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmingReturn} onOpenChange={(open) => { if (!open) { setConfirmingReturn(null); setReturnDate(''); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Confirm Equipment Return — {confirmingReturn?.asset_name}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Confirms the vendor has actually retrieved this asset. This clears its rental assignment, PO link, and off-rent tracking, and returns it to Internal Owned status in the registry.
          </p>
          <div>
            <Label>Actual Pickup Date</Label>
            <Input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} className="mt-1" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirmingReturn(null); setReturnDate(''); }}>Cancel</Button>
            <Button onClick={handleConfirmReturn} disabled={savingReturn || !returnDate} className="steel-gradient text-white border-0">
              {savingReturn ? 'Saving…' : 'Confirm Return'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PurchaseOrderDetailModal open={showPoDetail} onOpenChange={setShowPoDetail} poId={detailPoId} />

      <RepairDetailDialog
        repair={viewingRepair}
        open={showRepairDetail}
        onOpenChange={(o) => { setShowRepairDetail(o); if (!o) setViewingRepair(null); }}
        assets={assets}
        projects={projects}
        vendors={vendors}
      />
    </div>
  );
}
