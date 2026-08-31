import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { db } from '@/api/apiClient';
import { getEffectiveCompany, isSuperAdmin, isImpersonating } from '@/lib/tenantContext';
import { hasModule } from '@/lib/moduleEntitlement';
import { getAllRoles } from '@/components/dashboard/rbacConfig';
import { exportNodeToPdf } from '@/lib/exportNodeToPdf';
import {
  AREAS, CHART_TYPES, AGGREGATION_LEVELS, DATE_RANGE_OPTIONS, KPI_SOURCE_ENTITIES,
  metricsForArea, getMetric, resolveDateRange, computeMetricSeries, pieValueForSeries,
  formatMetricValue,
} from '@/lib/kpiMetrics';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend as RechartsLegend, ResponsiveContainer,
} from 'recharts';
import PageHeader from '@/components/ui/PageHeader';
import ModuleLocked from '@/components/shared/ModuleLocked';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import {
  Printer, Download, Save, FolderOpen, Trash2, Share2, Plus, X, Info,
  Loader2, ChevronUp, ChevronDown, BarChart3,
} from 'lucide-react';

const COLORS = ['#1d7ed8', '#f97316', '#22c55e', '#a855f7', '#ef4444', '#eab308', '#14b8a6'];

function emptyBuilderState() {
  return {
    area: 'safety',
    metricKeys: [],
    chartType: 'line',
    dateRangeType: 'last_month',
    customStart: new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10),
    customEnd: new Date().toISOString().slice(0, 10),
    aggregationLevel: 'weekly',
    comparisonMode: false,
    comparisonPeriods: [],
  };
}

const xAxisLabelFor = (aggregationLevel, isCategory) => {
  if (isCategory) return 'Category';
  if (aggregationLevel === 'monthly') return 'Month';
  if (aggregationLevel === 'weekly') return 'Week';
  return 'Date';
};

// Runs every selected metric over the current period plus any comparison
// periods and index-aligns the results into chart rows / table columns.
// Comparison periods are aligned by relative position (bucket 1 of the
// current period vs. bucket 1 of the comparison period), the same
// week-over-week convention most analytics dashboards use — the two ranges
// don't need to be the same calendar dates, just the same bucket count.
function buildChartModel(config, rawData) {
  const metrics = config.metricKeys.map(getMetric).filter(Boolean);
  if (metrics.length === 0) return null;

  const current = resolveDateRange({ date_range_type: config.dateRangeType, custom_start_date: config.customStart, custom_end_date: config.customEnd });
  const periods = [{ id: 'current', label: 'Current', ...current }];
  if (config.comparisonMode) {
    config.comparisonPeriods.forEach((cp, i) => {
      const s = new Date(`${cp.start}T00:00:00`);
      const e = new Date(`${cp.end}T23:59:59.999`);
      if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime())) {
        periods.push({ id: `cmp${i}`, label: cp.label || `Comparison ${i + 1}`, start: s, end: e });
      }
    });
  }

  const isCategory = metrics[0].shape === 'category';
  const seriesByPeriod = {};
  periods.forEach((p) => {
    seriesByPeriod[p.id] = {};
    metrics.forEach((m) => {
      seriesByPeriod[p.id][m.key] = computeMetricSeries(m, rawData, p.start, p.end, config.aggregationLevel);
    });
  });

  const maxLen = Math.max(1, ...periods.map((p) => Math.max(0, ...metrics.map((m) => seriesByPeriod[p.id][m.key].length))));
  const rows = [];
  for (let i = 0; i < maxLen; i++) {
    const row = { xLabel: seriesByPeriod.current[metrics[0].key][i]?.label || `#${i + 1}` };
    periods.forEach((p) => {
      metrics.forEach((m) => {
        row[`${m.key}__${p.id}`] = seriesByPeriod[p.id][m.key][i]?.value ?? null;
      });
    });
    if (periods.length === 2) {
      metrics.forEach((m) => {
        const a = row[`${m.key}__current`];
        const b = row[`${m.key}__${periods[1].id}`];
        row[`${m.key}__diff`] = (a ?? 0) - (b ?? 0);
      });
    }
    rows.push(row);
  }

  const seriesDefs = [];
  metrics.forEach((m, mi) => {
    periods.forEach((p, pi) => {
      seriesDefs.push({ id: `${m.key}__${p.id}`, metric: m, period: p, color: COLORS[mi % COLORS.length], isCurrent: pi === 0 });
    });
  });

  const pieSlices = isCategory
    ? seriesByPeriod.current[metrics[0].key].map((r, i) => ({ name: r.label, value: r.value, color: COLORS[i % COLORS.length] }))
    : metrics.map((m, mi) => ({ name: m.label, value: pieValueForSeries(m, seriesByPeriod.current[m.key]), color: COLORS[mi % COLORS.length] }));

  const columns = [{ key: 'xLabel', label: xAxisLabelFor(config.aggregationLevel, isCategory) }];
  metrics.forEach((m) => {
    periods.forEach((p) => {
      columns.push({ key: `${m.key}__${p.id}`, label: periods.length > 1 ? `${m.label} (${p.label})` : m.label, unit: m.unit });
    });
    if (periods.length === 2) {
      columns.push({ key: `${m.key}__diff`, label: `${m.label} Difference`, unit: m.unit });
    }
  });

  return { metrics, periods, isCategory, rows, seriesDefs, pieSlices, columns };
}

function defaultComparisonPeriod(config, index) {
  const { start, end } = resolveDateRange({ date_range_type: config.dateRangeType, custom_start_date: config.customStart, custom_end_date: config.customEnd });
  const durationMs = end.getTime() - start.getTime();
  const newEnd = new Date(start.getTime() - 86400000);
  const newStart = new Date(newEnd.getTime() - durationMs);
  return {
    label: index === 0 ? 'Previous Period' : `Comparison ${index + 1}`,
    start: newStart.toISOString().slice(0, 10),
    end: newEnd.toISOString().slice(0, 10),
  };
}

export default function QualityKpiBuilder() {
  useDocumentTitle('SteelOS — KPI Builder');
  const { toast } = useToast();
  const [currentUser, setCurrentUser] = useState(null);
  const [effectiveCompany, setEffectiveCompany] = useState(null);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [isKioskSession, setIsKioskSession] = useState(false);

  const [loadingData, setLoadingData] = useState(true);
  const [rawData, setRawData] = useState(null);

  const [config, setConfig] = useState(emptyBuilderState());
  const [builtConfig, setBuiltConfig] = useState(null);

  const [savedDashboards, setSavedDashboards] = useState([]);
  const [selectedDashboardId, setSelectedDashboardId] = useState('');
  const [loadedDashboard, setLoadedDashboard] = useState(null);
  const [allRoles, setAllRoles] = useState([]);

  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareRoles, setShareRoles] = useState([]);
  const [sharing, setSharing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [metricDefTarget, setMetricDefTarget] = useState(null);
  const [sort, setSort] = useState({ key: null, dir: 1 });

  const exportRef = useRef(null);

  useEffect(() => {
    Promise.all([db.auth.me().catch(() => null), getEffectiveCompany().catch(() => null)])
      .then(([user, company]) => {
        setCurrentUser(user);
        setEffectiveCompany(company);
        setIsKioskSession(!!user?.is_kiosk_pin_session);
      })
      .finally(() => setCheckingAccess(false));
    getAllRoles().then(setAllRoles).catch(() => setAllRoles([]));
  }, []);

  useEffect(() => {
    setLoadingData(true);
    Promise.all(KPI_SOURCE_ENTITIES.map((name) => db.entities[name].list('-created_date', 5000).catch(() => [])))
      .then((results) => {
        const data = {};
        KPI_SOURCE_ENTITIES.forEach((name, i) => { data[name] = results[i]; });
        setRawData(data);
      })
      .finally(() => setLoadingData(false));
    loadSavedDashboards();
  }, []);

  const loadSavedDashboards = async () => {
    try {
      const rows = await db.entities.saved_kpi_dashboards.list('-created_date', 500);
      setSavedDashboards(rows);
    } catch (e) {
      setSavedDashboards([]);
    }
  };

  const userRoles = (currentUser?.roles || ['user']).map((r) => String(r).toLowerCase());
  const isAdmin = userRoles.includes('admin');
  const visibleDashboards = savedDashboards.filter((d) =>
    d.created_by === currentUser?.id || isAdmin || (d.is_shared && (d.shared_with_roles || []).some((r) => userRoles.includes(String(r).toLowerCase())))
  );

  const areaMetrics = metricsForArea(config.area);
  const hasCategoryMetricSelected = config.metricKeys.some((k) => getMetric(k)?.shape === 'category');

  const toggleMetric = (key, checked) => {
    const metric = getMetric(key);
    setConfig((c) => {
      if (!checked) return { ...c, metricKeys: c.metricKeys.filter((k) => k !== key) };
      // Category-shaped metrics (breakdowns) group by category, not by date —
      // mixing them with time-series metrics in one chart isn't meaningful,
      // so selecting one clears everything else and vice versa.
      if (metric?.shape === 'category') return { ...c, metricKeys: [key] };
      return { ...c, metricKeys: [...c.metricKeys.filter((k) => getMetric(k)?.shape !== 'category'), key] };
    });
  };

  const handleAreaChange = (area) => setConfig((c) => ({ ...c, area, metricKeys: [] }));

  const addComparisonPeriod = () => {
    setConfig((c) => {
      if (c.comparisonPeriods.length >= 3) return c;
      return { ...c, comparisonPeriods: [...c.comparisonPeriods, defaultComparisonPeriod(c, c.comparisonPeriods.length)] };
    });
  };
  const updateComparisonPeriod = (index, patch) => {
    setConfig((c) => ({ ...c, comparisonPeriods: c.comparisonPeriods.map((cp, i) => (i === index ? { ...cp, ...patch } : cp)) }));
  };
  const removeComparisonPeriod = (index) => {
    setConfig((c) => ({ ...c, comparisonPeriods: c.comparisonPeriods.filter((_, i) => i !== index) }));
  };

  const handleBuildChart = () => {
    if (config.metricKeys.length === 0) {
      toast({ title: 'Select at least one metric first', variant: 'destructive' });
      return;
    }
    if (config.dateRangeType === 'custom' && config.customStart > config.customEnd) {
      toast({ title: 'Custom start date must be on or before the end date', variant: 'destructive' });
      return;
    }
    setBuiltConfig({ ...config, comparisonPeriods: config.comparisonMode ? config.comparisonPeriods : [] });
  };

  const chartModel = useMemo(() => {
    if (!builtConfig || !rawData) return null;
    return buildChartModel(builtConfig, rawData);
  }, [builtConfig, rawData]);

  const sortedRows = useMemo(() => {
    if (!chartModel) return [];
    if (!sort.key) return chartModel.rows;
    return [...chartModel.rows].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sort.dir;
      return String(av).localeCompare(String(bv)) * sort.dir;
    });
  }, [chartModel, sort]);

  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));

  const handleSaveDashboard = async () => {
    if (!saveName.trim()) {
      toast({ title: 'Dashboard name is required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const created = await db.entities.saved_kpi_dashboards.create({
        dashboard_name: saveName.trim(),
        area: config.area,
        selected_metrics: config.metricKeys,
        chart_types: [config.chartType],
        date_range_type: config.dateRangeType,
        custom_start_date: config.customStart,
        custom_end_date: config.customEnd,
        comparison_periods: config.comparisonMode ? config.comparisonPeriods : [],
        aggregation_level: config.aggregationLevel,
        created_by: currentUser?.id || '',
        is_shared: false,
        shared_with_roles: [],
        last_accessed: new Date().toISOString(),
      });
      await loadSavedDashboards();
      setLoadedDashboard(created);
      setSelectedDashboardId(created.id);
      setShowSaveModal(false);
      setSaveName('');
      toast({ title: 'Dashboard saved' });
    } catch (e) {
      toast({ title: 'Unable to save dashboard', description: e?.message || undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleLoadDashboard = async () => {
    const dash = visibleDashboards.find((d) => d.id === selectedDashboardId);
    if (!dash) return;
    setConfig({
      area: dash.area,
      metricKeys: dash.selected_metrics || [],
      chartType: (dash.chart_types || ['line'])[0] || 'line',
      dateRangeType: dash.date_range_type || 'last_month',
      customStart: dash.custom_start_date || emptyBuilderState().customStart,
      customEnd: dash.custom_end_date || emptyBuilderState().customEnd,
      aggregationLevel: dash.aggregation_level || 'weekly',
      comparisonMode: (dash.comparison_periods || []).length > 0,
      comparisonPeriods: dash.comparison_periods || [],
    });
    setBuiltConfig({
      area: dash.area,
      metricKeys: dash.selected_metrics || [],
      chartType: (dash.chart_types || ['line'])[0] || 'line',
      dateRangeType: dash.date_range_type || 'last_month',
      customStart: dash.custom_start_date || emptyBuilderState().customStart,
      customEnd: dash.custom_end_date || emptyBuilderState().customEnd,
      aggregationLevel: dash.aggregation_level || 'weekly',
      comparisonPeriods: dash.comparison_periods || [],
    });
    setLoadedDashboard(dash);
    try {
      await db.entities.saved_kpi_dashboards.update(dash.id, { last_accessed: new Date().toISOString() });
    } catch (e) {}
    toast({ title: `Loaded "${dash.dashboard_name}"` });
  };

  const canManage = (dash) => !!dash && (dash.created_by === currentUser?.id || isAdmin);

  const handleDeleteDashboard = async () => {
    if (!loadedDashboard) return;
    setDeleting(true);
    try {
      await db.entities.saved_kpi_dashboards.delete(loadedDashboard.id);
      await loadSavedDashboards();
      setLoadedDashboard(null);
      setSelectedDashboardId('');
      setShowDeleteConfirm(false);
      toast({ title: 'Dashboard deleted' });
    } catch (e) {
      toast({ title: 'Unable to delete dashboard', description: e?.message || undefined, variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  const openShareModal = () => {
    setShareRoles(loadedDashboard?.shared_with_roles || []);
    setShowShareModal(true);
  };

  const handleShareSave = async () => {
    if (!loadedDashboard) return;
    setSharing(true);
    try {
      const updated = await db.entities.saved_kpi_dashboards.update(loadedDashboard.id, {
        is_shared: shareRoles.length > 0,
        shared_with_roles: shareRoles,
      });
      setLoadedDashboard(updated);
      await loadSavedDashboards();
      setShowShareModal(false);
      toast({ title: shareRoles.length > 0 ? 'Dashboard shared' : 'Dashboard sharing turned off' });
    } catch (e) {
      toast({ title: 'Unable to update sharing', description: e?.message || undefined, variant: 'destructive' });
    } finally {
      setSharing(false);
    }
  };

  const handlePrint = () => window.print();

  const handleExportPdf = async () => {
    if (!exportRef.current) return;
    const dateStr = new Date().toISOString().slice(0, 10);
    const name = (loadedDashboard?.dashboard_name || `${config.area}_kpi`).replace(/[^a-z0-9_-]+/gi, '_');
    await exportNodeToPdf(exportRef.current, `${name}_${dateStr}.pdf`);
  };

  if (checkingAccess) {
    return <div className="p-4 md:p-6"><div className="h-96 bg-muted rounded-xl animate-pulse" /></div>;
  }

  if (isKioskSession) {
    return (
      <div className="p-6">
        <div className="steel-card p-8 text-center text-muted-foreground">
          The KPI Builder isn't available from an Employee Center session.
        </div>
      </div>
    );
  }

  const isPlatformOperatorView = isSuperAdmin(currentUser) && !isImpersonating();
  const allowed = isPlatformOperatorView || hasModule(effectiveCompany, '/quality/kpi-builder');
  if (!allowed) {
    return <ModuleLocked modulePath="/quality/kpi-builder" title="KPI Builder Not Included" />;
  }

  const dateRangeResolved = resolveDateRange({ date_range_type: config.dateRangeType, custom_start_date: config.customStart, custom_end_date: config.customEnd });

  return (
    <div className="p-4 md:p-6 animate-fade-in">
      <PageHeader
        title="KPI Builder"
        subtitle="Build, save, and share custom Safety, Quality, Production, Equipment, and Shipping dashboards"
        actions={(
          <div className="flex items-center gap-2 print:hidden">
            <Select value={selectedDashboardId} onValueChange={setSelectedDashboardId}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Load a saved dashboard…" /></SelectTrigger>
              <SelectContent>
                {visibleDashboards.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No saved dashboards yet</div>}
                {visibleDashboards.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.dashboard_name}{d.is_shared ? ' (shared)' : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="gap-1.5" disabled={!selectedDashboardId} onClick={handleLoadDashboard}>
              <FolderOpen className="w-3.5 h-3.5" />Load Dashboard
            </Button>
          </div>
        )}
      />

      {loadedDashboard && (
        <div className="steel-card p-3 mb-4 flex items-center justify-between gap-3 flex-wrap print:hidden">
          <button className="text-sm font-medium text-primary hover:underline text-left" onClick={handleLoadDashboard} title="Reload this dashboard's saved configuration">
            {loadedDashboard.dashboard_name}
          </button>
          <div className="flex items-center gap-2">
            {canManage(loadedDashboard) && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={openShareModal}><Share2 className="w-3.5 h-3.5" />Share</Button>
            )}
            {canManage(loadedDashboard) && (
              <Button variant="outline" size="sm" className="gap-1.5 text-red-500 hover:text-red-500" onClick={() => setShowDeleteConfirm(true)}><Trash2 className="w-3.5 h-3.5" />Delete</Button>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
        {/* Sidebar */}
        <div className="lg:sticky lg:top-4 lg:self-start space-y-4 print:hidden">
          <div className="steel-card p-4 space-y-4">
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Area</Label>
              <RadioGroup value={config.area} onValueChange={handleAreaChange} className="mt-2">
                {AREAS.map((a) => (
                  <div key={a.value} className="flex items-center gap-2">
                    <RadioGroupItem value={a.value} id={`area-${a.value}`} />
                    <Label htmlFor={`area-${a.value}`} className="font-normal cursor-pointer">{a.label}</Label>
                  </div>
                ))}
              </RadioGroup>
            </div>

            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Metrics</Label>
              {hasCategoryMetricSelected && (
                <p className="text-xs text-muted-foreground mt-1 mb-1">Groups by category, not date — can't combine with other metrics.</p>
              )}
              <div className="mt-2 space-y-2">
                {areaMetrics.map((m) => (
                  <div key={m.key} className="flex items-start gap-2">
                    <Checkbox
                      id={`metric-${m.key}`}
                      checked={config.metricKeys.includes(m.key)}
                      onCheckedChange={(v) => toggleMetric(m.key, !!v)}
                      className="mt-0.5"
                    />
                    <button type="button" className="text-sm text-left hover:underline flex items-center gap-1" onClick={() => setMetricDefTarget(m)}>
                      {m.label}
                      {m.stub && <Info className="w-3 h-3 text-amber-500 flex-shrink-0" />}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Chart Type</Label>
              <RadioGroup value={config.chartType} onValueChange={(v) => setConfig((c) => ({ ...c, chartType: v }))} className="mt-2">
                {CHART_TYPES.map((t) => (
                  <div key={t.value} className="flex items-center gap-2">
                    <RadioGroupItem value={t.value} id={`chart-${t.value}`} />
                    <Label htmlFor={`chart-${t.value}`} className="font-normal cursor-pointer">{t.label}</Label>
                  </div>
                ))}
              </RadioGroup>
            </div>

            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Date Range</Label>
              <Select value={config.dateRangeType} onValueChange={(v) => setConfig((c) => ({ ...c, dateRangeType: v }))}>
                <SelectTrigger className="mt-2"><SelectValue /></SelectTrigger>
                <SelectContent>{DATE_RANGE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
              {config.dateRangeType === 'custom' && (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div>
                    <Label className="text-xs text-muted-foreground">From</Label>
                    <Input type="date" value={config.customStart} onChange={(e) => setConfig((c) => ({ ...c, customStart: e.target.value }))} className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">To</Label>
                    <Input type="date" value={config.customEnd} onChange={(e) => setConfig((c) => ({ ...c, customEnd: e.target.value }))} className="mt-1" />
                  </div>
                </div>
              )}
              <div className="mt-3">
                <Label className="text-xs text-muted-foreground">Aggregation Level</Label>
                <Select value={config.aggregationLevel} onValueChange={(v) => setConfig((c) => ({ ...c, aggregationLevel: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{AGGREGATION_LEVELS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            <div className="rounded-lg border border-border p-3 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Comparison Mode</Label>
                <Switch checked={config.comparisonMode} onCheckedChange={(v) => setConfig((c) => ({ ...c, comparisonMode: v }))} />
              </div>
              {config.comparisonMode && (
                <div className="space-y-3">
                  {config.comparisonPeriods.map((cp, i) => (
                    <div key={i} className="rounded-md border border-border p-2 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <Input value={cp.label} onChange={(e) => updateComparisonPeriod(i, { label: e.target.value })} placeholder="Label (e.g. Previous Week)" className="h-7 text-xs" />
                        <button type="button" onClick={() => removeComparisonPeriod(i)} className="text-muted-foreground hover:text-red-500 flex-shrink-0"><X className="w-3.5 h-3.5" /></button>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <Input type="date" value={cp.start} onChange={(e) => updateComparisonPeriod(i, { start: e.target.value })} className="h-7 text-xs" />
                        <Input type="date" value={cp.end} onChange={(e) => updateComparisonPeriod(i, { end: e.target.value })} className="h-7 text-xs" />
                      </div>
                    </div>
                  ))}
                  {config.comparisonPeriods.length < 3 && (
                    <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={addComparisonPeriod}>
                      <Plus className="w-3.5 h-3.5" />Add Comparison Period
                    </Button>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <Button onClick={handleBuildChart} className="steel-gradient text-white border-0 gap-2">
                <BarChart3 className="w-4 h-4" />Build Chart
              </Button>
              <Button variant="outline" onClick={() => setShowSaveModal(true)} className="gap-2">
                <Save className="w-4 h-4" />Save Dashboard
              </Button>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="min-w-0">
          <div className="flex justify-end gap-2 mb-3 print:hidden">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handlePrint} disabled={!chartModel}><Printer className="w-3.5 h-3.5" />Print</Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExportPdf} disabled={!chartModel}><Download className="w-3.5 h-3.5" />Export to PDF</Button>
          </div>

          <div ref={exportRef}>
            <div className="mb-3">
              <h2 className="text-lg font-semibold">{loadedDashboard?.dashboard_name || `${AREAS.find((a) => a.value === config.area)?.label} KPIs`}</h2>
              <p className="text-xs text-muted-foreground">
                {dateRangeResolved.start.toLocaleDateString()} – {dateRangeResolved.end.toLocaleDateString()} · {effectiveCompany?.name || 'Company'} · Generated {new Date().toLocaleDateString()} by {currentUser?.full_name || currentUser?.email || 'Unknown'}
              </p>
            </div>

            {loadingData ? (
              <div className="steel-card p-5"><div className="h-64 bg-muted rounded-lg animate-pulse" /></div>
            ) : !chartModel ? (
              <div className="steel-card p-10 text-center text-muted-foreground">
                Choose an area, at least one metric, and click Build Chart.
              </div>
            ) : (
              <>
                <div className="steel-card p-5 mb-4">
                  <ResponsiveContainer width="100%" height={340}>
                    {builtConfig.chartType === 'pie' ? (
                      <PieChart>
                        <Pie data={chartModel.pieSlices} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={110} label={({ name, value }) => `${name}: ${formatMetricValue(chartModel.metrics[0]?.unit, value)}`} labelLine={false}>
                          {chartModel.pieSlices.map((s, i) => <Cell key={i} fill={s.color} />)}
                        </Pie>
                        <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }} />
                        <RechartsLegend />
                      </PieChart>
                    ) : builtConfig.chartType === 'bar' ? (
                      <BarChart data={chartModel.rows}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="xLabel" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }} />
                        <RechartsLegend />
                        {chartModel.seriesDefs.map((s) => (
                          <Bar key={s.id} dataKey={s.id} name={`${s.metric.label}${chartModel.periods.length > 1 ? ` (${s.period.label})` : ''}`} fill={s.color} fillOpacity={s.isCurrent ? 1 : 0.45} radius={[3, 3, 0, 0]} />
                        ))}
                      </BarChart>
                    ) : builtConfig.chartType === 'area' ? (
                      <AreaChart data={chartModel.rows}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="xLabel" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }} />
                        <RechartsLegend />
                        {chartModel.seriesDefs.map((s) => (
                          <Area key={s.id} type="monotone" dataKey={s.id} name={`${s.metric.label}${chartModel.periods.length > 1 ? ` (${s.period.label})` : ''}`} stackId={s.metric.key} stroke={s.color} fill={s.color} fillOpacity={s.isCurrent ? 0.6 : 0.25} />
                        ))}
                      </AreaChart>
                    ) : (
                      <LineChart data={chartModel.rows}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="xLabel" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }} />
                        <RechartsLegend />
                        {chartModel.seriesDefs.map((s) => (
                          <Line key={s.id} type="monotone" dataKey={s.id} name={`${s.metric.label}${chartModel.periods.length > 1 ? ` (${s.period.label})` : ''}`} stroke={s.color} strokeWidth={2} strokeDasharray={s.isCurrent ? undefined : '5 4'} strokeOpacity={s.isCurrent ? 1 : 0.6} dot={false} />
                        ))}
                      </LineChart>
                    )}
                  </ResponsiveContainer>
                </div>

                <div className="steel-card p-5 mb-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                        {chartModel.columns.map((col) => (
                          <th key={col.key} className="text-left py-2.5 px-3 cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort(col.key)}>
                            <span className="inline-flex items-center gap-1">
                              {col.label}
                              {sort.key === col.key && (sort.dir === 1 ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRows.map((row, i) => (
                        <tr key={i} className="border-b border-border/50 hover:bg-muted/50">
                          {chartModel.columns.map((col) => (
                            <td key={col.key} className="py-2 px-3 whitespace-nowrap">
                              {col.key === 'xLabel' ? row.xLabel : formatMetricValue(col.unit, row[col.key] ?? 0)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="steel-card p-5">
                  <h3 className="font-semibold mb-3 text-sm">Legend & Metric Definitions</h3>
                  <div className="space-y-2">
                    {chartModel.metrics.map((m, i) => (
                      <div key={m.key} className="flex items-start gap-2">
                        <span className="w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                        <div>
                          <button type="button" className="text-sm font-medium hover:underline text-left" onClick={() => setMetricDefTarget(m)}>{m.label}</button>
                          <p className="text-xs text-muted-foreground">{m.definition}</p>
                        </div>
                      </div>
                    ))}
                    {chartModel.periods.length > 1 && (
                      <p className="text-xs text-muted-foreground pt-1">Solid lines/bars = current period. Dashed/lighter = comparison periods, aligned by relative position within each period.</p>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Metric definition dialog */}
      <Dialog open={!!metricDefTarget} onOpenChange={(o) => !o && setMetricDefTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{metricDefTarget?.label}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{metricDefTarget?.definition}</p>
        </DialogContent>
      </Dialog>

      {/* Save dashboard dialog */}
      <Dialog open={showSaveModal} onOpenChange={setShowSaveModal}>
        <DialogContent>
          <DialogHeader><DialogTitle>Save Dashboard</DialogTitle></DialogHeader>
          <div>
            <Label>Dashboard Name <span className="text-red-500">*</span></Label>
            <Input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="e.g. Production Tonnage Week-over-Week" className="mt-1" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveModal(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSaveDashboard} disabled={saving} className="steel-gradient text-white border-0 gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Share dashboard dialog */}
      <Dialog open={showShareModal} onOpenChange={setShowShareModal}>
        <DialogContent>
          <DialogHeader><DialogTitle>Share "{loadedDashboard?.dashboard_name}"</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">Select which roles can view this dashboard. Clear all roles to make it private again.</p>
          <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
            {allRoles.map((r) => (
              <div key={r.value} className="flex items-center gap-2">
                <Checkbox
                  id={`share-role-${r.value}`}
                  checked={shareRoles.includes(r.value)}
                  onCheckedChange={(v) => setShareRoles((prev) => (v ? [...prev, r.value] : prev.filter((x) => x !== r.value)))}
                />
                <Label htmlFor={`share-role-${r.value}`} className="font-normal cursor-pointer text-sm">{r.label}</Label>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowShareModal(false)} disabled={sharing}>Cancel</Button>
            <Button onClick={handleShareSave} disabled={sharing} className="steel-gradient text-white border-0 gap-2">
              {sharing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{sharing ? 'Saving…' : 'Save Sharing'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete "{loadedDashboard?.dashboard_name}"?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">This can't be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>Cancel</Button>
            <Button onClick={handleDeleteDashboard} disabled={deleting} className="bg-red-600 hover:bg-red-700 text-white gap-2">
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}{deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
