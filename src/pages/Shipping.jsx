import React, { useState, useEffect } from 'react';
import { db } from '@/api/apiClient';
import { Truck, Package, CheckCircle2, Search, Plus, GripVertical } from 'lucide-react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/use-toast';
import LoadBuilder from '@/components/shipping/LoadBuilder';
import YardScanning from '@/components/shipping/YardScanning';

const TRAILER_STATUSES = ['Loading', 'In-Transit', 'Delivered'];

const emptyLoadForm = () => ({ project_id: '', trailer_id: '', carrier_name: '', status: 'Loading' });

export default function Shipping() {
  const { toast } = useToast();
  const [pieces, setPieces] = useState([]);
  const [projects, setProjects] = useState([]);
  const [trailerLoads, setTrailerLoads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('all');
  const [showLoadForm, setShowLoadForm] = useState(false);
  const [loadForm, setLoadForm] = useState(emptyLoadForm());
  const [savingLoad, setSavingLoad] = useState(false);

  // Module 9 (Load Builder / Yard Scanning) data — kept separate from the
  // legacy PieceMark-based state above, since it operates on the Module 8
  // `pieces` entity (workflow_status) instead of `PieceMark` (status).
  const [shopPieces, setShopPieces] = useState([]);
  const [loads, setLoads] = useState([]);
  const [loadItems, setLoadItems] = useState([]);
  const [manifests, setManifests] = useState([]);
  const [carriers, setCarriers] = useState([]);

  useEffect(() => { loadData(); loadLogisticsData(); }, []);

  const loadLogisticsData = async () => {
    try {
      const [pieceData, loadsData, itemsData, manifestData, carrierData] = await Promise.all([
        db.entities.pieces.list('-created_date', 200),
        db.entities.loads.list('-created_date', 100),
        db.entities.load_items.list('-created_date', 500),
        db.entities.shipping_manifests.list('-created_date', 100),
        db.entities.Vendor.filter({ vendor_type: 'carrier', is_active: true }, 'name', 50),
      ]);
      setShopPieces(pieceData);
      setLoads(loadsData);
      setLoadItems(itemsData);
      setManifests(manifestData);
      setCarriers(carrierData);
    } catch (e) {}
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [pieceData, projData, loadData_] = await Promise.all([
        db.entities.PieceMark.filter({ status: { $in: ['painted', 'shipped', 'erected'] } }, '-updated_date', 200),
        db.entities.Project.filter({ is_archived: false }, 'name', 50),
        db.entities.shipping_loads.list('-created_date', 100),
      ]);
      setPieces(pieceData);
      setProjects(projData);
      setTrailerLoads(loadData_);
    } catch (e) {} finally { setLoading(false); }
  };

  const readyToShip = pieces.filter(p => p.status === 'painted');
  const shipped = pieces.filter(p => p.status === 'shipped');
  const erected = pieces.filter(p => p.status === 'erected');

  const filtered = pieces.filter(p => {
    const matchSearch = !search || p.piece_mark?.toLowerCase().includes(search.toLowerCase());
    const matchProject = projectFilter === 'all' || p.project_id === projectFilter;
    return matchSearch && matchProject;
  });

  const handleCreateLoad = async () => {
    if (!loadForm.trailer_id.trim()) {
      toast({ title: 'Trailer ID/Name is required', variant: 'destructive' });
      return;
    }
    setSavingLoad(true);
    try {
      const created = await db.entities.shipping_loads.create({
        project_id: loadForm.project_id,
        load_number: `Load ${trailerLoads.length + 1}`,
        trailer_id: loadForm.trailer_id.trim(),
        trailer_type: loadForm.trailer_id.trim(),
        carrier_name: loadForm.carrier_name.trim(),
        status: loadForm.status,
      });
      setTrailerLoads((prev) => [created, ...prev]);
      setShowLoadForm(false);
      setLoadForm(emptyLoadForm());
      toast({ title: 'Trailer load created' });
    } catch (e) {
      toast({ title: 'Unable to create trailer load', variant: 'destructive' });
    } finally {
      setSavingLoad(false);
    }
  };

  const handleLoadStatusChange = async (load, status) => {
    try {
      const updated = await db.entities.shipping_loads.update(load.id, { status });
      setTrailerLoads((prev) => prev.map((l) => (l.id === load.id ? updated : l)));
    } catch (e) {
      toast({ title: 'Unable to update status', variant: 'destructive' });
    }
  };

  const handleDragEnd = async (result) => {
    const { source, destination, draggableId } = result;
    if (!destination || source.droppableId === destination.droppableId) return;
    const shipping_load_id = destination.droppableId === 'unassigned' ? '' : destination.droppableId.replace('load-', '');
    setPieces((prev) => prev.map((p) => (p.id === draggableId ? { ...p, shipping_load_id } : p)));
    try {
      await db.entities.PieceMark.update(draggableId, { shipping_load_id });
    } catch (e) {
      toast({ title: 'Unable to save assignment', variant: 'destructive' });
    }
  };

  const unassignedPieces = pieces.filter(p => p.status === 'painted' && !p.shipping_load_id);

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader
        title="Shipping & Delivery"
        subtitle="Track painted, shipped, and erected pieces"
        actions={<Button className="steel-gradient text-white border-0"><Truck className="w-4 h-4 mr-2" />Create Shipping List</Button>}
      />

      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Ready to Ship', value: readyToShip.length, icon: Package, color: 'text-blue-500' },
          { label: 'Shipped', value: shipped.length, icon: Truck, color: 'text-orange-500' },
          { label: 'Erected', value: erected.length, icon: CheckCircle2, color: 'text-green-500' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="steel-card p-4">
            <div className="flex items-center gap-2 mb-1"><Icon className={`w-4 h-4 ${color}`} /><p className="text-xs text-muted-foreground">{label}</p></div>
            <p className={`text-2xl font-bold ${color}`}>{loading ? '—' : value}</p>
          </div>
        ))}
      </div>

      <Tabs defaultValue="list">
        <TabsList className="mb-4">
          <TabsTrigger value="list">Shipping List</TabsTrigger>
          <TabsTrigger value="matrix">Trailer Matrix</TabsTrigger>
          <TabsTrigger value="load-builder">Load Builder</TabsTrigger>
          <TabsTrigger value="yard-scanning">Yard Scanning</TabsTrigger>
        </TabsList>

        <TabsContent value="list">
          <div className="flex gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search piece marks..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={projectFilter} onValueChange={setProjectFilter}>
              <SelectTrigger className="w-56"><SelectValue placeholder="All Projects" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.project_number} — {p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="steel-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="text-left py-3 px-4">Piece Mark</th>
                    <th className="text-left py-3 px-4">Assembly</th>
                    <th className="text-right py-3 px-4">Weight (lbs)</th>
                    <th className="text-left py-3 px-4">Ship Date</th>
                    <th className="text-left py-3 px-4">Erect Date</th>
                    <th className="text-left py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i}><td colSpan={6} className="py-3 px-4"><div className="h-6 bg-muted rounded animate-pulse" /></td></tr>
                    ))
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={6} className="py-16 text-center">
                      <Truck className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground">No painted or shipped pieces yet</p>
                    </td></tr>
                  ) : (
                    filtered.map(p => (
                      <tr key={p.id} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-primary">{p.piece_mark}</td>
                        <td className="py-3 px-4 text-muted-foreground">{p.assembly || '—'}</td>
                        <td className="py-3 px-4 text-right font-mono">{p.weight_lbs?.toLocaleString() || '—'}</td>
                        <td className="py-3 px-4 text-xs">{p.ship_date || '—'}</td>
                        <td className="py-3 px-4 text-xs">{p.erect_date || '—'}</td>
                        <td className="py-3 px-4"><StatusBadge status={p.status} /></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="matrix">
          <div className="flex justify-end mb-4">
            <Button onClick={() => setShowLoadForm(true)} className="steel-gradient text-white border-0">
              <Plus className="w-4 h-4 mr-2" />New Trailer Load
            </Button>
          </div>

          <DragDropContext onDragEnd={handleDragEnd}>
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
              <Droppable droppableId="unassigned">
                {(provided) => (
                  <div ref={provided.innerRef} {...provided.droppableProps} className="steel-card p-3">
                    <h4 className="font-semibold text-sm mb-2 flex items-center justify-between">
                      Unassigned <span className="text-xs text-muted-foreground font-normal">{unassignedPieces.length}</span>
                    </h4>
                    <div className="space-y-2 min-h-[100px]">
                      {unassignedPieces.map((p, i) => (
                        <Draggable key={p.id} draggableId={p.id} index={i}>
                          {(dragProvided) => (
                            <div
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              {...dragProvided.dragHandleProps}
                              className="steel-card p-2 text-xs flex items-center gap-2 cursor-grab active:cursor-grabbing"
                            >
                              <GripVertical className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                              <div className="min-w-0">
                                <p className="font-mono font-bold truncate">{p.piece_mark}</p>
                                <p className="text-muted-foreground truncate">{p.weight_lbs ? `${p.weight_lbs.toLocaleString()} lbs` : ''}</p>
                              </div>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  </div>
                )}
              </Droppable>

              {trailerLoads.map((load) => {
                const loadPieces = pieces.filter(p => p.shipping_load_id === load.id);
                return (
                  <Droppable key={load.id} droppableId={`load-${load.id}`}>
                    {(provided) => (
                      <div ref={provided.innerRef} {...provided.droppableProps} className="steel-card p-3">
                        <div className="flex items-center justify-between mb-1">
                          <h4 className="font-semibold text-sm truncate">{load.trailer_id || load.trailer_type || load.load_number}</h4>
                          <span className="text-xs text-muted-foreground">{loadPieces.length}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-2">{load.carrier_name || 'No carrier'}</p>
                        <Select value={load.status || 'Loading'} onValueChange={(v) => handleLoadStatusChange(load, v)}>
                          <SelectTrigger className="h-7 text-xs mb-2"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {TRAILER_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <div className="space-y-2 min-h-[100px]">
                          {loadPieces.map((p, i) => (
                            <Draggable key={p.id} draggableId={p.id} index={i}>
                              {(dragProvided) => (
                                <div
                                  ref={dragProvided.innerRef}
                                  {...dragProvided.draggableProps}
                                  {...dragProvided.dragHandleProps}
                                  className="steel-card p-2 text-xs flex items-center gap-2 cursor-grab active:cursor-grabbing"
                                >
                                  <GripVertical className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                                  <div className="min-w-0">
                                    <p className="font-mono font-bold truncate">{p.piece_mark}</p>
                                    <p className="text-muted-foreground truncate">{p.weight_lbs ? `${p.weight_lbs.toLocaleString()} lbs` : ''}</p>
                                  </div>
                                </div>
                              )}
                            </Draggable>
                          ))}
                          {provided.placeholder}
                        </div>
                      </div>
                    )}
                  </Droppable>
                );
              })}
            </div>
          </DragDropContext>
        </TabsContent>

        <TabsContent value="load-builder">
          <LoadBuilder
            pieces={shopPieces}
            loads={loads}
            loadItems={loadItems}
            carriers={carriers}
            projects={projects}
            onReload={loadLogisticsData}
          />
        </TabsContent>

        <TabsContent value="yard-scanning">
          <YardScanning
            pieces={shopPieces}
            loads={loads}
            loadItems={loadItems}
            manifests={manifests}
            onReload={loadLogisticsData}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={showLoadForm} onOpenChange={setShowLoadForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Trailer Load</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Project</Label>
              <Select value={loadForm.project_id} onValueChange={(v) => setLoadForm((f) => ({ ...f, project_id: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select a project" /></SelectTrigger>
                <SelectContent>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.project_number} — {p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Trailer ID / Name</Label>
              <Input value={loadForm.trailer_id} onChange={(e) => setLoadForm((f) => ({ ...f, trailer_id: e.target.value }))} className="mt-1" placeholder="Trailer 12 / Flatbed A" />
            </div>
            <div>
              <Label>Carrier</Label>
              <Input value={loadForm.carrier_name} onChange={(e) => setLoadForm((f) => ({ ...f, carrier_name: e.target.value }))} className="mt-1" placeholder="Arrow Logistics" />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={loadForm.status} onValueChange={(v) => setLoadForm((f) => ({ ...f, status: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRAILER_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLoadForm(false)}>Cancel</Button>
            <Button onClick={handleCreateLoad} disabled={savingLoad} className="steel-gradient text-white border-0">
              {savingLoad ? 'Creating…' : 'Create Load'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
