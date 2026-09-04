import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { db } from '@/api/apiClient';
import {
  buildWeekColumns, buildCapacityMatrix, getStationBottlenecks, getStationDwellVariance, getStalePieces,
  getEmployeeScorecards, getMaterialShortages, stationName, HEATMAP_COLOR,
} from '@/lib/shopOpsMetrics';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import PageHeader from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/use-toast';
import { AlertTriangle, Zap, Users, PackageX, Gauge, Plus, Printer } from 'lucide-react';
import LabelPrintingPanel from '@/components/barcode-printing/LabelPrintingPanel';
import PieceReceivingQueue from '@/components/barcode-printing/PieceReceivingQueue';
import QrExportQueue from '@/components/barcode-printing/QrExportQueue';
import { getEffectiveCompany, isSuperAdmin, isImpersonating } from '@/lib/tenantContext';
import { hasModule } from '@/lib/moduleEntitlement';
import ModuleLocked from '@/components/shared/ModuleLocked';

const emptyOverrideForm = () => ({ piece_id: '', override_type: 'Expedite_Part', authorized_by_mgr_id: '' });

export default function ShopOperations() {
  useDocumentTitle('SteelOS — Shop Operations');
  const navigate = useNavigate();
  const { toast } = useToast();
  const [projects, setProjects] = useState([]);
  const [pieces, setPieces] = useState([]);
  const [stationLogs, setStationLogs] = useState([]);
  const [qaInspections, setQaInspections] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [remnants, setRemnants] = useState([]);
  const [overrides, setOverrides] = useState([]);
  const [settings, setSettings] = useState(null);
  const [timeOffRequests, setTimeOffRequests] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  // Generic "here's what's behind this number" list dialog — reused across
  // the on-leave count, capacity total, bottleneck tiles, and scorecard rows
  // below instead of a bespoke dialog per stat.
  const [listDialog, setListDialog] = useState(null);
  const openListDialog = (title, rows) => setListDialog({ title, rows });

  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [materialLines, setMaterialLines] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [receivingLogs, setReceivingLogs] = useState([]);

  // Module 17 (Barcode & QR Printing) data — reads the same Module 8/9
  // `pieces` / `shipping_manifests` entities as ShopFabrication/YardScanning
  // so the staging queue reflects the exact same tagging state.
  const [manifests, setManifests] = useState([]);
  const [printJobs, setPrintJobs] = useState([]);
  const [pieceProductionLogs, setPieceProductionLogs] = useState([]);

  const [showOverrideForm, setShowOverrideForm] = useState(false);
  const [overrideForm, setOverrideForm] = useState(emptyOverrideForm());
  const [savingOverride, setSavingOverride] = useState(false);
  const [moduleAllowed, setModuleAllowed] = useState(false);
  const [checkingModuleAccess, setCheckingModuleAccess] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [company, setCompany] = useState(null);

  useEffect(() => { loadAll(); }, []);
  useEffect(() => {
    db.auth.me().then((me) => setCurrentUser(me || null)).catch(() => setCurrentUser(null));
    getEffectiveCompany()
      .then((company) => { setModuleAllowed(hasModule(company, '/shop-operations')); setCompany(company); })
      .catch(() => setModuleAllowed(false))
      .finally(() => setCheckingModuleAccess(false));
  }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [projectData, pieceData, logsData, qaData, scheduleData, remnantData, overrideData, settingsRows, poData, receivingData, leaveData, manifestData, printJobData, pieceProductionLogData, employeeData] = await Promise.all([
        db.entities.Project.filter({ is_archived: false }, 'name', 50),
        db.entities.pieces.list('-created_date', 500),
        db.entities.station_logs.list('-created_date', 500),
        db.entities.qa_inspections.list('-created_date', 500),
        db.entities.shop_schedules.list('-created_date', 200),
        db.entities.remnant_inventory.list('-created_date', 200),
        db.entities.manager_overrides.list('-created_date', 200),
        db.entities.SystemSetting.filter({ setting_group: 'production' }, '-created_date', 1),
        db.entities.purchase_orders.list('-created_date', 200),
        db.entities.receiving_logs.list('-created_date', 200),
        db.entities.time_off_requests.filter({ status: 'Approved' }, '-created_date', 200),
        db.entities.shipping_manifests.list('-created_date', 200),
        db.entities.print_label_jobs.list('-created_date', 500),
        db.entities.piece_production_logs.filter({ status: 'Complete' }, '-created_date', 1000),
        db.entities.employees.list('full_name', 500),
      ]);
      setProjects(projectData);
      setPieces(pieceData);
      setStationLogs(logsData);
      setQaInspections(qaData);
      setSchedules(scheduleData);
      setRemnants(remnantData);
      setOverrides(overrideData);
      setPurchaseOrders(poData);
      setReceivingLogs(receivingData);
      setTimeOffRequests(leaveData);
      setManifests(manifestData);
      setPrintJobs(printJobData);
      setPieceProductionLogs(pieceProductionLogData);
      setEmployees(employeeData);
      let settingsRow = settingsRows[0];
      if (!settingsRow) {
        settingsRow = await db.entities.SystemSetting.create({ setting_group: 'production' });
      }
      setSettings(settingsRow);
      if (!selectedProjectId && projectData[0]) setSelectedProjectId(projectData[0].id);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // Scoped refresh for the Label Printing tab — deliberately does not touch
  // `loading`, so printing a label never unmounts the Tabs (which would lose
  // the active tab and any open print preview).
  const refreshPrintJobs = async () => {
    try {
      const rows = await db.entities.print_label_jobs.list('-created_date', 500);
      setPrintJobs(rows);
    } catch (e) {}
  };

  useEffect(() => {
    if (!selectedProjectId) { setMaterialLines([]); return; }
    (async () => {
      try {
        const bids = await db.entities.Bid.filter({ won_project_id: selectedProjectId }, '-created_date', 1);
        if (bids[0]) {
          const lines = await db.entities.MaterialTakeoffLine.filter({ bid_id: bids[0].id }, '-created_date', 200);
          setMaterialLines(lines);
        } else {
          setMaterialLines([]);
        }
      } catch (e) {
        setMaterialLines([]);
      }
    })();
  }, [selectedProjectId]);

  const weekColumns = useMemo(() => buildWeekColumns(8), []);
  const maxCapacity = settings?.max_shop_capacity_tons_weekly || 150;
  const staleHours = settings?.stale_piece_alert_hours || 8;
  const bottleneckThreshold = settings?.station_bottleneck_threshold || 50;
  const dwellThresholdPct = settings?.station_dwell_bottleneck_threshold_pct || 25;

  const capacityMatrix = useMemo(
    () => buildCapacityMatrix(schedules, projects, weekColumns, maxCapacity),
    [schedules, projects, weekColumns, maxCapacity]
  );
  // Non-invasive "N on leave" annotation — approved time_off_requests overlapping
  // each week are counted here for display only; nothing is written into
  // shop_schedules, so the tonnage heatmap math above is never touched by leave.
  const onLeaveCounts = useMemo(
    () => weekColumns.map((week) => timeOffRequests.filter((r) => new Date(r.end_date) >= week.weekStart && new Date(r.start_date) <= week.weekEnd).length),
    [weekColumns, timeOffRequests]
  );
  const employeeName = (id) => employees.find((e) => e.id === id)?.full_name || id;
  const bottlenecks = useMemo(() => getStationBottlenecks(pieces, bottleneckThreshold), [pieces, bottleneckThreshold]);
  const stationSignals = useMemo(
    () => getStationDwellVariance(stationLogs, pieces, pieceProductionLogs, bottlenecks, dwellThresholdPct),
    [stationLogs, pieces, pieceProductionLogs, bottlenecks, dwellThresholdPct]
  );
  const stalePieces = useMemo(() => getStalePieces(stationLogs, staleHours), [stationLogs, staleHours]);
  const scorecards = useMemo(() => getEmployeeScorecards(stationLogs, qaInspections), [stationLogs, qaInspections]);
  const shortages = useMemo(() => getMaterialShortages(materialLines, purchaseOrders, receivingLogs), [materialLines, purchaseOrders, receivingLogs]);

  const updatePriorityWeight = async (schedule, value) => {
    const priority_weight = parseInt(value, 10) || 0;
    const updated = await db.entities.shop_schedules.update(schedule.id, { priority_weight });
    setSchedules((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  const handleCreateOverride = async () => {
    if (!overrideForm.piece_id || !overrideForm.authorized_by_mgr_id.trim()) {
      toast({ title: 'Piece and authorizing manager are required', variant: 'destructive' });
      return;
    }
    setSavingOverride(true);
    try {
      const created = await db.entities.manager_overrides.create({
        ...overrideForm,
        authorized_by_mgr_id: overrideForm.authorized_by_mgr_id.trim(),
        executed_at: new Date().toISOString(),
      });
      setOverrides((prev) => [created, ...prev]);
      setShowOverrideForm(false);
      setOverrideForm(emptyOverrideForm());
      toast({ title: `${created.override_type.replace('_', ' ')} override authorized` });
    } catch (e) {
      toast({ title: 'Unable to create override', variant: 'destructive' });
    } finally {
      setSavingOverride(false);
    }
  };

  const isPlatformOperatorView = isSuperAdmin(currentUser) && !isImpersonating();
  const showModule = moduleAllowed || isPlatformOperatorView;

  if (loading || checkingModuleAccess) return <div className="p-6"><div className="h-96 bg-muted rounded-xl animate-pulse" /></div>;

  // Route guard — a direct URL to /shop-operations can't bypass the nav's
  // module-pack filtering. Shop scheduling and bottleneck management is
  // Fabricator + Enterprise Connect only (see modulePacks.js); an
  // Erector-pack company has no shop floor to schedule, so none of this
  // applies to them.
  if (!showModule) {
    return <ModuleLocked modulePath="/shop-operations" title="Shop Management & Operations Not Included" />;
  }

  return (
    <div className="p-4 md:p-6 space-y-4 animate-fade-in">
      <PageHeader title="Shop Management & Operations" subtitle="Scheduler capacity heatmap, bottleneck radar, and emergency dispatch overrides" />

      <Tabs defaultValue="scheduler">
        <TabsList className="mb-4">
          <TabsTrigger value="scheduler">Scheduler Matrix</TabsTrigger>
          <TabsTrigger value="radar">Bottleneck Radar</TabsTrigger>
          <TabsTrigger value="material">Material &amp; Overrides</TabsTrigger>
          <TabsTrigger value="labels" className="gap-1.5"><Printer className="w-3.5 h-3.5" />Label Printing</TabsTrigger>
        </TabsList>

        <TabsContent value="scheduler" className="space-y-4">
          <div className="steel-card p-4 overflow-x-auto">
            <h4 className="font-semibold text-sm mb-3 flex items-center gap-2"><Gauge className="w-4 h-4 text-primary" />Weekly Capacity Heatmap ({maxCapacity.toLocaleString()} tons/wk max)</h4>
            <table className="w-full text-xs min-w-[700px]">
              <thead>
                <tr>
                  <th className="text-left py-1 px-2">Project</th>
                  {weekColumns.map((w, i) => (
                    <th key={w.label} className="text-center py-1 px-2 font-mono">
                      {w.label}
                      {onLeaveCounts[i] > 0 && (
                        <button
                          type="button"
                          className="block text-[10px] font-sans text-yellow-700 normal-case hover:underline"
                          onClick={() => openListDialog(
                            `On Leave — Week of ${w.label}`,
                            timeOffRequests
                              .filter((r) => new Date(r.end_date) >= w.weekStart && new Date(r.start_date) <= w.weekEnd)
                              .map((r) => ({ label: employeeName(r.employee_id), sublabel: `${r.leave_type} • ${r.start_date} to ${r.end_date}` }))
                          )}
                        >
                          {onLeaveCounts[i]} on leave
                        </button>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {capacityMatrix.rows.map((row) => (
                  <tr key={row.project.id} className="border-t border-border">
                    <td className="py-1.5 px-2 font-medium whitespace-nowrap">{row.project.name}</td>
                    {row.cells.map((tons, i) => (
                      <td key={i} className="text-center py-1.5 px-2 font-mono">{tons > 0 ? tons.toFixed(0) : '—'}</td>
                    ))}
                  </tr>
                ))}
                <tr className="border-t-2 border-border font-semibold">
                  <td className="py-1.5 px-2">Total / Status</td>
                  {capacityMatrix.totals.map((t, i) => (
                    <td key={i} className={`text-center py-1.5 px-2 font-mono rounded ${HEATMAP_COLOR[capacityMatrix.statuses[i]]}`}>
                      <button
                        type="button"
                        className="hover:underline"
                        onClick={() => openListDialog(
                          `Scheduled Tons — Week of ${weekColumns[i].label}`,
                          capacityMatrix.rows
                            .filter((row) => row.cells[i] > 0)
                            .map((row) => ({ label: row.project.name, sublabel: `${row.cells[i].toFixed(1)} tons` }))
                        )}
                      >
                        {t.toFixed(0)}
                      </button>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          <div className="steel-card p-4">
            <h4 className="font-semibold text-sm mb-3">Schedule Priority Weights</h4>
            <p className="text-xs text-muted-foreground mb-3">Changing priority here re-sorts the Pieces list on the shop-floor tablet (ShopFabrication) in real time.</p>
            <div className="space-y-2">
              {schedules.map((s) => {
                const project = projects.find((p) => p.id === s.project_id);
                return (
                  <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-2 text-sm">
                    <div>
                      <p className="font-medium">{project?.name || s.project_id} — Seq #{s.sequence_number}</p>
                      <p className="text-xs text-muted-foreground">{s.scheduled_start_date} → {s.scheduled_end_date} • {s.target_tons} tons</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="text-xs">Priority</Label>
                      <Input type="number" defaultValue={s.priority_weight} onBlur={(e) => updatePriorityWeight(s, e.target.value)} className="w-20 h-8 text-sm" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="radar" className="space-y-4">
          <div className="steel-card p-4">
            <h4 className="font-semibold text-sm mb-3 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-red-600" />Station Bottleneck Alert (queue threshold: {bottleneckThreshold} • dwell threshold: +{dwellThresholdPct}%)</h4>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
              {stationSignals.map((s) => (
                <button
                  type="button"
                  key={s.stationId}
                  onClick={() => openListDialog(
                    `${stationName(s.stationId)} — Pieces at Station`,
                    pieces.filter((p) => p.current_station_id === s.stationId).map((p) => ({ label: p.piece_mark || p.id, sublabel: p.workflow_status || p.field_status || '—' }))
                  )}
                  className={`rounded-lg border p-3 text-center hover:bg-muted/50 transition-colors ${s.isBottleneck ? 'border-red-500 bg-red-500/10 animate-pulse' : 'border-border'}`}
                >
                  <p className="text-xs text-muted-foreground">{stationName(s.stationId)}</p>
                  <p className={`text-xl font-bold ${s.isBottleneck ? 'text-red-600' : ''}`}>{s.count}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {s.avgActualMinutes != null ? `${s.avgActualMinutes.toFixed(0)}m actual` : 'No dwell data'}
                    {s.avgTargetMinutes != null && ` / ${s.avgTargetMinutes.toFixed(0)}m target`}
                  </p>
                  {s.dwellVariancePct != null && (
                    <p className={`text-xs font-semibold ${s.dwellVariancePct > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {s.dwellVariancePct > 0 ? '+' : ''}{s.dwellVariancePct.toFixed(0)}% dwell
                    </p>
                  )}
                  {s.isBottleneck && (
                    <p className="text-[10px] font-semibold text-red-600 uppercase tracking-wide mt-1">{s.signal}</p>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="steel-card p-4">
            <h4 className="font-semibold text-sm mb-3">Stale Piece Monitor (&gt; {staleHours}h)</h4>
            {stalePieces.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No stale punches right now.</p>
            ) : stalePieces.map((log) => {
              const piece = pieces.find((p) => p.id === log.piece_id);
              return (
                <div key={log.id} className="rounded-lg border border-yellow-500/40 bg-yellow-500/5 p-3 text-sm mb-2">
                  <p className="font-medium">{piece?.piece_mark || log.piece_id} — {stationName(log.station_id)}</p>
                  <p className="text-xs text-muted-foreground">{log.status} since {new Date(log.status === 'In_Progress' ? log.start_time : log.end_time).toLocaleString()} • Employee {log.employee_id}</p>
                </div>
              );
            })}
          </div>

          <div className="steel-card p-4">
            <h4 className="font-semibold text-sm mb-3 flex items-center gap-2"><Users className="w-4 h-4 text-primary" />Employee Productivity Scorecards</h4>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground uppercase">
                  <th className="text-left py-2">Employee</th>
                  <th className="text-right py-2">Active Minutes</th>
                  <th className="text-right py-2">Part Throughput</th>
                  <th className="text-right py-2">QA Pass Rate</th>
                </tr>
              </thead>
              <tbody>
                {scorecards.map((sc) => (
                  <tr
                    key={sc.employee_id}
                    onClick={() => openListDialog(
                      `${employeeName(sc.employee_id)} — Station Log`,
                      stationLogs
                        .filter((log) => log.employee_id === sc.employee_id)
                        .map((log) => ({ label: `${stationName(log.station_id)} — ${log.status}`, sublabel: `${log.elapsed_minutes || 0}m • piece ${log.piece_id}` }))
                    )}
                    className="border-b border-border/50 hover:bg-muted/50 cursor-pointer"
                  >
                    <td className="py-2 font-mono">{employeeName(sc.employee_id)}</td>
                    <td className="py-2 text-right">{sc.totalActiveMinutes}</td>
                    <td className="py-2 text-right">{sc.partThroughput}</td>
                    <td className="py-2 text-right">{sc.qaPassRatePct === null ? '—' : `${sc.qaPassRatePct}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="material" className="space-y-4">
          <div className="steel-card p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h4 className="font-semibold text-sm flex items-center gap-2"><PackageX className="w-4 h-4 text-red-600" />Material Shortage Check</h4>
              <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                <SelectTrigger className="w-56"><SelectValue placeholder="Select a project" /></SelectTrigger>
                <SelectContent>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.project_number} — {p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {shortages.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No outstanding material shortages for this project's takeoff.</p>
            ) : shortages.map((line) => (
              <button
                type="button"
                key={line.id}
                onClick={() => line.bid_id && navigate(`/estimating/${line.bid_id}`)}
                disabled={!line.bid_id}
                className="w-full rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm mb-2 text-left hover:bg-red-500/10 transition-colors disabled:cursor-default disabled:hover:bg-red-500/5"
              >
                <p className="font-medium">{(line.material_type || 'Material').replace(/_/g, ' ')} — {line.material_size || line.custom_name}</p>
                <p className="text-xs text-red-600">No matching purchase order marked "Received Complete" on file.</p>
              </button>
            ))}
          </div>

          <div className="steel-card p-4">
            <h4 className="font-semibold text-sm mb-3">Remnant Inventory</h4>
            {remnants.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No remnants logged.</p>
            ) : remnants.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-lg border border-border p-2 text-sm mb-2">
                <div>
                  <p className="font-medium">{r.material_shape} — {r.dimensions}</p>
                  <p className="text-xs text-muted-foreground">Heat {r.heat_number_string} • {r.length_in}in</p>
                </div>
              </div>
            ))}
          </div>

          <div className="steel-card p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-sm flex items-center gap-2"><Zap className="w-4 h-4 text-yellow-600" />Emergency Bypass Overrides</h4>
              <Button size="sm" className="gap-2 steel-gradient text-white border-0" onClick={() => setShowOverrideForm(true)}>
                <Plus className="w-4 h-4" />New Override
              </Button>
            </div>
            {overrides.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No manager overrides authorized.</p>
            ) : overrides.map((o) => {
              const piece = pieces.find((p) => p.id === o.piece_id);
              return (
                <div key={o.id} className="rounded-lg border border-border p-3 text-sm mb-2">
                  <p className="font-medium">{o.override_type.replace('_', ' ')} — {piece?.piece_mark || o.piece_id}</p>
                  <p className="text-xs text-muted-foreground">Authorized by {o.authorized_by_mgr_id} at {new Date(o.executed_at).toLocaleString()}</p>
                </div>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="labels" className="space-y-4">
          <PieceReceivingQueue pieces={pieces} projects={projects} onReload={loadAll} />
          <QrExportQueue pieces={pieces} projects={projects} company={company} onReload={loadAll} />
          <LabelPrintingPanel
            pieces={pieces}
            manifests={manifests}
            printJobs={printJobs}
            onReload={refreshPrintJobs}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={showOverrideForm} onOpenChange={setShowOverrideForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Manager Override</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Piece</Label>
              <Select value={overrideForm.piece_id} onValueChange={(v) => setOverrideForm((f) => ({ ...f, piece_id: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select a piece" /></SelectTrigger>
                <SelectContent>
                  {pieces.map((p) => <SelectItem key={p.id} value={p.id}>{p.piece_mark}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Override Type</Label>
              <Select value={overrideForm.override_type} onValueChange={(v) => setOverrideForm((f) => ({ ...f, override_type: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Expedite_Part">Expedite Part (bypass station/QA locks)</SelectItem>
                  <SelectItem value="Reassign_QA">Reassign QA</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Authorized By (Manager ID)</Label>
              <Input value={overrideForm.authorized_by_mgr_id} onChange={(e) => setOverrideForm((f) => ({ ...f, authorized_by_mgr_id: e.target.value }))} className="mt-1" placeholder="EMP-900" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowOverrideForm(false)}>Cancel</Button>
            <Button onClick={handleCreateOverride} disabled={savingOverride} className="steel-gradient text-white border-0">
              {savingOverride ? 'Authorizing…' : 'Authorize Override'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!listDialog} onOpenChange={(o) => !o && setListDialog(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{listDialog?.title}</DialogTitle></DialogHeader>
          {(listDialog?.rows || []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Nothing on file.</p>
          ) : (
            <div className="space-y-1.5">
              {listDialog.rows.map((r, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg border border-border p-2.5 text-sm">
                  <span className="font-medium">{r.label}</span>
                  <span className="text-xs text-muted-foreground">{r.sublabel}</span>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setListDialog(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
