import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { AlertTriangle, Truck, Warehouse, Plus, Gauge, Wrench } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';

const ASSET_TYPES = ['Crane', 'Truck', 'Trailer', 'Rigging_Equipment', 'Other'];
const OWNERSHIP_STATUSES = ['Internal_Owned', 'Third_Party_Rented'];
const emptyAssetForm = () => ({
  asset_name: '', asset_type: 'Crane', status: 'Internal_Owned', runtime_hours: '', maintenance_threshold_hours: '500',
  project_location_id: '', rental_vendor_id: '', rental_target_off_rent_date: '',
});

export default function FleetRentalRegistry({ assets, projects, vendors, canManageFleet, onTogglePickup, onReload }) {
  const { toast } = useToast();
  const [showAddForm, setShowAddForm] = useState(false);
  const [assetForm, setAssetForm] = useState(emptyAssetForm());
  const [saving, setSaving] = useState(false);
  const [logHoursAsset, setLogHoursAsset] = useState(null);
  const [logHoursValue, setLogHoursValue] = useState('');

  const projectName = (id) => projects.find((p) => p.id === id)?.name || '—';
  const vendorName = (id) => vendors.find((v) => v.id === id)?.name || '—';
  const isDueForMaintenance = (asset) => (asset.runtime_hours || 0) >= (asset.maintenance_threshold_hours || Infinity);

  const handleAddAsset = async () => {
    if (!assetForm.asset_name.trim()) {
      toast({ title: 'Asset name is required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await base44.entities.erection_fleet_assets.create({
        asset_name: assetForm.asset_name.trim(),
        asset_type: assetForm.asset_type,
        status: assetForm.status,
        runtime_hours: Number(assetForm.runtime_hours) || 0,
        maintenance_threshold_hours: Number(assetForm.maintenance_threshold_hours) || 500,
        project_location_id: assetForm.project_location_id,
        rental_vendor_id: assetForm.status === 'Third_Party_Rented' ? assetForm.rental_vendor_id : '',
        rental_target_off_rent_date: assetForm.status === 'Third_Party_Rented' ? assetForm.rental_target_off_rent_date : '',
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
      await base44.entities.erection_fleet_assets.update(logHoursAsset.id, { runtime_hours: Number(logHoursValue) || 0 });
      await onReload();
      setLogHoursAsset(null);
      setLogHoursValue('');
      toast({ title: `${logHoursAsset.asset_name} runtime hours updated` });
    } finally {
      setSaving(false);
    }
  };

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
                <TableRow key={asset.id}>
                  <TableCell className="font-medium flex items-center gap-2">
                    {isRented ? <Warehouse className="w-4 h-4 text-muted-foreground" /> : <Truck className="w-4 h-4 text-muted-foreground" />}
                    {asset.asset_name}
                  </TableCell>
                  <TableCell className="text-sm">{asset.asset_type?.replace(/_/g, ' ')}</TableCell>
                  <TableCell>
                    <Badge variant={isRented ? 'outline' : 'secondary'}>{isRented ? 'Third-Party Rented' : 'Internal Owned'}</Badge>
                    {isRented && <p className="text-xs text-muted-foreground mt-0.5">{vendorName(asset.rental_vendor_id)}</p>}
                  </TableCell>
                  <TableCell className="text-sm">{projectName(asset.project_location_id)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-sm">{(asset.runtime_hours || 0).toLocaleString()}</span>
                      {isDueForMaintenance(asset) && (
                        <Badge variant="destructive" className="gap-1 text-[10px]"><Wrench className="w-3 h-3" />PM Due</Badge>
                      )}
                      {canManageFleet && (
                        <Button size="icon" variant="ghost" className="h-6 w-6" title="Log Hours" onClick={() => { setLogHoursAsset(asset); setLogHoursValue(String(asset.runtime_hours || 0)); }}>
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
                      <Button size="sm" variant="outline" onClick={() => onTogglePickup(asset)}>Mark Ready for Pickup</Button>
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
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddForm(false)}>Cancel</Button>
            <Button onClick={handleAddAsset} disabled={saving} className="steel-gradient text-white border-0">{saving ? 'Saving…' : 'Add Equipment'}</Button>
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
    </div>
  );
}
