import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { getDocumentRecords } from '@/lib/inspectionDocumentStore';
import { logStatusChange } from '@/lib/statusHistory';
import { RIGGING_TYPES, riggingTypeLabel } from '@/lib/riggingAssetTypes';
import { AlertTriangle, Plus, Link2, History, ShieldAlert, ShieldCheck, Paperclip } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import InspectionDocumentUpload from '@/components/shared/InspectionDocumentUpload';
import StatusHistoryModal from '@/components/shared/StatusHistoryModal';
import { useToast } from '@/components/ui/use-toast';

const emptyAssetForm = () => ({
  rigging_id: '', rigging_type: RIGGING_TYPES[0].value, description: '', manufacturer: '',
  wll_rated_capacity: '', length_or_size: '', in_service_date: new Date().toISOString().slice(0, 10), proof_test_date: '',
});

const DAY_MS = 24 * 60 * 60 * 1000;
const daysSince = (dateStr) => (dateStr ? Math.floor((Date.now() - new Date(dateStr).getTime()) / DAY_MS) : null);

const sortInspectionsDesc = (rows) => [...rows].sort((a, b) => new Date(b.inspection_date) - new Date(a.inspection_date));

// A finding that's checked (flagged) in 2+ of an asset's own inspections is
// a deterioration trend worth surfacing, not just a one-off note — pure,
// deterministic aggregation, no AI involved (this app's detection default).
function deteriorationTrends(assetInspections) {
  const occurrences = new Map();
  assetInspections.forEach((insp) => {
    [...(insp.sling_findings || []), ...(insp.hardware_findings || [])]
      .filter((f) => f.checked)
      .forEach((f) => {
        if (!occurrences.has(f.item)) occurrences.set(f.item, []);
        occurrences.get(f.item).push(insp.inspection_date);
      });
  });
  return Array.from(occurrences.entries())
    .filter(([, dates]) => dates.length >= 2)
    .map(([item, dates]) => ({ item, dates: dates.sort() }));
}

function StatusBadge({ status }) {
  if (status === 'removed_from_service') return <Badge variant="destructive" className="gap-1 text-[10px]"><ShieldAlert className="w-3 h-3" />Removed From Service</Badge>;
  if (status === 'repair') return <Badge className="gap-1 text-[10px] bg-amber-500/15 text-amber-600 border-amber-500/30"><AlertTriangle className="w-3 h-3" />In Repair</Badge>;
  return <Badge variant="secondary" className="gap-1 text-[10px]"><ShieldCheck className="w-3 h-3" />In Service</Badge>;
}

export default function RiggingMatrix({ ledger, inspections = [], canManageFleet, onReload, currentUser }) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState(emptyAssetForm());
  const [saving, setSaving] = useState(false);
  const [viewingAssetId, setViewingAssetId] = useState(null);
  const [viewingInspection, setViewingInspection] = useState(null);
  const [inspectionDocs, setInspectionDocs] = useState([]);
  const [showStatusHistory, setShowStatusHistory] = useState(false);
  const [removingAsset, setRemovingAsset] = useState(null);
  const [removeReason, setRemoveReason] = useState('');
  const [statusActionBusy, setStatusActionBusy] = useState(false);

  const viewingAsset = ledger.find((a) => a.id === viewingAssetId) || null;

  const inspectionsByAsset = useMemo(() => {
    const map = new Map();
    inspections.forEach((insp) => {
      if (!insp.rigging_asset_id) return;
      if (!map.has(insp.rigging_asset_id)) map.set(insp.rigging_asset_id, []);
      map.get(insp.rigging_asset_id).push(insp);
    });
    return map;
  }, [inspections]);

  const lastInspectionFor = (assetId) => {
    const rows = inspectionsByAsset.get(assetId);
    return rows && rows.length > 0 ? sortInspectionsDesc(rows)[0] : null;
  };

  const changedByName = () => currentUser?.full_name || currentUser?.email || 'Unknown';

  const handleSaveNewAsset = async () => {
    const riggingId = form.rigging_id.trim();
    if (!riggingId) {
      toast({ title: 'Rigging ID is required', variant: 'destructive' });
      return;
    }
    if (ledger.some((a) => a.rigging_id?.toLowerCase() === riggingId.toLowerCase())) {
      toast({ title: 'Rigging ID already in use', description: 'Rigging IDs must be unique.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await db.entities.rigging_inventory_ledger.create({
        rigging_id: riggingId,
        rigging_type: form.rigging_type,
        description: form.description.trim(),
        manufacturer: form.manufacturer.trim(),
        wll_rated_capacity: form.wll_rated_capacity.trim(),
        length_or_size: form.length_or_size.trim(),
        in_service_date: form.in_service_date,
        proof_test_date: form.proof_test_date,
        status: 'in_service',
        created_at: new Date().toISOString(),
      });
      await onReload();
      setShowAddForm(false);
      setForm(emptyAssetForm());
      toast({ title: 'Rigging asset added' });
    } finally {
      setSaving(false);
    }
  };

  const openRemoveDialog = (asset) => { setRemovingAsset(asset); setRemoveReason(''); };

  const confirmRemove = async () => {
    if (!removingAsset || removeReason.trim().length < 5) return;
    setStatusActionBusy(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await db.entities.rigging_inventory_ledger.update(removingAsset.id, {
        status: 'removed_from_service', removed_date: today, removed_reason: removeReason.trim(),
      });
      await logStatusChange({
        entityType: 'rigging_inventory_ledger', entityId: removingAsset.id, fieldName: 'status',
        fromValue: removingAsset.status || 'in_service', toValue: 'removed_from_service',
        changedBy: changedByName(), note: removeReason.trim(),
      });
      await onReload();
      setRemovingAsset(null);
      setRemoveReason('');
      toast({ title: `${removingAsset.rigging_id} removed from service` });
    } finally {
      setStatusActionBusy(false);
    }
  };

  const handleReturnToService = async (asset) => {
    setStatusActionBusy(true);
    try {
      await db.entities.rigging_inventory_ledger.update(asset.id, { status: 'in_service', removed_date: '', removed_reason: '' });
      await logStatusChange({
        entityType: 'rigging_inventory_ledger', entityId: asset.id, fieldName: 'status',
        fromValue: 'removed_from_service', toValue: 'in_service',
        changedBy: changedByName(), note: 'Returned to service.',
      });
      await onReload();
      toast({ title: `${asset.rigging_id} returned to service` });
    } finally {
      setStatusActionBusy(false);
    }
  };

  const openInspection = async (insp) => {
    setViewingInspection(insp);
    setInspectionDocs(await getDocumentRecords(`inspection_documents_${insp.id}`).catch(() => []));
  };

  const viewingAssetInspections = viewingAsset ? sortInspectionsDesc(inspectionsByAsset.get(viewingAsset.id) || []) : [];
  const viewingAssetTrends = viewingAsset ? deteriorationTrends(viewingAssetInspections) : [];

  const findingsFor = (insp) => (insp?.sling_findings?.length ? insp.sling_findings : insp?.hardware_findings || []);

  return (
    <div className="space-y-3">
      {canManageFleet && (
        <div className="flex justify-end">
          <Button size="sm" className="gap-2 steel-gradient text-white border-0" onClick={() => setShowAddForm(true)}>
            <Plus className="w-3.5 h-3.5" />Add Rigging Asset
          </Button>
        </div>
      )}

      <div className="steel-card p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rigging ID</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>WLL</TableHead>
              <TableHead>Last Inspection</TableHead>
              <TableHead>Days Since</TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ledger.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No rigging assets on file.</TableCell></TableRow>
            )}
            {ledger.map((asset) => {
              const last = lastInspectionFor(asset.id);
              const days = last ? daysSince(last.inspection_date) : null;
              const flagNoInspection = asset.status === 'in_service' && !last;
              return (
                <TableRow key={asset.id} onClick={() => setViewingAssetId(asset.id)} className="cursor-pointer">
                  <TableCell className="font-medium flex items-center gap-2">
                    <Link2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    {asset.rigging_id}
                  </TableCell>
                  <TableCell className="text-sm">{riggingTypeLabel(asset.rigging_type)}</TableCell>
                  <TableCell className="text-sm font-mono">{asset.wll_rated_capacity || '—'}</TableCell>
                  <TableCell className="text-sm">
                    {last ? `${last.inspection_date} (${last.disposal_action?.replace(/_/g, ' ')})` : '—'}
                  </TableCell>
                  <TableCell className="text-sm font-mono">{days !== null ? days : '—'}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-col items-end gap-1.5">
                      <StatusBadge status={asset.status} />
                      {flagNoInspection && (
                        <Badge variant="destructive" className="gap-1 text-[10px]"><AlertTriangle className="w-3 h-3" />No Pre-Use Inspection Logged</Badge>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Add Asset */}
      <Dialog open={showAddForm} onOpenChange={setShowAddForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Rigging Asset</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Rigging ID</Label>
                <Input value={form.rigging_id} onChange={(e) => setForm((f) => ({ ...f, rigging_id: e.target.value }))} className="mt-1" placeholder="SB-1002" />
              </div>
              <div>
                <Label>Rigging Type</Label>
                <Select value={form.rigging_type} onValueChange={(v) => setForm((f) => ({ ...f, rigging_type: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{RIGGING_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="mt-1" placeholder="e.g. 2in x 20ft nylon web sling" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Manufacturer</Label>
                <Input value={form.manufacturer} onChange={(e) => setForm((f) => ({ ...f, manufacturer: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label>WLL Rated Capacity</Label>
                <Input value={form.wll_rated_capacity} onChange={(e) => setForm((f) => ({ ...f, wll_rated_capacity: e.target.value }))} className="mt-1" placeholder="e.g. 20 tons" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Length / Size</Label>
                <Input value={form.length_or_size} onChange={(e) => setForm((f) => ({ ...f, length_or_size: e.target.value }))} className="mt-1" placeholder="e.g. 3/4in x 72in" />
              </div>
              <div>
                <Label>In-Service Date</Label>
                <Input type="date" value={form.in_service_date} onChange={(e) => setForm((f) => ({ ...f, in_service_date: e.target.value }))} className="mt-1" />
              </div>
            </div>
            {form.rigging_type === 'below_the_hook' && (
              <div>
                <Label>Proof Test Date</Label>
                <Input type="date" value={form.proof_test_date} onChange={(e) => setForm((f) => ({ ...f, proof_test_date: e.target.value }))} className="mt-1" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddForm(false)}>Cancel</Button>
            <Button onClick={handleSaveNewAsset} disabled={saving} className="steel-gradient text-white border-0">{saving ? 'Saving…' : 'Add Asset'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Asset Detail + History */}
      <Dialog open={!!viewingAsset} onOpenChange={(o) => !o && setViewingAssetId(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {viewingAsset && (
            <>
              <DialogHeader className="flex-row items-center justify-between gap-3 pr-8 space-y-0">
                <DialogTitle>{viewingAsset.rigging_id}</DialogTitle>
                <button onClick={() => setShowStatusHistory(true)} className="text-xs text-primary hover:underline flex items-center gap-1">
                  <History className="w-3.5 h-3.5" />Status History
                </button>
              </DialogHeader>

              <div className="space-y-2 text-sm">
                {[
                  ['Type', riggingTypeLabel(viewingAsset.rigging_type)],
                  ['Description', viewingAsset.description || '—'],
                  ['Manufacturer', viewingAsset.manufacturer || '—'],
                  ['WLL Rated Capacity', viewingAsset.wll_rated_capacity || '—'],
                  ['Length / Size', viewingAsset.length_or_size || '—'],
                  ['In-Service Date', viewingAsset.in_service_date || '—'],
                  ...(viewingAsset.rigging_type === 'below_the_hook' ? [['Proof Test Date', viewingAsset.proof_test_date || '—']] : []),
                ].map(([label, value]) => (
                  <div key={label} className="grid grid-cols-3 gap-2 border-b border-border/50 pb-2">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="col-span-2 font-medium">{value}</span>
                  </div>
                ))}
                <div className="grid grid-cols-3 gap-2 border-b border-border/50 pb-2 items-center">
                  <span className="text-muted-foreground">Status</span>
                  <span className="col-span-2"><StatusBadge status={viewingAsset.status} /></span>
                </div>
                {viewingAsset.status === 'removed_from_service' && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs space-y-1">
                    <p className="font-semibold text-destructive">Removed From Service — {viewingAsset.removed_date || '—'}</p>
                    <p className="text-muted-foreground">{viewingAsset.removed_reason || '—'}</p>
                  </div>
                )}
              </div>

              {canManageFleet && (
                <div className="flex justify-end">
                  {viewingAsset.status === 'removed_from_service' ? (
                    <Button size="sm" variant="outline" disabled={statusActionBusy} onClick={() => handleReturnToService(viewingAsset)}>Return to Service</Button>
                  ) : (
                    <Button size="sm" variant="outline" className="text-destructive border-destructive/30" disabled={statusActionBusy} onClick={() => openRemoveDialog(viewingAsset)}>
                      Mark Removed From Service
                    </Button>
                  )}
                </div>
              )}

              {viewingAssetTrends.length > 0 && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs space-y-1.5">
                  <p className="font-semibold text-amber-700 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" />Deterioration Trend</p>
                  {viewingAssetTrends.map((t) => (
                    <p key={t.item} className="text-muted-foreground">
                      <span className="font-medium text-foreground">"{t.item}"</span> flagged in {t.dates.length} inspections — {t.dates.join(', ')}
                    </p>
                  ))}
                </div>
              )}

              <div>
                <h4 className="font-semibold text-sm mb-2 flex items-center gap-2"><History className="w-4 h-4 text-primary" />Inspection History</h4>
                {viewingAssetInspections.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No inspections logged for this asset yet.</p>
                ) : (
                  <div className="space-y-2">
                    {viewingAssetInspections.map((insp) => (
                      <div key={insp.id} onClick={() => openInspection(insp)} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2.5 text-sm cursor-pointer hover:bg-muted/50 transition-colors">
                        <div>
                          <p className="font-medium">{insp.inspection_date} — {insp.inspection_type?.replace(/_/g, ' ')}</p>
                          <p className="text-xs text-muted-foreground">{insp.inspector_name}</p>
                        </div>
                        <Badge variant={insp.disposal_action === 'Removed_From_Service' ? 'destructive' : insp.disposal_action === 'Requires_Repair' ? 'outline' : 'secondary'} className="text-[10px] flex-shrink-0">
                          {insp.disposal_action?.replace(/_/g, ' ')}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setViewingAssetId(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <StatusHistoryModal
        open={showStatusHistory}
        onOpenChange={setShowStatusHistory}
        entityType="rigging_inventory_ledger"
        entityId={viewingAsset?.id}
        fieldName="status"
        title={`Status History — ${viewingAsset?.rigging_id || ''}`}
      />

      {/* Inspection Detail */}
      <Dialog open={!!viewingInspection} onOpenChange={(o) => !o && setViewingInspection(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {viewingInspection && (
            <>
              <DialogHeader>
                <DialogTitle>{viewingInspection.inspection_date} Inspection — {viewingInspection.equipment_id}</DialogTitle>
              </DialogHeader>
              <div className="space-y-2 text-sm">
                <div className="grid grid-cols-3 gap-2 border-b border-border/50 pb-2">
                  <span className="text-muted-foreground">Inspector</span>
                  <span className="col-span-2 font-medium">
                    {viewingInspection.inspector_employee_id ? (
                      <button className="text-primary hover:underline" onClick={() => navigate(`/human-resources?employee=${viewingInspection.inspector_employee_id}`)}>
                        {viewingInspection.inspector_name}
                      </button>
                    ) : viewingInspection.inspector_name}
                  </span>
                </div>
                {[
                  ['Inspection Type', viewingInspection.inspection_type?.replace(/_/g, ' ')],
                  ['Tags Legible', viewingInspection.tag_legible ? 'Yes' : 'No'],
                  ['WLL Readable', viewingInspection.wll_readable ? 'Yes' : 'No'],
                ].map(([label, value]) => (
                  <div key={label} className="grid grid-cols-3 gap-2 border-b border-border/50 pb-2">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="col-span-2 font-medium">{value}</span>
                  </div>
                ))}
              </div>

              <div>
                <h4 className="font-semibold text-sm mb-2">Checklist Findings</h4>
                <div className="space-y-1.5">
                  {findingsFor(viewingInspection).map((f, i) => (
                    <div key={`${f.item}-${i}`} className={`flex items-start justify-between gap-2 rounded-lg border p-2 text-xs ${f.checked ? 'border-amber-500/40 bg-amber-500/5' : 'border-border'}`}>
                      <span className={f.checked ? 'font-medium text-amber-700' : ''}>{f.item}{f.checked ? ' — flagged' : ''}</span>
                      {f.notes && <span className="text-muted-foreground text-right flex-shrink-0 max-w-[60%]">{f.notes}</span>}
                    </div>
                  ))}
                </div>
              </div>

              {viewingInspection.deficiencies && (
                <div>
                  <h4 className="font-semibold text-sm mb-1">Deficiencies</h4>
                  <p className="text-sm text-muted-foreground">{viewingInspection.deficiencies}</p>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2 border-b border-border/50 pb-2">
                <span className="text-muted-foreground text-sm">Disposal Action</span>
                <span className="col-span-2 font-medium text-sm">{viewingInspection.disposal_action?.replace(/_/g, ' ')}</span>
              </div>
              {viewingInspection.disposal_notes && (
                <p className="text-sm text-muted-foreground">{viewingInspection.disposal_notes}</p>
              )}

              <div>
                <h4 className="font-semibold text-sm mb-2 flex items-center gap-2"><Paperclip className="w-4 h-4 text-primary" />Documents</h4>
                <InspectionDocumentUpload pendingFiles={[]} onPendingFilesChange={() => {}} savedDocuments={inspectionDocs} disabled />
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setViewingInspection(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Mark Removed From Service */}
      <Dialog open={!!removingAsset} onOpenChange={(o) => { if (!o) { setRemovingAsset(null); setRemoveReason(''); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Mark Removed From Service — {removingAsset?.rigging_id}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">This permanently flags the asset as removed from service and blocks it from being selected on future inspections. It stays visible in the registry with full history.</p>
          <div>
            <Label>Reason (min 5 characters)</Label>
            <Textarea rows={3} value={removeReason} onChange={(e) => setRemoveReason(e.target.value)} className="mt-1" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRemovingAsset(null); setRemoveReason(''); }}>Cancel</Button>
            <Button variant="destructive" disabled={removeReason.trim().length < 5 || statusActionBusy} onClick={confirmRemove}>
              {statusActionBusy ? 'Saving…' : 'Confirm Removal'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
