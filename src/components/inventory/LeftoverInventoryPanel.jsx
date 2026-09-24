import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Plus, Recycle, Trash2, Archive } from 'lucide-react';
import { buildZplPayload, LABEL_STOCK_SIZES } from '@/lib/zplLabels';
import PrintableLabelSheet from '@/components/barcode-printing/PrintableLabelSheet';
import AddLeftoverDialog from '@/components/inventory/AddLeftoverDialog';
import RemnantInventoryDetailModal from '@/components/inventory/RemnantInventoryDetailModal';
import RemoveRemnantDialog from '@/components/inventory/RemoveRemnantDialog';

// QR lifecycle, manual-drop side: lists remnant_inventory rows (both
// unassigned/available and already-assigned, for a visible history of where
// a leftover's QR ended up) and hosts "Add Leftover to Inventory". Printing
// reuses the exact same pipeline LabelPrintingPanel.jsx (ShopOperations.jsx)
// uses for pieces/manifests — PrintableLabelSheet + buildZplPayload +
// print_label_jobs — scoped here to remnant_inventory as the target record,
// using the Material_Stock label size that already existed for this purpose
// but had nothing wired to trigger it yet.
export default function LeftoverInventoryPanel({ shopFloorZones }) {
  const { toast } = useToast();
  const [remnants, setRemnants] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [viewingId, setViewingId] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [showRemoved, setShowRemoved] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [remnantRows, projectRows] = await Promise.all([
        db.entities.remnant_inventory.list('-created_date', 500),
        db.entities.Project.list('name', 500),
      ]);
      setRemnants(remnantRows || []);
      setProjects(projectRows || []);
    } catch (e) {
      toast({ title: 'Unable to load leftover inventory', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const projectsById = projects.reduce((map, p) => { map[p.id] = p; return map; }, {});
  const viewing = remnants.find((r) => r.id === viewingId) || null;

  const handleCreated = (created) => {
    setRemnants((prev) => [created, ...prev]);
    handlePrint(created);
  };

  const handleUpdated = (updated) => {
    setRemnants((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  };

  const handleRemove = async (reason) => {
    if (!removeTarget) return;
    try {
      const updated = await db.entities.remnant_inventory.update(removeTarget.id, {
        status: 'removed',
        removed_reason: reason,
        removed_date: new Date().toISOString(),
      });
      handleUpdated(updated);
      setRemoveTarget(null);
      toast({ title: 'Removed from inventory' });
    } catch (e) {
      toast({ title: 'Unable to remove item', variant: 'destructive' });
    }
  };

  const handlePrint = (remnant) => {
    setSheet({
      size: LABEL_STOCK_SIZES.Material_Stock,
      title: remnant.material_shape,
      subtitle: [remnant.material_grade, remnant.dimensions].filter(Boolean).join(' — '),
      qrPayload: remnant.qr_payload_string,
      targetRecordId: remnant.id,
    });
  };

  const handlePrinted = async () => {
    if (!sheet?.targetRecordId) return;
    const zpl_payload_string = buildZplPayload({ labelType: 'Material_Stock', title: sheet.title, subtitle: sheet.subtitle, qrPayload: sheet.qrPayload });
    await db.entities.print_label_jobs.create({
      label_type: 'Material_Stock',
      target_record_id: sheet.targetRecordId,
      zpl_payload_string,
      status: 'Printed',
      created_at: new Date().toISOString(),
    });
  };

  const visibleRemnants = remnants.filter((r) => (showRemoved ? r.status === 'removed' : r.status !== 'removed'));
  const available = visibleRemnants.filter((r) => !r.is_assigned);
  const assigned = visibleRemnants.filter((r) => r.is_assigned);

  return (
    <div className="steel-card">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm flex items-center gap-2"><Recycle className="w-4 h-4 text-primary" />Leftover Material</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Manually logged drops/leftovers with their own printable QR — searchable and matchable against a new project's Detailer Import.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={showRemoved ? 'secondary' : 'outline'}
            className="gap-1.5"
            onClick={() => setShowRemoved((v) => !v)}
          >
            <Archive className="w-4 h-4" />{showRemoved ? 'Showing Removed' : 'Show Removed'}
          </Button>
          <Button size="sm" className="gap-1.5 steel-gradient text-white border-0" onClick={() => setShowAdd(true)}>
            <Plus className="w-4 h-4" />Add Leftover to Inventory
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
              <th className="text-left py-3 px-4">Shape / Grade</th>
              <th className="text-left py-3 px-4">Dimensions</th>
              <th className="text-left py-3 px-4">Source Project</th>
              <th className="text-left py-3 px-4">QR</th>
              <th className="text-left py-3 px-4">Status</th>
              {!showRemoved && <th className="text-left py-3 px-4">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i}><td colSpan={6} className="py-3 px-4"><div className="h-6 bg-muted rounded animate-pulse" /></td></tr>
              ))
            ) : visibleRemnants.length === 0 ? (
              <tr><td colSpan={6} className="py-12 text-center text-muted-foreground">
                <Recycle className="w-8 h-8 mx-auto mb-2" />
                {showRemoved ? 'No removed leftover material.' : 'No leftover material logged yet'}
              </td></tr>
            ) : (
              [...available, ...assigned].map((r) => (
                <tr key={r.id} onClick={() => setViewingId(r.id)} className="border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer">
                  <td className="py-3 px-4">
                    <p className="font-medium">{r.material_shape}</p>
                    <p className="text-xs text-muted-foreground">{r.material_grade || '—'}</p>
                  </td>
                  <td className="py-3 px-4 text-muted-foreground">{r.dimensions || (r.length_in ? `${r.length_in}"` : '—')}</td>
                  <td className="py-3 px-4 text-muted-foreground">{projectsById[r.source_project_id]?.name || '—'}</td>
                  <td className="py-3 px-4 font-mono text-xs text-muted-foreground truncate max-w-[10rem]">{r.qr_payload_string || '—'}</td>
                  <td className="py-3 px-4">
                    {r.status === 'removed'
                      ? <span className="text-xs px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-500">Removed — {r.removed_reason || '—'}</span>
                      : r.is_assigned
                      ? <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600">Assigned — {projectsById[r.assigned_project_id]?.name || r.assigned_project_id}</span>
                      : <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-500">Available</span>
                    }
                  </td>
                  {!showRemoved && (
                    <td className="py-3 px-4">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        title="Remove from Inventory"
                        onClick={(e) => { e.stopPropagation(); setRemoveTarget(r); }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <AddLeftoverDialog
        open={showAdd}
        onOpenChange={setShowAdd}
        projects={projects}
        shopFloorZones={shopFloorZones}
        onCreated={handleCreated}
      />

      <RemnantInventoryDetailModal
        remnant={viewing}
        open={!!viewing}
        onOpenChange={(o) => !o && setViewingId(null)}
        shopFloorZones={shopFloorZones}
        projectsById={projectsById}
        onUpdated={handleUpdated}
        onPrint={handlePrint}
        onRemove={(remnant) => { setViewingId(null); setRemoveTarget(remnant); }}
      />

      <RemoveRemnantDialog
        remnant={removeTarget}
        open={!!removeTarget}
        onOpenChange={(o) => !o && setRemoveTarget(null)}
        onConfirm={handleRemove}
      />

      <PrintableLabelSheet
        open={!!sheet}
        onClose={() => setSheet(null)}
        onPrinted={handlePrinted}
        size={sheet?.size || LABEL_STOCK_SIZES.Material_Stock}
        title={sheet?.title}
        subtitle={sheet?.subtitle}
        qrPayload={sheet?.qrPayload}
      />
    </div>
  );
}
