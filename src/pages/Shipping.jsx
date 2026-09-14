import React, { useState, useEffect } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { db } from '@/api/apiClient';
import { Truck, Package, CheckCircle2, FileCheck, PauseCircle, PlayCircle, PackagePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import LoadBuilder from '@/components/shipping/LoadBuilder';
import YardScanning from '@/components/shipping/YardScanning';
import LoadDetailModal from '@/components/shipping/LoadDetailModal';
import PieceDetailModal from '@/components/shipping/PieceDetailModal';
import ManifestDetailModal from '@/components/shipping/ManifestDetailModal';
import AdHocShipmentModal from '@/components/shipping/AdHocShipmentModal';
import AdHocShipmentDetailModal from '@/components/shipping/AdHocShipmentDetailModal';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { openDocumentViewer } from '@/lib/openDocumentViewer';
import { getEffectiveCompany, isSuperAdmin, isImpersonating } from '@/lib/tenantContext';
import { hasModule } from '@/lib/moduleEntitlement';
import ModuleLocked from '@/components/shared/ModuleLocked';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/lib/AuthContext';
import { logStatusChange } from '@/lib/statusHistory';

// Loads that have finished Load Builder (Load Complete) and are ready,
// inspected, or already moving — the main Shipping List. Draft/Staged
// (still being actively built) and Partial_Loaded (paused) stay out of this
// tab; Partial_Loaded gets its own section below it instead.
const SHIPPING_LIST_STATUSES = ['Loaded', 'Inspected', 'In_Transit', 'Delivered', 'Field_Issue'];

// Statuses freely changeable directly from the Shipping List via a quick
// per-row dropdown — deliberately excludes 'Loaded', since Loaded -> Inspected
// must keep going through Yard Scanning's Call Inspection flow (the physical
// scan-verification gate this pipeline was built around). Any of these four
// can move to any other, covering both the normal forward chain and manual
// corrections (e.g. a load marked In_Transit that actually needs Field_Issue).
const STATUS_QUICK_OPTIONS = ['Inspected', 'In_Transit', 'Delivered', 'Field_Issue'];

export default function Shipping() {
  useDocumentTitle('SteelOS — Shipping');
  const { toast } = useToast();
  const { user } = useAuth();
  const changedBy = user?.full_name || user?.email || 'Unknown';
  const [activeTab, setActiveTab] = useState('list');

  // Drill-down targets, shared across the Shipping List tab and the
  // LoadBuilder/YardScanning child components (passed down as callbacks) so
  // every surface that shows a load/piece/manifest opens the same modal.
  const [viewingLoadId, setViewingLoadId] = useState(null);
  const [viewingPiece, setViewingPiece] = useState(null); // { pieceMarkId } | { pieceId }
  const [viewingManifestId, setViewingManifestId] = useState(null);
  const [viewingAdHocShipmentId, setViewingAdHocShipmentId] = useState(null);
  const [showAdHocShipmentModal, setShowAdHocShipmentModal] = useState(false);

  // Set when "Resume" is clicked on a Partial Load — tells LoadBuilder which
  // load to focus once the Load Builder tab is active, then gets cleared.
  const [resumeLoadId, setResumeLoadId] = useState(null);
  const [statusDialog, setStatusDialog] = useState(null); // { title, rows: PieceMark[] }

  const [pieces, setPieces] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  // Module 9 (Load Builder / Yard Scanning) data — kept separate from the
  // PieceMark-based state above, since it operates on the Module 8 `pieces`
  // entity (workflow_status) instead of `PieceMark` (status). This is the
  // only load/trailer system in this file — the legacy shipping_loads +
  // PieceMark.shipping_load_id drag-drop system (Trailer Matrix tab) was
  // removed and migrated onto loads/load_items/shipping_manifests; see
  // migrateLegacyShippingLoads in src/api/localData.js.
  const [shopPieces, setShopPieces] = useState([]);
  const [loads, setLoads] = useState([]);
  const [loadItems, setLoadItems] = useState([]);
  const [manifests, setManifests] = useState([]);
  const [carriers, setCarriers] = useState([]);
  const [pieceMarks, setPieceMarks] = useState([]);
  const [adHocShipments, setAdHocShipments] = useState([]);
  const [moduleAllowed, setModuleAllowed] = useState(false);
  const [checkingModuleAccess, setCheckingModuleAccess] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => { loadData(); loadLogisticsData(); }, []);
  useEffect(() => {
    db.auth.me().then((me) => setCurrentUser(me || null)).catch(() => setCurrentUser(null));
    getEffectiveCompany()
      .then((company) => setModuleAllowed(hasModule(company, '/shipping')))
      .catch(() => setModuleAllowed(false))
      .finally(() => setCheckingModuleAccess(false));
  }, []);

  const loadLogisticsData = async () => {
    try {
      const [pieceData, loadsData, itemsData, manifestData, carrierData, pieceMarkData, adHocData] = await Promise.all([
        db.entities.pieces.list('-created_date', 200),
        db.entities.loads.list('-created_date', 100),
        db.entities.load_items.list('-created_date', 500),
        db.entities.shipping_manifests.list('-created_date', 100),
        db.entities.Vendor.filter({ vendor_type: 'carrier', is_active: true }, 'name', 50),
        db.entities.PieceMark.list('-created_date', 500),
        db.entities.AdHocShipment.list('-created_date', 100),
      ]);
      setShopPieces(pieceData);
      setLoads(loadsData);
      setLoadItems(itemsData);
      setManifests(manifestData);
      setCarriers(carrierData);
      setPieceMarks(pieceMarkData);
      setAdHocShipments(adHocData);
    } catch (e) {}
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [pieceData, projData] = await Promise.all([
        db.entities.PieceMark.filter({ status: { $in: ['painted', 'shipped', 'erected'] } }, '-updated_date', 200),
        db.entities.Project.filter({ is_archived: false }, 'name', 50),
      ]);
      setPieces(pieceData);
      setProjects(projData);
    } catch (e) {} finally { setLoading(false); }
  };

  const readyToShip = pieces.filter(p => p.status === 'painted');
  const shipped = pieces.filter(p => p.status === 'shipped');
  const erected = pieces.filter(p => p.status === 'erected');

  const jobName = (projectId) => {
    const p = projects.find(pr => pr.id === projectId);
    return p ? `${p.project_number} — ${p.name}` : '—';
  };

  const carrierLabel = (load) => load.carrier_name || carriers.find(c => c.id === load.carrier_vendor_id)?.name || '—';

  const shippingListLoads = loads.filter(l => SHIPPING_LIST_STATUSES.includes(l.status));
  const partialLoads = loads.filter(l => l.status === 'Partial_Loaded');

  const resumePartialLoad = (loadId) => {
    setResumeLoadId(loadId);
    setActiveTab('load-builder');
  };

  // Quick per-row status flip from the Shipping List — only ever offered for
  // STATUS_QUICK_OPTIONS statuses (never 'Loaded'), so Loaded -> Inspected
  // still requires Yard Scanning's Call Inspection scan-verification gate.
  // Mirrors YardScanning.jsx's handleMasterReceiptScan side effect (marking
  // non-rejected load_items' pieces On_Site) when the target is Delivered, so
  // a load's downstream field_status is consistent regardless of which path
  // (master QR scan vs. this manual correction) delivered it.
  const handleQuickStatusChange = async (load, newStatus) => {
    if (!newStatus || newStatus === load.status) return;
    try {
      await db.entities.loads.update(load.id, { status: newStatus });
      await logStatusChange({
        entityType: 'loads',
        entityId: load.id,
        fieldName: 'status',
        fromValue: load.status,
        toValue: newStatus,
        changedBy,
        note: 'Changed from the Shipping List.',
      });
      if (newStatus === 'Delivered') {
        const deliveredItems = loadItems.filter((li) => li.load_id === load.id && li.status !== 'Field_Rejected');
        await Promise.all(deliveredItems.map((li) => db.entities.pieces.update(li.piece_id, { field_status: 'On_Site' })));
        await Promise.all(deliveredItems.map((li) => {
          const piece = shopPieces.find((p) => p.id === li.piece_id);
          return logStatusChange({
            entityType: 'pieces',
            entityId: li.piece_id,
            fieldName: 'field_status',
            fromValue: piece?.field_status,
            toValue: 'On_Site',
            changedBy,
            note: `Delivered on load ${load.load_number_id} (status changed from Shipping List).`,
          });
        }));
      }
      await loadLogisticsData();
      toast({ title: `${load.load_number_id} marked ${newStatus.replace(/_/g, ' ')}` });
    } catch (e) {
      toast({ title: 'Unable to update status', variant: 'destructive' });
    }
  };

  const isPlatformOperatorView = isSuperAdmin(currentUser) && !isImpersonating();
  const showModule = moduleAllowed || isPlatformOperatorView;

  if (checkingModuleAccess) return <div className="p-6"><div className="h-96 bg-muted rounded-xl animate-pulse" /></div>;

  // Route guard — a direct URL to /shipping can't bypass the nav's
  // module-pack filtering. Load building and yard scanning is Fabricator +
  // Enterprise Connect only (see modulePacks.js); an Erector-pack company
  // has no shop-side loads to build, so none of this applies to them.
  if (!showModule) {
    return <ModuleLocked modulePath="/shipping" title="Shipping Not Included" />;
  }

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader
        title="Shipping & Delivery"
        subtitle="Build loads, inspect, and track shipments through delivery"
        actions={(
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setActiveTab('adhoc-shipments')}><PackagePlus className="w-4 h-4 mr-2" />Ad-Hoc Shipment</Button>
            <Button className="steel-gradient text-white border-0" onClick={() => setActiveTab('load-builder')}><Truck className="w-4 h-4 mr-2" />Load Builder</Button>
          </div>
        )}
      />

      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Ready to Ship', value: readyToShip.length, icon: Package, color: 'text-blue-500', rows: readyToShip },
          { label: 'Shipped', value: shipped.length, icon: Truck, color: 'text-orange-500', rows: shipped },
          { label: 'Erected', value: erected.length, icon: CheckCircle2, color: 'text-green-500', rows: erected },
        ].map(({ label, value, icon: Icon, color, rows }) => (
          <button
            type="button"
            key={label}
            onClick={() => setStatusDialog({ title: label, rows })}
            className="steel-card p-4 text-left hover:ring-2 hover:ring-primary/40 transition-shadow"
          >
            <div className="flex items-center gap-2 mb-1"><Icon className={`w-4 h-4 ${color}`} /><p className="text-xs text-muted-foreground">{label}</p></div>
            <p className={`text-2xl font-bold ${color}`}>{loading ? '—' : value}</p>
          </button>
        ))}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="list">Shipping List</TabsTrigger>
          <TabsTrigger value="load-builder">Load Builder</TabsTrigger>
          <TabsTrigger value="yard-scanning">Yard Scanning</TabsTrigger>
          <TabsTrigger value="adhoc-shipments">Ad-Hoc Shipments</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-6">
          {partialLoads.length > 0 && (
            <div className="steel-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-yellow-500/5 flex items-center gap-2">
                <PauseCircle className="w-4 h-4 text-yellow-600" />
                <h3 className="text-sm font-semibold">Partial Loads</h3>
                <span className="text-xs text-muted-foreground">{partialLoads.length} paused mid-load</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                      <th className="text-left py-3 px-4">Load Number</th>
                      <th className="text-left py-3 px-4">Job</th>
                      <th className="text-left py-3 px-4">Trailer Number</th>
                      <th className="text-left py-3 px-4">Pieces</th>
                      <th className="text-right py-3 px-4">Resume</th>
                    </tr>
                  </thead>
                  <tbody>
                    {partialLoads.map(load => (
                      <tr key={load.id} onClick={() => setViewingLoadId(load.id)} className="border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer">
                        <td className="py-3 px-4 font-mono font-bold text-primary">{load.load_number_id}</td>
                        <td className="py-3 px-4">{jobName(load.project_id)}</td>
                        <td className="py-3 px-4">{load.trailer_number || '—'}</td>
                        <td className="py-3 px-4 font-mono">{loadItems.filter(li => li.load_id === load.id).length}</td>
                        <td className="py-3 px-4 text-right">
                          <Button size="sm" variant="outline" className="gap-1.5" onClick={(e) => { e.stopPropagation(); resumePartialLoad(load.id); }}>
                            <PlayCircle className="w-3.5 h-3.5" />Resume
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="steel-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="text-left py-3 px-4">Load Number</th>
                    <th className="text-left py-3 px-4">Job</th>
                    <th className="text-left py-3 px-4">Trailer Number</th>
                    <th className="text-left py-3 px-4">Carrier</th>
                    <th className="text-left py-3 px-4">Status</th>
                    <th className="text-right py-3 px-4">BOL</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i}><td colSpan={6} className="py-3 px-4"><div className="h-6 bg-muted rounded animate-pulse" /></td></tr>
                    ))
                  ) : shippingListLoads.length === 0 ? (
                    <tr><td colSpan={6} className="py-16 text-center">
                      <Truck className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground">No completed loads yet — finish a load in Load Builder to see it here.</p>
                    </td></tr>
                  ) : (
                    shippingListLoads.map(load => (
                      <tr key={load.id} onClick={() => setViewingLoadId(load.id)} className="border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer">
                        <td className="py-3 px-4 font-mono font-bold text-primary">{load.load_number_id}</td>
                        <td className="py-3 px-4 text-muted-foreground">{jobName(load.project_id)}</td>
                        <td className="py-3 px-4">{load.trailer_number || '—'}</td>
                        <td className="py-3 px-4">{carrierLabel(load)}</td>
                        <td className="py-3 px-4">
                          <div className="flex flex-col items-start gap-1.5">
                            <button onClick={(e) => { e.stopPropagation(); setViewingLoadId(load.id); }}>
                              <StatusBadge status={load.status} label={(load.status || '').replace(/_/g, ' ')} />
                            </button>
                            {STATUS_QUICK_OPTIONS.includes(load.status) && (
                              <Select value={load.status} onValueChange={(v) => handleQuickStatusChange(load, v)}>
                                <SelectTrigger className="h-7 w-36 text-xs" onClick={(e) => e.stopPropagation()}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent onClick={(e) => e.stopPropagation()}>
                                  {STATUS_QUICK_OPTIONS.map((s) => (
                                    <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right">
                          {load.bol_pdf_data_uri ? (
                            <button
                              title="View / Print BOL"
                              onClick={(e) => { e.stopPropagation(); openDocumentViewer(load.bol_pdf_data_uri, `BOL-${load.load_number_id || ''}.pdf`); }}
                              className="text-muted-foreground hover:text-primary inline-flex"
                            >
                              <FileCheck className="w-4 h-4" />
                            </button>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="load-builder">
          <LoadBuilder
            pieces={shopPieces}
            loads={loads}
            loadItems={loadItems}
            projects={projects}
            pieceMarks={pieceMarks}
            onReload={loadLogisticsData}
            onViewLoad={setViewingLoadId}
            onViewPiece={setViewingPiece}
            focusLoadId={resumeLoadId}
            onFocusHandled={() => setResumeLoadId(null)}
          />
        </TabsContent>

        <TabsContent value="yard-scanning">
          <YardScanning
            pieces={shopPieces}
            loads={loads}
            loadItems={loadItems}
            manifests={manifests}
            projects={projects}
            onReload={loadLogisticsData}
            onViewLoad={setViewingLoadId}
            onViewPiece={setViewingPiece}
            onViewManifest={setViewingManifestId}
          />
        </TabsContent>

        <TabsContent value="adhoc-shipments" className="space-y-4">
          <div className="flex justify-end">
            <Button className="steel-gradient text-white border-0" onClick={() => setShowAdHocShipmentModal(true)}>
              <PackagePlus className="w-4 h-4 mr-2" />New Ad-Hoc Shipment
            </Button>
          </div>
          <div className="steel-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="text-left py-3 px-4">Shipment #</th>
                    <th className="text-left py-3 px-4">Project / Destination</th>
                    <th className="text-left py-3 px-4">Carrier</th>
                    <th className="text-left py-3 px-4">Vehicle</th>
                    <th className="text-left py-3 px-4">Ship Date</th>
                    <th className="text-right py-3 px-4">BOL</th>
                  </tr>
                </thead>
                <tbody>
                  {adHocShipments.length === 0 ? (
                    <tr><td colSpan={6} className="py-16 text-center">
                      <PackagePlus className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground">No ad-hoc shipments yet — use New Ad-Hoc Shipment to build a quick BOL without a formal load.</p>
                    </td></tr>
                  ) : (
                    adHocShipments.map((shipment) => (
                      <tr key={shipment.id} onClick={() => setViewingAdHocShipmentId(shipment.id)} className="border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer">
                        <td className="py-3 px-4 font-mono font-bold text-primary">{shipment.shipment_number_id}</td>
                        <td className="py-3 px-4 text-muted-foreground">{shipment.project_id ? jobName(shipment.project_id) : shipment.destination_address}</td>
                        <td className="py-3 px-4">{shipment.carrier || '—'}</td>
                        <td className="py-3 px-4">{(shipment.vehicle_type || '').replace(/_/g, ' ')}</td>
                        <td className="py-3 px-4">{shipment.ship_date || '—'}</td>
                        <td className="py-3 px-4 text-right">
                          {shipment.bol_pdf_data_uri ? (
                            <button
                              title="View / Print BOL"
                              onClick={(e) => { e.stopPropagation(); openDocumentViewer(shipment.bol_pdf_data_uri, `BOL-${shipment.shipment_number_id || ''}.pdf`); }}
                              className="text-muted-foreground hover:text-primary inline-flex"
                            >
                              <FileCheck className="w-4 h-4" />
                            </button>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <LoadDetailModal
        open={!!viewingLoadId}
        onOpenChange={(open) => !open && setViewingLoadId(null)}
        loadId={viewingLoadId}
        onViewPiece={setViewingPiece}
        onViewManifest={setViewingManifestId}
      />

      <PieceDetailModal
        open={!!viewingPiece}
        onOpenChange={(open) => !open && setViewingPiece(null)}
        pieceMarkId={viewingPiece?.pieceMarkId}
        pieceId={viewingPiece?.pieceId}
        onViewLoad={(loadId) => { setViewingPiece(null); setViewingLoadId(loadId); }}
      />

      <ManifestDetailModal
        open={!!viewingManifestId}
        onOpenChange={(open) => !open && setViewingManifestId(null)}
        manifestId={viewingManifestId}
        onViewLoad={(loadId) => { setViewingManifestId(null); setViewingLoadId(loadId); }}
      />

      <AdHocShipmentModal
        open={showAdHocShipmentModal}
        onOpenChange={setShowAdHocShipmentModal}
        projects={projects}
        pieces={shopPieces}
        shipments={adHocShipments}
        onCreated={loadLogisticsData}
      />

      <AdHocShipmentDetailModal
        open={!!viewingAdHocShipmentId}
        onOpenChange={(open) => !open && setViewingAdHocShipmentId(null)}
        shipmentId={viewingAdHocShipmentId}
      />

      <Dialog open={!!statusDialog} onOpenChange={(o) => !o && setStatusDialog(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{statusDialog?.title}</DialogTitle></DialogHeader>
          {(statusDialog?.rows || []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No pieces in this status.</p>
          ) : (
            <div className="space-y-1.5">
              {statusDialog.rows.map((pm) => (
                <button
                  key={pm.id}
                  onClick={() => { setStatusDialog(null); setViewingPiece({ pieceMarkId: pm.id }); }}
                  className="w-full flex items-center justify-between gap-3 rounded-lg border border-border p-2.5 text-sm text-left hover:bg-muted/50 transition-colors"
                >
                  <span className="font-mono font-medium">{pm.piece_mark}</span>
                  <span className="text-xs text-muted-foreground">{jobName(pm.project_id)}</span>
                </button>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusDialog(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
