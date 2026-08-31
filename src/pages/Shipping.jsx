import React, { useState, useEffect } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { db } from '@/api/apiClient';
import { Truck, Package, CheckCircle2, FileCheck, PauseCircle, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import LoadBuilder from '@/components/shipping/LoadBuilder';
import YardScanning from '@/components/shipping/YardScanning';
import LoadDetailModal from '@/components/shipping/LoadDetailModal';
import PieceDetailModal from '@/components/shipping/PieceDetailModal';
import ManifestDetailModal from '@/components/shipping/ManifestDetailModal';
import { openDocumentViewer } from '@/lib/openDocumentViewer';
import { getEffectiveCompany, isSuperAdmin, isImpersonating } from '@/lib/tenantContext';
import { hasModule } from '@/lib/moduleEntitlement';
import ModuleLocked from '@/components/shared/ModuleLocked';

// Loads that have finished Load Builder (Load Complete) and are ready,
// inspected, or already moving — the main Shipping List. Draft/Staged
// (still being actively built) and Partial_Loaded (paused) stay out of this
// tab; Partial_Loaded gets its own section below it instead.
const SHIPPING_LIST_STATUSES = ['Loaded', 'Inspected', 'In_Transit', 'Delivered', 'Field_Issue'];

export default function Shipping() {
  useDocumentTitle('SteelOS — Shipping');
  const [activeTab, setActiveTab] = useState('list');

  // Drill-down targets, shared across the Shipping List tab and the
  // LoadBuilder/YardScanning child components (passed down as callbacks) so
  // every surface that shows a load/piece/manifest opens the same modal.
  const [viewingLoadId, setViewingLoadId] = useState(null);
  const [viewingPiece, setViewingPiece] = useState(null); // { pieceMarkId } | { pieceId }
  const [viewingManifestId, setViewingManifestId] = useState(null);

  // Set when "Resume" is clicked on a Partial Load — tells LoadBuilder which
  // load to focus once the Load Builder tab is active, then gets cleared.
  const [resumeLoadId, setResumeLoadId] = useState(null);

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
      const [pieceData, loadsData, itemsData, manifestData, carrierData, pieceMarkData] = await Promise.all([
        db.entities.pieces.list('-created_date', 200),
        db.entities.loads.list('-created_date', 100),
        db.entities.load_items.list('-created_date', 500),
        db.entities.shipping_manifests.list('-created_date', 100),
        db.entities.Vendor.filter({ vendor_type: 'carrier', is_active: true }, 'name', 50),
        db.entities.PieceMark.list('-created_date', 500),
      ]);
      setShopPieces(pieceData);
      setLoads(loadsData);
      setLoadItems(itemsData);
      setManifests(manifestData);
      setCarriers(carrierData);
      setPieceMarks(pieceMarkData);
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
        actions={<Button className="steel-gradient text-white border-0" onClick={() => setActiveTab('load-builder')}><Truck className="w-4 h-4 mr-2" />Load Builder</Button>}
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

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="list">Shipping List</TabsTrigger>
          <TabsTrigger value="load-builder">Load Builder</TabsTrigger>
          <TabsTrigger value="yard-scanning">Yard Scanning</TabsTrigger>
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
                          <button onClick={(e) => { e.stopPropagation(); setViewingLoadId(load.id); }}>
                            <StatusBadge status={load.status} label={(load.status || '').replace(/_/g, ' ')} />
                          </button>
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

    </div>
  );
}
