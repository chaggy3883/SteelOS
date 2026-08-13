import React, { useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Plus, GripVertical, AlertTriangle, Trash2, PackageCheck, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';

const emptyLoadForm = () => ({ project_id: '', carrier_vendor_id: '', max_weight_capacity_lbs: 45000 });

const nextLoadNumber = (loads) => {
  const max = loads.reduce((m, l) => {
    const match = /^LOAD-(\d{3})$/.exec(l.load_number_id || '');
    return match ? Math.max(m, parseInt(match[1], 10)) : m;
  }, 0);
  return `LOAD-${String(max + 1).padStart(3, '0')}`;
};

export default function LoadBuilder({ pieces, loads, loadItems, carriers, projects, pieceMarks = [], onReload, onViewLoad, onViewPiece }) {
  const { toast } = useToast();
  const [selectedLoadId, setSelectedLoadId] = useState(loads[0]?.id || null);
  const [showNewLoadForm, setShowNewLoadForm] = useState(false);
  const [newLoadForm, setNewLoadForm] = useState(emptyLoadForm());
  const [creatingLoad, setCreatingLoad] = useState(false);
  const [sequenceWarning, setSequenceWarning] = useState('');

  const selectedLoad = useMemo(() => loads.find((l) => l.id === selectedLoadId) || null, [loads, selectedLoadId]);
  const selectedLoadItems = useMemo(
    () => loadItems.filter((li) => li.load_id === selectedLoadId).sort((a, b) => (a.sequence_number || 0) - (b.sequence_number || 0)),
    [loadItems, selectedLoadId]
  );
  const loadPieces = useMemo(
    () => selectedLoadItems.map((li) => ({ ...li, piece: pieces.find((p) => p.id === li.piece_id) })),
    [selectedLoadItems, pieces]
  );
  const assignedPieceIds = useMemo(() => new Set(loadItems.map((li) => li.piece_id)), [loadItems]);
  // Hard filter: only pieces that have cleared every Module 8 QA gate, and
  // aren't already staged on some other load, ever appear in this queue.
  const availablePieces = useMemo(
    () => pieces.filter((p) => p.workflow_status === 'Paint_Unlocked' && !assignedPieceIds.has(p.id)),
    [pieces, assignedPieceIds]
  );

  // Phase lookup — piece_mark_id is the primary bridge back to a PieceMark;
  // shop pieces created before that bridge was populated fall back to a
  // (project_id, piece_mark) string match, same fallback ProjectDetail.jsx's
  // Phasing tab uses for the % Shipped bridge.
  const phaseByPieceMarkId = useMemo(() => new Map(pieceMarks.map((pm) => [pm.id, (pm.phase || '').trim() || 'Unassigned'])), [pieceMarks]);
  const phaseByProjectAndMark = useMemo(() => new Map(pieceMarks.map((pm) => [`${pm.project_id}::${pm.piece_mark}`, (pm.phase || '').trim() || 'Unassigned'])), [pieceMarks]);
  const phaseForPiece = (p) => phaseByPieceMarkId.get(p.piece_mark_id) ?? phaseByProjectAndMark.get(`${p.project_id}::${p.piece_mark}`) ?? 'Unassigned';

  // Sorted once by phase (then piece mark) so the flattened Draggable index
  // below stays stable while phase group headers are inserted between runs
  // of the same phase — a single Droppable needs one continuous index
  // sequence, so pieces can't be split into separate per-phase Droppables.
  const availablePiecesByPhase = useMemo(() => {
    return [...availablePieces].sort((a, b) => {
      const phaseA = phaseForPiece(a);
      const phaseB = phaseForPiece(b);
      if (phaseA !== phaseB) {
        if (phaseA === 'Unassigned') return 1;
        if (phaseB === 'Unassigned') return -1;
        return phaseA.localeCompare(phaseB, undefined, { numeric: true });
      }
      return (a.piece_mark || '').localeCompare(b.piece_mark || '', undefined, { numeric: true });
    });
  }, [availablePieces, phaseByPieceMarkId, phaseByProjectAndMark]);

  const currentLoadWeight = loadPieces.reduce((sum, lp) => sum + (lp.piece?.weight || 0), 0);
  const capacity = selectedLoad?.max_weight_capacity_lbs || 45000;
  const isOverweight = !!selectedLoad && currentLoadWeight > capacity;

  const handleCreateLoad = async () => {
    if (!newLoadForm.project_id) {
      toast({ title: 'Project is required', variant: 'destructive' });
      return;
    }
    setCreatingLoad(true);
    try {
      const created = await db.entities.loads.create({
        project_id: newLoadForm.project_id,
        load_number_id: nextLoadNumber(loads),
        status: 'Draft',
        total_weight_lbs: 0,
        carrier_vendor_id: newLoadForm.carrier_vendor_id || null,
        max_weight_capacity_lbs: Number(newLoadForm.max_weight_capacity_lbs) || 45000,
        is_overweight_permit_authorized: false,
      });
      await onReload();
      setSelectedLoadId(created.id);
      setShowNewLoadForm(false);
      setNewLoadForm(emptyLoadForm());
      toast({ title: `${created.load_number_id} created` });
    } catch (e) {
      toast({ title: 'Unable to create load', variant: 'destructive' });
    } finally {
      setCreatingLoad(false);
    }
  };

  const handleDragEnd = async (result) => {
    const { source, destination, draggableId } = result;
    if (!destination || destination.droppableId !== 'load-items' || !selectedLoad) return;
    if (source.droppableId === 'load-items') return;

    const piece = pieces.find((p) => p.id === draggableId);
    if (!piece || piece.workflow_status !== 'Paint_Unlocked') return;

    const nextSeq = selectedLoadItems.reduce((max, li) => Math.max(max, li.sequence_number || 0), 0) + 1;
    try {
      await db.entities.load_items.create({
        load_id: selectedLoad.id,
        piece_id: piece.id,
        sequence_number: nextSeq,
        status: 'Staged',
      });
      await db.entities.loads.update(selectedLoad.id, {
        total_weight_lbs: currentLoadWeight + (piece.weight || 0),
        status: selectedLoad.status === 'Draft' ? 'Staged' : selectedLoad.status,
      });
      await onReload();
      toast({ title: `${piece.piece_mark} staged on ${selectedLoad.load_number_id}` });
    } catch (e) {
      toast({ title: 'Unable to stage piece', variant: 'destructive' });
    }
  };

  const removeFromLoad = async (item) => {
    if (item.status !== 'Staged') {
      toast({ title: 'Already scanned onto the trailer — remove it from Yard Scanning instead', variant: 'destructive' });
      return;
    }
    try {
      await db.entities.load_items.delete(item.id);
      await db.entities.loads.update(selectedLoad.id, {
        total_weight_lbs: Math.max(0, currentLoadWeight - (item.piece?.weight || 0)),
      });
      await onReload();
    } catch (e) {
      toast({ title: 'Unable to remove piece', variant: 'destructive' });
    }
  };

  const updateSequence = async (item, rawValue) => {
    const newSeq = parseInt(rawValue, 10);
    if (!Number.isFinite(newSeq)) return;
    const conflicts = selectedLoadItems.some((li) => li.id !== item.id && li.sequence_number === newSeq);
    if (conflicts) {
      setSequenceWarning(`Sequence #${newSeq} is out of order — it conflicts with another item already on ${selectedLoad.load_number_id}.`);
      setTimeout(() => setSequenceWarning(''), 6000);
    }
    await db.entities.load_items.update(item.id, { sequence_number: newSeq });
    await onReload();
  };

  const toggleOverweightAuth = async (checked) => {
    await db.entities.loads.update(selectedLoad.id, { is_overweight_permit_authorized: checked });
    await onReload();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {loads.map((load) => (
          <div
            key={load.id}
            className={cn(
              'rounded-lg border px-3 py-2 text-sm transition-colors flex items-center gap-2',
              load.id === selectedLoadId ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted/50'
            )}
          >
            <button onClick={() => setSelectedLoadId(load.id)} className="text-left">
              <p className="font-semibold">{load.load_number_id}</p>
              <p className="text-xs text-muted-foreground">{load.status} • {loadItems.filter((li) => li.load_id === load.id).length} pcs</p>
            </button>
            <button
              type="button"
              title="View load details"
              onClick={(e) => { e.stopPropagation(); onViewLoad?.(load.id); }}
              className="text-muted-foreground hover:text-primary flex-shrink-0"
            >
              <Info className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowNewLoadForm(true)}>
          <Plus className="w-4 h-4" />New Load
        </Button>
      </div>

      {selectedLoad ? (
        <>
          {isOverweight && (
            <div className="steel-card p-4 border-red-500/40 bg-red-500/5 space-y-3">
              <div className="flex items-center gap-2 text-red-600 font-semibold">
                <AlertTriangle className="w-5 h-5" />
                Overweight: {currentLoadWeight.toLocaleString()} lbs exceeds the {capacity.toLocaleString()} lb legal capacity for {selectedLoad.load_number_id}.
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!selectedLoad.is_overweight_permit_authorized}
                  onChange={(e) => toggleOverweightAuth(e.target.checked)}
                  className="w-4 h-4"
                />
                Overweight permit obtained — authorize this load to proceed anyway
              </label>
              {!selectedLoad.is_overweight_permit_authorized && (
                <p className="text-xs text-red-600">This load cannot advance to Yard Scanning until authorized.</p>
              )}
            </div>
          )}

          {sequenceWarning && (
            <div className="steel-card p-3 border-yellow-500/40 bg-yellow-500/5 flex items-center gap-2 text-sm text-yellow-700">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />{sequenceWarning}
            </div>
          )}

          <DragDropContext onDragEnd={handleDragEnd}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Droppable droppableId="available-pieces">
                {(provided) => (
                  <div ref={provided.innerRef} {...provided.droppableProps} className="steel-card p-3">
                    <h4 className="font-semibold text-sm mb-2 flex items-center justify-between">
                      Paint-Unlocked Pieces <span className="text-xs text-muted-foreground font-normal">{availablePieces.length}</span>
                    </h4>
                    <div className="space-y-2 min-h-[120px]">
                      {availablePiecesByPhase.map((p, i) => {
                        const phase = phaseForPiece(p);
                        const showPhaseHeader = i === 0 || phaseForPiece(availablePiecesByPhase[i - 1]) !== phase;
                        return (
                          <React.Fragment key={p.id}>
                            {showPhaseHeader && (
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground pt-1 first:pt-0">{phase}</p>
                            )}
                            <Draggable draggableId={p.id} index={i}>
                              {(dragProvided) => (
                                <div
                                  ref={dragProvided.innerRef}
                                  {...dragProvided.draggableProps}
                                  {...dragProvided.dragHandleProps}
                                  className="steel-card p-2 text-xs flex items-center gap-2 cursor-grab active:cursor-grabbing"
                                >
                                  <GripVertical className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                                  <div className="min-w-0 flex-1">
                                    <p className="font-mono font-bold truncate">{p.piece_mark}</p>
                                    <p className="text-muted-foreground truncate">{p.weight ? `${p.weight.toLocaleString()} lbs` : ''}</p>
                                  </div>
                                  <button
                                    type="button"
                                    title="View piece details"
                                    onClick={(e) => { e.stopPropagation(); onViewPiece?.({ pieceId: p.id }); }}
                                    className="text-muted-foreground hover:text-primary flex-shrink-0"
                                  >
                                    <Info className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              )}
                            </Draggable>
                          </React.Fragment>
                        );
                      })}
                      {provided.placeholder}
                      {availablePieces.length === 0 && (
                        <p className="text-xs text-muted-foreground text-center py-6">No Paint-Unlocked pieces waiting.</p>
                      )}
                    </div>
                  </div>
                )}
              </Droppable>

              <Droppable droppableId="load-items">
                {(provided) => (
                  <div ref={provided.innerRef} {...provided.droppableProps} className="steel-card p-3">
                    <div className="flex items-center justify-between mb-2">
                      <button className="font-semibold text-sm hover:underline" onClick={() => onViewLoad?.(selectedLoad.id)}>{selectedLoad.load_number_id}</button>
                      <button
                        onClick={() => onViewLoad?.(selectedLoad.id)}
                        className={cn('text-xs font-mono hover:underline', isOverweight ? 'text-red-600 font-bold' : 'text-muted-foreground')}
                      >
                        {currentLoadWeight.toLocaleString()} / {capacity.toLocaleString()} lbs
                      </button>
                    </div>
                    <div className="space-y-2 min-h-[120px]">
                      {loadPieces.map((lp, i) => (
                        <Draggable key={lp.id} draggableId={lp.piece_id} index={i} isDragDisabled>
                          {(dragProvided) => (
                            <div ref={dragProvided.innerRef} {...dragProvided.draggableProps} className="steel-card p-2 text-xs flex items-center gap-2">
                              <Input
                                type="number"
                                defaultValue={lp.sequence_number}
                                onBlur={(e) => updateSequence(lp, e.target.value)}
                                className="h-7 w-14 text-xs flex-shrink-0"
                              />
                              <div className="min-w-0 flex-1">
                                <button
                                  className="font-mono font-bold truncate hover:underline text-left block w-full"
                                  onClick={() => onViewPiece?.({ pieceId: lp.piece_id })}
                                >
                                  {lp.piece?.piece_mark}
                                </button>
                                <p className="text-muted-foreground truncate">{lp.piece?.weight ? `${lp.piece.weight.toLocaleString()} lbs` : ''} • {lp.status}</p>
                              </div>
                              {lp.status === 'Staged' && (
                                <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0" onClick={() => removeFromLoad(lp)}>
                                  <Trash2 className="w-3.5 h-3.5 text-red-500" />
                                </Button>
                              )}
                              {lp.status === 'Loaded' && <PackageCheck className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />}
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                      {loadPieces.length === 0 && (
                        <p className="text-xs text-muted-foreground text-center py-6">Drag a piece here to stage it on this load.</p>
                      )}
                    </div>
                  </div>
                )}
              </Droppable>
            </div>
          </DragDropContext>
        </>
      ) : (
        <p className="text-sm text-muted-foreground p-6 text-center">Create a load to begin staging Paint-Unlocked pieces.</p>
      )}

      <Dialog open={showNewLoadForm} onOpenChange={setShowNewLoadForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Load</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Project</Label>
              <Select value={newLoadForm.project_id} onValueChange={(v) => setNewLoadForm((f) => ({ ...f, project_id: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select a project" /></SelectTrigger>
                <SelectContent>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.project_number} — {p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Carrier</Label>
              <Select value={newLoadForm.carrier_vendor_id} onValueChange={(v) => setNewLoadForm((f) => ({ ...f, carrier_vendor_id: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select a carrier" /></SelectTrigger>
                <SelectContent>
                  {carriers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Max Legal Weight Capacity (lbs)</Label>
              <Input type="number" value={newLoadForm.max_weight_capacity_lbs} onChange={(e) => setNewLoadForm((f) => ({ ...f, max_weight_capacity_lbs: e.target.value }))} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewLoadForm(false)}>Cancel</Button>
            <Button onClick={handleCreateLoad} disabled={creatingLoad} className="steel-gradient text-white border-0">
              {creatingLoad ? 'Creating…' : 'Create Load'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
