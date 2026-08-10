import React, { useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { AlertTriangle, Truck, Warehouse, Plus, Gauge, Wrench, DollarSign, History } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';
import { resolveAssetRate } from '@/components/field-operations/EquipmentUsagePanel';

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

export default function FleetRentalRegistry({ assets, projects, vendors, purchaseOrders = [], usageLogs = [], canManageFleet, onTogglePickup, onReload }) {
  const { toast } = useToast();
  const [showAddForm, setShowAddForm] = useState(false);
  const [assetForm, setAssetForm] = useState(emptyAssetForm());
  const [saving, setSaving] = useState(false);
  const [logHoursAsset, setLogHoursAsset] = useState(null);
  const [logHoursValue, setLogHoursValue] = useState('');
  const [detailAsset, setDetailAsset] = useState(null);
  const [costRateForm, setCostRateForm] = useState(costRateFormFor(null));
  const [savingCostRate, setSavingCostRate] = useState(false);

  const projectName = (id) => projects.find((p) => p.id === id)?.name || '—';
  const vendorName = (id) => vendors.find((v) => v.id === id)?.name || '—';
  const poNumber = (id) => purchaseOrders.find((po) => po.id === id)?.po_number || '—';
  const isDueForMaintenance = (asset) => (asset.runtime_hours || 0) >= (asset.maintenance_threshold_hours || Infinity);

  const handleAddAsset = async () => {
    if (!assetForm.asset_name.trim()) {
      toast({ title: 'Asset name is required', variant: 'destructive' });
      return;
    }
    if (assetForm.status === 'Third_Party_Rented' && !assetForm.linked_po_id) {
      toast({ title: 'A Purchase Order is required for rented equipment', description: 'Select an open PO before this asset can be committed or dispatched.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await db.entities.erection_fleet_assets.create({
        asset_name: assetForm.asset_name.trim(),
        asset_type: assetForm.asset_type,
        status: assetForm.status,
        runtime_hours: Number(assetForm.runtime_hours) || 0,
        maintenance_threshold_hours: Number(assetForm.maintenance_threshold_hours) || 500,
        project_location_id: assetForm.project_location_id,
        rental_vendor_id: assetForm.status === 'Third_Party_Rented' ? assetForm.rental_vendor_id : '',
        rental_target_off_rent_date: assetForm.status === 'Third_Party_Rented' ? assetForm.rental_target_off_rent_date : '',
        linked_po_id: assetForm.status === 'Third_Party_Rented' ? assetForm.linked_po_id : '',
        is_marked_ready_for_pickup: false,
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

  const detailUsageLogs = useMemo(
    () => (detailAsset ? usageLogs.filter((l) => l.asset_id === detailAsset.id).sort((a, b) => new Date(b.usage_date) - new Date(a.usage_date)) : []),
    [usageLogs, detailAsset]
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

  return (
    <div className="space-y-3">
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
              <TableHead>Project Location</TableHead>
              <TableHead>Runtime Hours</TableHead>
              <TableHead>Rental Off-Rent Target</TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {assets.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">No fleet assets on file.</TableCell>
              </TableRow>
            )}
            {assets.map((asset) => {
              const isRented = asset.status === 'Third_Party_Rented';
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
                    {isRented && <p className="text-xs text-muted-foreground font-mono">{poNumber(asset.linked_po_id)}</p>}
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
                    {asset.is_marked_ready_for_pickup ? (
                      <Badge className="bg-amber-500 text-black border-0 gap-1 animate-pulse">
                        <AlertTriangle className="w-3 h-3" />OFF-RENT TRIGGERED — CALL FOR PICKUP
                      </Badge>
                    ) : isRented && canManageFleet ? (
                      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onTogglePickup(asset); }}>Mark Ready for Pickup</Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
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
                      <SelectContent>{vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
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
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddForm(false)}>Cancel</Button>
            <Button
              onClick={handleAddAsset}
              disabled={saving || (assetForm.status === 'Third_Party_Rented' && !assetForm.linked_po_id)}
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

      <Dialog open={!!detailAsset} onOpenChange={(open) => !open && setDetailAsset(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {detailAsset && (
            <>
              <DialogHeader><DialogTitle>{detailAsset.asset_name}</DialogTitle></DialogHeader>

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
        </DialogContent>
      </Dialog>
    </div>
  );
}
