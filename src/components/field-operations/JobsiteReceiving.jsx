import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { ChevronDown, PackageCheck, Undo2, QrCode, Ban, Truck, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

const ITEM_TYPES = ['Piece_Mark', 'Loose_Part', 'Bolt', 'Embed', 'Misc_Metal'];

// Per-piece jobsite check-in, additive to (never a replacement for) the
// master-manifest scan in YardScanning.jsx. That flow flips every piece on
// a load to On_Site at once when the master QR is scanned; this one flips
// pieces individually via the office PieceMark <-> shop-floor pieces bridge
// (pieces.piece_mark_id), so an erector can check items in one at a time as
// they're actually found on site, regardless of load status.
export default function JobsiteReceiving() {
  const { toast } = useToast();
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [loads, setLoads] = useState([]);
  const [loadItems, setLoadItems] = useState([]);
  const [manifests, setManifests] = useState([]);
  const [pieces, setPieces] = useState([]);
  const [pieceMarks, setPieceMarks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [openPhases, setOpenPhases] = useState({});
  const [scanValues, setScanValues] = useState({});
  const [viewingPieceMark, setViewingPieceMark] = useState(null);
  const [viewingLoad, setViewingLoad] = useState(null);

  useEffect(() => {
    db.entities.Project.filter({ is_archived: false }, 'name', 200).then(setProjects).catch(() => setProjects([]));
  }, []);

  const loadAll = useCallback(async (projectId) => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [loadData, allLoadItems, allManifests, pieceData, pieceMarkData] = await Promise.all([
        db.entities.loads.filter({ project_id: projectId }, '-created_date', 200),
        db.entities.load_items.list('-created_date', 1000),
        db.entities.shipping_manifests.list('-created_date', 500),
        db.entities.pieces.filter({ project_id: projectId }, '-created_date', 1000),
        db.entities.PieceMark.filter({ project_id: projectId }, 'piece_mark', 1000),
      ]);
      const loadIds = new Set(loadData.map((l) => l.id));
      setLoads(loadData);
      setLoadItems(allLoadItems.filter((li) => loadIds.has(li.load_id)));
      setManifests(allManifests.filter((m) => loadIds.has(m.load_id)));
      setPieces(pieceData);
      setPieceMarks(pieceMarkData);
    } catch (e) {
      // no-op — sections render their own empty states
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setOpenPhases({});
    setScanValues({});
    if (selectedProjectId) {
      loadAll(selectedProjectId);
    } else {
      setLoads([]); setLoadItems([]); setManifests([]); setPieces([]); setPieceMarks([]);
    }
  }, [selectedProjectId, loadAll]);

  const pieceByPieceMarkId = useMemo(() => {
    const map = new Map();
    pieces.forEach((p) => { if (p.piece_mark_id) map.set(p.piece_mark_id, p); });
    return map;
  }, [pieces]);

  const phaseGroups = useMemo(() => {
    const map = new Map();
    pieceMarks.forEach((pm) => {
      const phase = pm.phase?.trim() || 'Unassigned';
      if (!map.has(phase)) map.set(phase, []);
      map.get(phase).push(pm);
    });
    return Array.from(map.entries()).map(([phase, rows]) => {
      const received = rows.filter((pm) => pieceByPieceMarkId.get(pm.id)?.field_status === 'On_Site').length;
      const byType = rows.reduce((acc, pm) => {
        const type = pm.item_type || 'Piece_Mark';
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {});
      return { phase, rows, expected: rows.length, received, pct: rows.length > 0 ? Math.round((received / rows.length) * 100) : 0, byType };
    }).sort((a, b) => a.phase.localeCompare(b.phase));
  }, [pieceMarks, pieceByPieceMarkId]);

  useEffect(() => {
    setOpenPhases((prev) => {
      let changed = false;
      const next = { ...prev };
      phaseGroups.forEach((g) => {
        if (!(g.phase in next)) { next[g.phase] = g.pct < 100; changed = true; }
      });
      return changed ? next : prev;
    });
  }, [phaseGroups]);

  const togglePhase = (phase) => setOpenPhases((prev) => ({ ...prev, [phase]: !prev[phase] }));

  const markReceived = async (pm) => {
    const linked = pieceByPieceMarkId.get(pm.id);
    if (!linked) return;
    await db.entities.pieces.update(linked.id, { field_status: 'On_Site' });
    await loadAll(selectedProjectId);
    toast({ title: `${pm.part_number || pm.piece_mark} received on site` });
  };

  const undoReceived = async (pm) => {
    const linked = pieceByPieceMarkId.get(pm.id);
    if (!linked) return;
    await db.entities.pieces.update(linked.id, { field_status: 'In_Shop' });
    await loadAll(selectedProjectId);
    toast({ title: `${pm.part_number || pm.piece_mark} check-in undone` });
  };

  const handlePhaseScan = async (phase, rows) => {
    const value = (scanValues[phase] || '').trim();
    if (!value) return;
    const match = rows.find((pm) => pm.piece_mark === value || pm.part_number === value || pieceByPieceMarkId.get(pm.id)?.qr_payload_string === value);
    if (!match) {
      toast({ title: 'No matching item found in this phase', variant: 'destructive' });
      return;
    }
    const linked = pieceByPieceMarkId.get(match.id);
    if (!linked) {
      toast({ title: `${match.piece_mark} has not shipped yet — cannot check in`, variant: 'destructive' });
      return;
    }
    if (linked.field_status === 'On_Site') {
      toast({ title: `${match.piece_mark} is already received` });
      setScanValues((f) => ({ ...f, [phase]: '' }));
      return;
    }
    await markReceived(match);
    setScanValues((f) => ({ ...f, [phase]: '' }));
  };

  const rejectedItems = useMemo(() => {
    return loadItems.filter((li) => li.status === 'Field_Rejected').map((li) => {
      const load = loads.find((l) => l.id === li.load_id);
      const piece = pieces.find((p) => p.id === li.piece_id);
      const pm = piece?.piece_mark_id ? pieceMarks.find((x) => x.id === piece.piece_mark_id) : null;
      const manifest = load ? manifests.find((m) => m.load_id === load.id) : null;
      return { loadItem: li, load, piece, pm, manifest };
    });
  }, [loadItems, loads, pieces, pieceMarks, manifests]);

  const inboundLoads = useMemo(() => {
    return loads.filter((l) => l.status === 'In_Transit').map((load) => {
      const manifest = manifests.find((m) => m.load_id === load.id);
      const itemCount = loadItems.filter((li) => li.load_id === load.id).length;
      return { load, manifest, itemCount };
    });
  }, [loads, manifests, loadItems]);

  const openLoadDetail = (load) => setViewingLoad(load);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) || null;

  return (
    <div className="space-y-4">
      <div className="steel-card p-4 max-w-md">
        <Label className="text-xs">Project <span className="text-red-500">*required</span></Label>
        <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
          <SelectTrigger className="mt-1"><SelectValue placeholder="Select a project to view jobsite receiving" /></SelectTrigger>
          <SelectContent>
            {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.project_number} — {p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {!selectedProjectId ? (
        <p className="text-sm text-muted-foreground p-8 text-center">Select a project to view its jobsite receiving tally.</p>
      ) : loading ? (
        <div className="h-64 bg-muted rounded-xl animate-pulse" />
      ) : (
        <>
          {rejectedItems.length > 0 && (
            <div className="rounded-lg border-2 border-red-500/50 bg-red-500/5 p-4 space-y-2">
              <p className="text-sm font-semibold text-red-600 flex items-center gap-2">
                <Ban className="w-4 h-4" />Damaged / Rejected ({rejectedItems.length})
              </p>
              <div className="space-y-1">
                {rejectedItems.map(({ loadItem, load, piece, pm, manifest }) => (
                  <button
                    key={loadItem.id}
                    onClick={() => (pm ? setViewingPieceMark(pm) : load && openLoadDetail(load))}
                    className="flex items-center justify-between w-full text-sm px-2 py-1.5 rounded hover:bg-red-500/10 text-left gap-3"
                  >
                    <span className="font-mono font-medium truncate">{piece?.piece_mark || pm?.piece_mark || '—'}</span>
                    <span className="text-xs text-muted-foreground truncate">{load?.load_number_id || '—'}</span>
                    <span className="text-xs text-muted-foreground truncate flex-shrink-0">{manifest?.driver_name || 'No driver on file'}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {inboundLoads.length > 0 && (
            <div className="rounded-lg border border-blue-500/40 bg-blue-500/5 p-4 space-y-2">
              <p className="text-sm font-semibold text-blue-600 flex items-center gap-2">
                <Truck className="w-4 h-4" />Inbound — Not Yet On Site ({inboundLoads.length})
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {inboundLoads.map(({ load, manifest, itemCount }) => (
                  <button
                    key={load.id}
                    onClick={() => openLoadDetail(load)}
                    className="rounded-lg border border-border bg-card p-3 text-left text-sm hover:bg-muted/50 transition-colors"
                  >
                    <p className="font-semibold">{load.load_number_id}</p>
                    <p className="text-xs text-muted-foreground">{manifest?.driver_name || 'Driver TBD'} • {manifest?.license_plate || 'Plate TBD'}</p>
                    <p className="text-xs text-muted-foreground">{itemCount} item{itemCount === 1 ? '' : 's'}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {phaseGroups.length === 0 ? (
            <p className="text-sm text-muted-foreground p-8 text-center">No piece marks on file for {selectedProject?.name || 'this project'} yet.</p>
          ) : phaseGroups.map((group) => {
            const isOpen = !!openPhases[group.phase];
            return (
              <Collapsible key={group.phase} open={isOpen} onOpenChange={() => togglePhase(group.phase)} className="steel-card overflow-hidden">
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-muted/30 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <p className="font-semibold text-sm">{group.phase}</p>
                        <span className="text-xs text-muted-foreground">{group.received} / {group.expected} received</span>
                        {group.pct === 100 && <Badge className="bg-green-500/10 text-green-600 border-0 text-[10px]">Complete</Badge>}
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden max-w-md">
                        <div className={cn('h-full rounded-full transition-all', group.pct === 100 ? 'bg-green-500' : 'bg-primary')} style={{ width: `${group.pct}%` }} />
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                        {ITEM_TYPES.filter((t) => group.byType[t]).map((t) => (
                          <span key={t} className="text-[11px] text-muted-foreground">{t.replace(/_/g, ' ')}: <span className="font-medium text-foreground">{group.byType[t]}</span></span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-lg font-bold">{group.pct}%</span>
                      <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
                    </div>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="border-t border-border p-4 space-y-3">
                    <div className="flex flex-col gap-2 md:flex-row md:items-center">
                      <QrCode className="w-4 h-4 text-primary flex-shrink-0 hidden md:block" />
                      <Input
                        value={scanValues[group.phase] || ''}
                        onChange={(e) => setScanValues((f) => ({ ...f, [group.phase]: e.target.value }))}
                        onKeyDown={(e) => e.key === 'Enter' && handlePhaseScan(group.phase, group.rows)}
                        placeholder="Scan a QR payload or type a piece mark, then press Enter"
                        className="flex-1"
                      />
                      <Button variant="outline" onClick={() => handlePhaseScan(group.phase, group.rows)}>Check In</Button>
                    </div>

                    <div className="space-y-1.5">
                      {group.rows.map((pm) => {
                        const linked = pieceByPieceMarkId.get(pm.id);
                        const isReceived = linked?.field_status === 'On_Site';
                        return (
                          <div
                            key={pm.id}
                            onClick={() => setViewingPieceMark(pm)}
                            className="flex items-center justify-between gap-3 rounded-lg border border-border p-2.5 text-sm cursor-pointer hover:bg-muted/50 transition-colors"
                          >
                            <div className="min-w-0">
                              <p className="font-mono font-medium truncate">{pm.part_number || pm.piece_mark}</p>
                              <p className="text-xs text-muted-foreground truncate">{(pm.item_type || 'Piece_Mark').replace(/_/g, ' ')}{pm.description ? ` • ${pm.description}` : ''}</p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {!linked ? (
                                <span className="text-xs text-muted-foreground italic">Not yet shipped</span>
                              ) : isReceived ? (
                                <>
                                  <Badge className="bg-green-500/10 text-green-600 border-0 gap-1 text-[10px]"><PackageCheck className="w-3 h-3" />On Site</Badge>
                                  <Button size="icon" variant="ghost" className="h-7 w-7" title="Undo check-in" onClick={(e) => { e.stopPropagation(); undoReceived(pm); }}>
                                    <Undo2 className="w-3.5 h-3.5 text-muted-foreground" />
                                  </Button>
                                </>
                              ) : (
                                <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); markReceived(pm); }}>Mark Received</Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </>
      )}

      <Dialog open={!!viewingPieceMark} onOpenChange={(o) => !o && setViewingPieceMark(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{viewingPieceMark?.part_number || viewingPieceMark?.piece_mark}</DialogTitle></DialogHeader>
          {viewingPieceMark && (() => {
            const pm = viewingPieceMark;
            const linked = pieceByPieceMarkId.get(pm.id);
            const rows = [
              ['Item Type', (pm.item_type || 'Piece_Mark').replace(/_/g, ' ')],
              ['Piece Mark', pm.piece_mark],
              ['Part Number', pm.part_number],
              ['Description', pm.description],
              ['Assembly', pm.assembly],
              ['Phase', pm.phase || 'Unassigned'],
              ['Sequence', pm.sequence],
              ['Quantity', pm.quantity],
              ['Weight (lbs)', pm.weight_lbs],
              ['Material Grade', pm.material_grade],
              ...(pm.item_type === 'Bolt' ? [['Bolt Size', pm.bolt_size], ['Bolt Grade', pm.bolt_grade]] : []),
              ['Drawing Number', pm.drawing_number],
              ['Office Status', pm.status],
              ['Shop Floor Field Status', linked ? linked.field_status : 'Not yet shipped'],
              ['Shop Floor Workflow Status', linked ? linked.workflow_status : '—'],
            ];
            return (
              <div className="space-y-2">
                {rows.map(([label, value]) => (
                  <div key={label} className="grid grid-cols-3 gap-2 text-sm border-b border-border/50 pb-2">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="col-span-2 font-medium">{value || value === 0 ? value : '—'}</span>
                  </div>
                ))}
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewingPieceMark(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewingLoad} onOpenChange={(o) => !o && setViewingLoad(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{viewingLoad?.load_number_id}</DialogTitle></DialogHeader>
          {viewingLoad && (() => {
            const load = viewingLoad;
            const manifest = manifests.find((m) => m.load_id === load.id);
            const items = loadItems.filter((li) => li.load_id === load.id);
            const rows = [
              ['Status', load.status],
              ['Total Weight (lbs)', load.total_weight_lbs],
              ['Driver Name', manifest?.driver_name],
              ['Driver Phone', manifest?.driver_phone],
              ['Trailer Type', manifest?.trailer_type],
              ['License Plate', manifest?.license_plate],
              ['Manifest QR', manifest?.manifest_qr_payload_string],
            ];
            return (
              <div className="space-y-3">
                <div className="space-y-2">
                  {rows.map(([label, value]) => (
                    <div key={label} className="grid grid-cols-3 gap-2 text-sm border-b border-border/50 pb-2">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="col-span-2 font-medium">{value || value === 0 ? value : '—'}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Items ({items.length})</p>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {items.map((li) => {
                      const piece = pieces.find((p) => p.id === li.piece_id);
                      return (
                        <div key={li.id} className="flex items-center justify-between text-sm px-2 py-1 rounded border border-border/50">
                          <span className="font-mono">{piece?.piece_mark || li.piece_id}</span>
                          <span className={cn('text-xs', li.status === 'Field_Rejected' ? 'text-red-600' : 'text-muted-foreground')}>
                            {li.status === 'Field_Rejected' && <AlertTriangle className="w-3 h-3 inline mr-1" />}{li.status}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewingLoad(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
