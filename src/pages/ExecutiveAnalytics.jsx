import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useNavigate } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { useAuth } from '@/lib/AuthContext';
import { getEffectiveCompany } from '@/lib/tenantContext';
import { hasModule } from '@/lib/moduleEntitlement';
import { computeWinLossStats, computeProjectWipRadar, computeQuarterlyTaxExposure } from '@/lib/financialAnalytics';
import { calculateWIPSchedule } from '@/lib/wipCalculations';
import { computeArAging, computeApAging, AGING_BUCKETS, AGING_BUCKET_LABELS } from '@/lib/agingReport';
import { loadAllPayments } from '@/lib/paymentEngine';
import { loadAllMemos } from '@/lib/memoEngine';
import { computeGeometryBreakdown, computeBidVolumeStats } from '@/lib/estimatingAnalytics';
import { buildWeekColumns, buildCapacityMatrix, getStationBottlenecks, getStationDwellVariance } from '@/lib/shopOpsMetrics';
import { bucketPipeline } from '@/lib/salesDashboardData';
import { getSalesmanCommissionSummary } from '@/lib/commissionEngine';
import { hasSalesmanRateAccess } from '@/lib/commissionAccess';
import { exportNodeToPdf } from '@/lib/exportNodeToPdf';
import CashForecastPanel from '@/components/accounting/CashForecastPanel';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell,
} from 'recharts';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/use-toast';
import {
  Save, Gauge, TrendingUp, Landmark, Loader2, Download, ExternalLink, Scale, Wallet,
  Factory, Users, HandCoins, Percent, Boxes,
} from 'lucide-react';

const fmtMoney = (n) => `$${Math.round(n || 0).toLocaleString()}`;
const fmtPct = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : `${Math.round(n)}%`);

function WipYAxisTick({ x, y, payload, maxChars }) {
  const label = payload?.value || '';
  const display = label.length > maxChars ? `${label.slice(0, Math.max(1, maxChars - 1))}…` : label;
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fontSize={12} fill="#6b7280">
      <title>{label}</title>
      {display}
    </text>
  );
}

const REASON_LABELS = {
  price: 'Price — Too High', competitor: 'Competitor Selected', schedule: 'Schedule — Too Long',
  capacity: 'Capacity — No Shop Availability', scope_clarity: 'Scope Clarity', relationship: 'Relationship / Preference',
  other: 'Other', not_enough_time_to_bid: 'Not Enough Time to Bid', not_enough_time_in_shop: 'Not Enough Time in Shop',
  not_in_scope: 'Not In Scope', cannot_meet_requirements: "Can't Meet Requirements",
};

// One header row shared by every section card: a title/subtitle, an optional
// "View Detail" link to the page this rollup was computed from, and a
// per-card PDF export — per the standing rule that every metric on this page
// must click through to its source, and every card exports independently
// rather than sharing one whole-page export.
function SectionHeader({ icon: Icon, title, subtitle, onExport, detailPath, detailLabel = 'View Detail', navigate }) {
  return (
    <div className="flex items-start justify-between flex-wrap gap-3 mb-1">
      <div>
        <h3 className="font-semibold mb-1 flex items-center gap-2"><Icon className="w-4 h-4 text-primary" />{title}</h3>
        {subtitle && <p className="text-xs text-muted-foreground max-w-2xl">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {detailPath && (
          <Button size="sm" variant="outline" onClick={() => navigate(detailPath)} className="gap-1.5">
            <ExternalLink className="w-3.5 h-3.5" />{detailLabel}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onExport} className="gap-1.5">
          <Download className="w-3.5 h-3.5" />Export to PDF
        </Button>
      </div>
    </div>
  );
}

export default function ExecutiveAnalytics() {
  useDocumentTitle('SteelOS — Executive Analytics');
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [projects, setProjects] = useState([]);
  const [ledgerEntries, setLedgerEntries] = useState([]);
  const [bids, setBids] = useState([]);
  const [taxRows, setTaxRows] = useState([]);
  const [sovLines, setSovLines] = useState([]);
  const [jobCostSummaryRows, setJobCostSummaryRows] = useState([]);
  const [invoiceReceivables, setInvoiceReceivables] = useState([]);
  const [payments, setPayments] = useState([]);
  const [memos, setMemos] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [vendorBills, setVendorBills] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [shopSchedules, setShopSchedules] = useState([]);
  const [productionSettings, setProductionSettings] = useState(null);
  const [pieces, setPieces] = useState([]);
  const [stationLogs, setStationLogs] = useState([]);
  const [pieceProductionLogs, setPieceProductionLogs] = useState([]);
  const [commissionBySalesman, setCommissionBySalesman] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const [company, setCompany] = useState(null);
  // Gate on the '/accounting' module, never on a pack-name comparison — see
  // the architectural rule in modulePacks.js. Shop Fab is the only pack that
  // excludes '/accounting', so this naturally hides the accounting-sourced
  // sections (WIP Radar, WIP Overbilling/Underbilling, AR/AP Aging, Cash
  // Position) there without this page needing to know pack names at all.
  const showAccountingSections = hasModule(company, '/accounting');

  const wipRadarRef = useRef(null);
  const wipSummaryRef = useRef(null);
  const agingRef = useRef(null);
  const cashRef = useRef(null);
  const winLossRef = useRef(null);
  const estimatingRef = useRef(null);
  const shopRef = useRef(null);
  const hrRef = useRef(null);
  const salesRef = useRef(null);
  const taxRef = useRef(null);

  useEffect(() => {
    loadAll();
    getEffectiveCompany().then(setCompany).catch(() => setCompany(null));
  }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [
        projectData, ledgerData, bidData,
        sovData, jobCostSummaryData, invoiceReceivableData,
        paymentData, memoData, customerData, vendorData, vendorBillData,
        employeeData, scheduleData, settingsRows, pieceData, stationLogData, pieceProductionLogData,
      ] = await Promise.all([
        db.entities.Project.filter({ is_archived: false }, 'name', 100),
        db.entities.JobCostLedgerEntry.list('-created_date', 500),
        db.entities.Bid.filter({ is_archived: false }, '-created_date', 500),
        db.entities.SovLine.list('-created_date', 2000),
        db.entities.ProjectJobCostSummary.list('-created_date', 2000),
        db.entities.InvoiceReceivable.list('-created_date', 2000),
        loadAllPayments(),
        loadAllMemos(),
        db.entities.Customer.list('name', 500),
        db.entities.Vendor.list('-created_date', 500),
        db.entities.VendorBill.list('-created_date', 500),
        db.entities.employees.filter({ is_active: true }, 'full_name', 1000),
        db.entities.shop_schedules.list('-created_date', 200),
        db.entities.SystemSetting.filter({ setting_group: 'production' }, '-created_date', 1),
        db.entities.pieces.list('-created_date', 500),
        db.entities.station_logs.list('-created_date', 500),
        db.entities.piece_production_logs.filter({ status: 'Complete' }, '-created_date', 1000),
      ]);
      setProjects(projectData);
      setLedgerEntries(ledgerData);
      setBids(bidData);
      setSovLines(sovData);
      setJobCostSummaryRows(jobCostSummaryData.filter((r) => !r.is_deleted));
      setInvoiceReceivables(invoiceReceivableData);
      setPayments(paymentData);
      setMemos(memoData);
      setCustomers(customerData);
      setVendors(vendorData);
      setVendorBills(vendorBillData);
      setEmployees(employeeData);
      setShopSchedules(scheduleData);
      setProductionSettings(settingsRows[0] || null);
      setPieces(pieceData);
      setStationLogs(stationLogData);
      setPieceProductionLogs(pieceProductionLogData);
      setTaxRows(await computeQuarterlyTaxExposure(bidData));

      // Company-wide commission rollup — reuses getSalesmanCommissionSummary
      // per salesman (the same function the Salesman Dashboard widget calls)
      // rather than re-deriving the earned/pending/paid math here.
      const salesmanIds = [...new Set([
        ...bidData.map((b) => b.salesman_id).filter(Boolean),
        ...projectData.map((p) => p.salesman_id).filter(Boolean),
      ])];
      const summaries = await Promise.all(salesmanIds.map((id) => getSalesmanCommissionSummary(id)));
      setCommissionBySalesman(summaries);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const wipRadar = useMemo(() => computeProjectWipRadar(projects, ledgerEntries), [projects, ledgerEntries]);
  const winLoss = useMemo(() => computeWinLossStats(bids), [bids]);

  const { wipLabelWidth, wipMaxChars } = useMemo(() => {
    const longest = wipRadar.reduce((max, p) => Math.max(max, (p.projectName || '').length), 0);
    const width = Math.min(220, Math.max(120, longest * 6.5 + 16));
    return { wipLabelWidth: width, wipMaxChars: Math.max(6, Math.floor((width - 16) / 6.5)) };
  }, [wipRadar]);

  const winLossChartData = [
    { name: 'Won', count: winLoss.won, fill: '#16a34a' },
    { name: 'Lost', count: winLoss.lost, fill: '#dc2626' },
    { name: 'Did Not Bid', count: winLoss.dnb, fill: '#f59e0b' },
    { name: 'Active Pipeline', count: winLoss.active, fill: '#2563eb' },
  ];

  // Company-wide WIP overbilling/underbilling — runs calculateWIPSchedule
  // (the exact per-project WIP formula Accounting.jsx uses for its single
  // selected project) across every active project instead of reimplementing
  // the over/underbilling math here.
  const wipSummary = useMemo(() => {
    const byProject = (rows) => {
      const map = new Map();
      (rows || []).forEach((r) => {
        const list = map.get(r.project_id) || [];
        list.push(r);
        map.set(r.project_id, list);
      });
      return map;
    };
    const sovByProject = byProject(sovLines);
    const ledgerByProject = byProject(ledgerEntries);
    const jobCostByProject = byProject(jobCostSummaryRows);
    const invoicesByProject = byProject(invoiceReceivables);

    const rows = projects.map((project) => ({
      project,
      wip: calculateWIPSchedule(
        project,
        sovByProject.get(project.id) || [],
        ledgerByProject.get(project.id) || [],
        jobCostByProject.get(project.id) || [],
        invoicesByProject.get(project.id) || [],
      ),
    }));

    const overbilled = rows.filter((r) => r.wip.billingStatus === 'overbilled');
    const underbilled = rows.filter((r) => r.wip.billingStatus === 'underbilled');
    return {
      totalOverbilled: overbilled.reduce((s, r) => s + r.wip.overUnderBilling, 0),
      totalUnderbilled: underbilled.reduce((s, r) => s - r.wip.overUnderBilling, 0),
      topOverbilled: [...overbilled].sort((a, b) => b.wip.overUnderBilling - a.wip.overUnderBilling).slice(0, 5),
      topUnderbilled: [...underbilled].sort((a, b) => a.wip.overUnderBilling - b.wip.overUnderBilling).slice(0, 5),
    };
  }, [projects, sovLines, ledgerEntries, jobCostSummaryRows, invoiceReceivables]);

  // AR/AP aging — reuses computeArAging/computeApAging verbatim (same
  // functions Accounting.jsx's AR Aging/AP Aging tabs call), just rolled up
  // into bucket totals instead of the per-customer/per-vendor breakdown.
  const arAging = useMemo(() => computeArAging({ invoices: invoiceReceivables, payments, memos, projects, customers }), [invoiceReceivables, payments, memos, projects, customers]);
  const apAging = useMemo(() => computeApAging({ vendorBills, payments, memos, vendors }), [vendorBills, payments, memos, vendors]);
  const sumBuckets = (rows) => AGING_BUCKETS.reduce((acc, b) => ({ ...acc, [b]: rows.reduce((s, r) => s + r.buckets[b], 0) }), {});
  const arAgingTotals = useMemo(() => sumBuckets(arAging), [arAging]);
  const apAgingTotals = useMemo(() => sumBuckets(apAging), [apAging]);
  const arTotalOutstanding = arAging.reduce((s, r) => s + r.total, 0);
  const apTotalOutstanding = apAging.reduce((s, r) => s + r.total, 0);
  const arPastDuePct = arTotalOutstanding > 0 ? ((arTotalOutstanding - arAgingTotals.current) / arTotalOutstanding) * 100 : 0;

  // Estimating rollup — win rate reuses computeWinLossStats above; bid
  // volume/avg size and the geometry breakdown reuse estimatingAnalytics.js,
  // the same shared module EstimatingAnalytics.jsx's post-mortem charts use.
  const bidVolumeStats = useMemo(() => computeBidVolumeStats(bids), [bids]);
  const geometryBreakdown = useMemo(() => computeGeometryBreakdown(bids), [bids]);

  // Shop capacity/utilization — reuses buildWeekColumns/buildCapacityMatrix
  // (same functions ShopOperations.jsx's Bottleneck Radar tab uses), scoped
  // to just the current week for an executive glance.
  const weekColumns = useMemo(() => buildWeekColumns(1), []);
  const maxShopCapacity = productionSettings?.max_shop_capacity_tons_weekly || 150;
  const capacityMatrix = useMemo(() => buildCapacityMatrix(shopSchedules, projects, weekColumns, maxShopCapacity), [shopSchedules, projects, weekColumns, maxShopCapacity]);
  const currentWeekTons = capacityMatrix.totals[0] || 0;
  const currentWeekStatus = capacityMatrix.statuses[0] || 'Green';
  const currentWeekUtilizationPct = maxShopCapacity > 0 ? (currentWeekTons / maxShopCapacity) * 100 : 0;

  // Dwell time — reuses getStationBottlenecks + getStationDwellVariance
  // (same two functions feeding ShopOperations.jsx's bottleneck grid),
  // averaged across stations for one headline "dwell variance" figure.
  const bottlenecks = useMemo(() => getStationBottlenecks(pieces, productionSettings?.station_bottleneck_threshold || 50), [pieces, productionSettings]);
  const dwellVariance = useMemo(
    () => getStationDwellVariance(stationLogs, pieces, pieceProductionLogs, bottlenecks, productionSettings?.station_dwell_bottleneck_threshold_pct || 25),
    [stationLogs, pieces, pieceProductionLogs, bottlenecks, productionSettings]
  );
  const avgDwellVariancePct = useMemo(() => {
    const withData = dwellVariance.filter((d) => d.dwellVariancePct != null);
    return withData.length > 0 ? withData.reduce((s, d) => s + d.dwellVariancePct, 0) / withData.length : null;
  }, [dwellVariance]);

  const headcount = employees.length;

  // Sales pipeline — reuses bucketPipeline verbatim (same classification the
  // Salesman Dashboard uses), just run over every company bid instead of one
  // salesman's. Commission totals sum getSalesmanCommissionSummary results
  // gathered in loadAll — see the privacy note on the card itself.
  const pipeline = useMemo(() => bucketPipeline(bids), [bids]);
  const pipelineValue = useMemo(
    () => [...pipeline.prospects, ...pipeline.quotes].reduce((s, b) => s + (Number(b.bid_quoted_price) || 0), 0),
    [pipeline]
  );
  const commissionTotals = useMemo(() => commissionBySalesman.reduce((acc, s) => ({
    thisMonthEarned: acc.thisMonthEarned + (s?.thisMonthEarned || 0),
    thisMonthPending: acc.thisMonthPending + (s?.thisMonthPending || 0),
    ytdPaid: acc.ytdPaid + (s?.ytdPaid || 0),
  }), { thisMonthEarned: 0, thisMonthPending: 0, ytdPaid: 0 }), [commissionBySalesman]);
  // Same gate payroll/commission-rate screens use — aggregate totals only,
  // no individual salesman commission ever appears on this page regardless
  // of role, so this only controls whether the card renders at all.
  const canViewCommission = hasSalesmanRateAccess(user?.roles || []);

  const handleSaveSnapshot = async () => {
    setSavingSnapshot(true);
    try {
      const totalWip = wipRadar.reduce((s, p) => s + p.contractValue, 0);
      const totalCash = projects.reduce((s, p) => s + (p.total_invoiced_to_date || 0), 0);
      await db.entities.executive_metrics_snapshots.create({
        snapshot_date: new Date().toISOString().slice(0, 10),
        total_wip_value_cents: Math.round(totalWip * 100),
        total_cash_collected_cents: Math.round(totalCash * 100),
        win_loss_ratio_percentage: winLoss.winRatePct || 0,
        updated_at: new Date().toISOString(),
      });
      toast({ title: 'Snapshot saved' });
    } catch (e) {
      toast({ title: 'Unable to save snapshot', variant: 'destructive' });
    } finally {
      setSavingSnapshot(false);
    }
  };

  if (loading) return <div className="p-6"><div className="h-96 bg-muted rounded-xl animate-pulse" /></div>;

  return (
    <div className="p-4 md:p-6 space-y-6 animate-fade-in">
      <PageHeader
        title="Executive Analytics"
        subtitle="Cross-module rollup — Accounting, Estimating, Shop Production, HR, and Sales — pulling live from each module's own already-computed figures"
        actions={
          <Button size="sm" onClick={handleSaveSnapshot} disabled={savingSnapshot} className="gap-2 steel-gradient text-white border-0">
            {savingSnapshot ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Save Snapshot
          </Button>
        }
      />
      <p className="text-xs text-muted-foreground -mt-4">
        Snapshots are captured manually here — there's no backend scheduler in this app to run them automatically.
      </p>

      {/* 1-4: accounting-sourced sections — hidden entirely on packs without
          '/accounting' (currently just Shop Fab) rather than shown empty. */}
      {showAccountingSections && (
      <>
      {/* 1. Financial WIP Radar */}
      <div className="steel-card p-5" ref={wipRadarRef}>
        <SectionHeader
          icon={Gauge} title="Financial WIP Radar"
          subtitle="Total contract value vs. actual job-to-date cost recognized (from the job cost ledger), per active project."
          onExport={() => exportNodeToPdf(wipRadarRef.current, 'wip-radar.pdf')}
          detailPath="/accounting?tab=wip" navigate={navigate}
        />
        {wipRadar.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No active projects to chart.</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(160, wipRadar.length * 60)}>
            <BarChart data={wipRadar} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tickFormatter={fmtMoney} />
              <YAxis
                type="category"
                dataKey="projectName"
                width={wipLabelWidth}
                tick={<WipYAxisTick maxChars={wipMaxChars} />}
              />
              <Tooltip formatter={(value) => fmtMoney(value)} />
              <Legend />
              <Bar dataKey="contractValue" name="Contract Value" fill="#2563eb" radius={[0, 4, 4, 0]} />
              <Bar dataKey="jtdCost" name="JTD Cost Recognized" fill="#f97316" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* 2. WIP Overbilling/Underbilling Summary */}
      <div className="steel-card p-5" ref={wipSummaryRef}>
        <SectionHeader
          icon={Scale} title="WIP Overbilling / Underbilling Summary"
          subtitle="Billed vs. earned revenue per active project (calculateWIPSchedule), rolled up company-wide."
          onExport={() => exportNodeToPdf(wipSummaryRef.current, 'wip-overbilling-underbilling.pdf')}
          detailPath="/accounting?tab=wip" navigate={navigate}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 mb-4">
          <div className="steel-card bg-red-500/5 border-red-500/20 p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Overbilled</p>
            <p className="text-2xl font-bold text-red-500">{fmtMoney(wipSummary.totalOverbilled)}</p>
            <p className="text-xs text-muted-foreground mt-1">Billings in excess of earned revenue — a liability</p>
          </div>
          <div className="steel-card bg-blue-500/5 border-blue-500/20 p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Underbilled</p>
            <p className="text-2xl font-bold text-blue-500">{fmtMoney(wipSummary.totalUnderbilled)}</p>
            <p className="text-xs text-muted-foreground mt-1">Earned revenue not yet billed — an asset</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Top Overbilled Projects</p>
            {wipSummary.topOverbilled.length === 0 ? <p className="text-xs text-muted-foreground">None.</p> : wipSummary.topOverbilled.map(({ project, wip }) => (
              <div key={project.id} onClick={() => navigate(`/projects/${project.id}`)} className="flex justify-between text-sm py-1.5 border-b border-border/50 cursor-pointer hover:bg-muted/50 px-1 rounded">
                <span className="truncate">{project.name}</span><span className="font-mono text-red-500">{fmtMoney(wip.overUnderBilling)}</span>
              </div>
            ))}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Top Underbilled Projects</p>
            {wipSummary.topUnderbilled.length === 0 ? <p className="text-xs text-muted-foreground">None.</p> : wipSummary.topUnderbilled.map(({ project, wip }) => (
              <div key={project.id} onClick={() => navigate(`/projects/${project.id}`)} className="flex justify-between text-sm py-1.5 border-b border-border/50 cursor-pointer hover:bg-muted/50 px-1 rounded">
                <span className="truncate">{project.name}</span><span className="font-mono text-blue-500">{fmtMoney(-wip.overUnderBilling)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 3. AR / AP Aging Summary */}
      <div className="steel-card p-5" ref={agingRef}>
        <SectionHeader
          icon={Percent} title="AR / AP Aging Summary"
          subtitle="Outstanding receivables and payables bucketed by days past due (agingReport.js), same buckets as Accounting's AR/AP Aging tabs."
          onExport={() => exportNodeToPdf(agingRef.current, 'ar-ap-aging-summary.pdf')}
          navigate={navigate}
        />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold">AR Outstanding — {fmtMoney(arTotalOutstanding)} <span className="text-xs font-normal text-muted-foreground">({fmtPct(arPastDuePct)} past due)</span></p>
              <Button size="sm" variant="ghost" onClick={() => navigate('/accounting?tab=araging')} className="h-7 gap-1 text-xs"><ExternalLink className="w-3 h-3" />Detail</Button>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {AGING_BUCKETS.map((b) => (
                  <tr key={b} className="border-b border-border/50">
                    <td className="py-1.5 text-muted-foreground">{AGING_BUCKET_LABELS[b]}</td>
                    <td className="py-1.5 text-right font-mono">{fmtMoney(arAgingTotals[b])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold">AP Outstanding — {fmtMoney(apTotalOutstanding)}</p>
              <Button size="sm" variant="ghost" onClick={() => navigate('/accounting?tab=apaging')} className="h-7 gap-1 text-xs"><ExternalLink className="w-3 h-3" />Detail</Button>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {AGING_BUCKETS.map((b) => (
                  <tr key={b} className="border-b border-border/50">
                    <td className="py-1.5 text-muted-foreground">{AGING_BUCKET_LABELS[b]}</td>
                    <td className="py-1.5 text-right font-mono">{fmtMoney(apAgingTotals[b])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 4. Cash Position */}
      <div className="steel-card p-5" ref={cashRef}>
        <SectionHeader
          icon={Wallet} title="Cash Position"
          subtitle="90-day cash forecast — starting balance, weekly net change, and projected balance (CashForecastPanel's own logic, embedded so the math is never duplicated)."
          onExport={() => exportNodeToPdf(cashRef.current, 'cash-position.pdf')}
          detailPath="/accounting?tab=cash" navigate={navigate}
        />
        <div className="mt-3">
          <CashForecastPanel />
        </div>
      </div>
      </>
      )}

      {/* 5. Bid Win/Loss */}
      <div className="steel-card p-5" ref={winLossRef}>
        <SectionHeader
          icon={TrendingUp} title="Commercial Bid Win/Loss"
          subtitle="Won/Lost/Did-Not-Bid are parallel outcomes, not funnel stages — shown as a categorical comparison rather than a funnel."
          onExport={() => exportNodeToPdf(winLossRef.current, 'bid-win-loss.pdf')}
          detailPath="/estimating" navigate={navigate}
        />
        <div className="grid grid-cols-1 md:grid-cols-[1fr_200px] gap-4 mt-4">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={winLossChartData} layout="vertical" margin={{ left: 16 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={110} />
              <Tooltip />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                {winLossChartData.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="steel-card bg-primary/5 p-4 flex flex-col items-center justify-center text-center">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Win Rate</p>
            <p className="text-3xl font-bold text-primary">{winLoss.winRatePct === null ? '—' : `${winLoss.winRatePct}%`}</p>
            <p className="text-xs text-muted-foreground mt-1">Won ÷ (Won + Lost)</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Top Loss Reasons</p>
            {winLoss.topLossReasons.length === 0 ? <p className="text-xs text-muted-foreground">None logged.</p> : winLoss.topLossReasons.map((r) => (
              <div key={r.reason} className="flex justify-between text-sm py-1 border-b border-border/50">
                <span>{REASON_LABELS[r.reason] || r.reason}</span><span className="font-mono">{r.count}</span>
              </div>
            ))}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Top Did-Not-Bid Reasons</p>
            {winLoss.topDnbReasons.length === 0 ? <p className="text-xs text-muted-foreground">None logged.</p> : winLoss.topDnbReasons.map((r) => (
              <div key={r.reason} className="flex justify-between text-sm py-1 border-b border-border/50">
                <span>{REASON_LABELS[r.reason] || r.reason}</span><span className="font-mono">{r.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 6. Estimating — Bid Volume, Avg Size, Geometry Breakdown */}
      <div className="steel-card p-5" ref={estimatingRef}>
        <SectionHeader
          icon={Factory} title="Estimating Performance"
          subtitle="Win rate, bid volume, average bid size, and geometry-type mix — reuses computeWinLossStats and estimatingAnalytics.js, the same functions behind Historical Analytics."
          onExport={() => exportNodeToPdf(estimatingRef.current, 'estimating-performance.pdf')}
          detailPath="/estimating/analytics" navigate={navigate}
        />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 mb-4">
          <div className="steel-card p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Win Rate</p>
            <p className="text-2xl font-bold text-primary">{winLoss.winRatePct === null ? '—' : `${winLoss.winRatePct}%`}</p>
          </div>
          <div className="steel-card p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Bid Volume</p>
            <p className="text-2xl font-bold">{bidVolumeStats.totalBids}</p>
          </div>
          <div className="steel-card p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Avg Bid Size</p>
            <p className="text-2xl font-bold">{fmtMoney(bidVolumeStats.avgBidSize)}</p>
          </div>
          <div className="steel-card p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Geometry Types Bid</p>
            <p className="text-2xl font-bold">{geometryBreakdown.length}</p>
          </div>
        </div>
        {geometryBreakdown.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Win Rate by Geometry Type</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left py-1.5">Geometry</th>
                  <th className="text-right py-1.5">Bids</th>
                  <th className="text-right py-1.5">Win Rate</th>
                </tr>
              </thead>
              <tbody>
                {geometryBreakdown.map((g) => (
                  <tr key={g.name} className="border-b border-border/50">
                    <td className="py-1.5">{g.name}</td>
                    <td className="py-1.5 text-right font-mono">{g.value}</td>
                    <td className="py-1.5 text-right font-mono">{g.winRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 7. Shop Production — Capacity & Dwell Time */}
      <div className="steel-card p-5" ref={shopRef}>
        <SectionHeader
          icon={Boxes} title="Shop Production"
          subtitle="Current-week capacity utilization and dwell-time variance — reuses buildCapacityMatrix and getStationDwellVariance from shopOpsMetrics.js, same as the Bottleneck Radar tab."
          onExport={() => exportNodeToPdf(shopRef.current, 'shop-production.pdf')}
          detailPath="/shop-operations" navigate={navigate}
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
          <div className="steel-card p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">This Week's Capacity Utilization</p>
            <p className={`text-2xl font-bold ${currentWeekStatus === 'Red' ? 'text-red-500' : currentWeekStatus === 'Yellow' ? 'text-yellow-500' : 'text-green-500'}`}>
              {fmtPct(currentWeekUtilizationPct)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{Math.round(currentWeekTons).toLocaleString()} of {maxShopCapacity.toLocaleString()} tons</p>
          </div>
          <div className="steel-card p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Avg Dwell Time Variance</p>
            <p className={`text-2xl font-bold ${avgDwellVariancePct > 25 ? 'text-red-500' : 'text-foreground'}`}>{fmtPct(avgDwellVariancePct)}</p>
            <p className="text-xs text-muted-foreground mt-1">Actual vs. target minutes, across stations with target data</p>
          </div>
          <div className="steel-card p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">On-Time Completion Rate</p>
            <p className="text-2xl font-bold text-muted-foreground">—</p>
            <p className="text-xs text-muted-foreground mt-1">Not yet tracked — no promised/actual completion dates recorded to compare (same gap as kpiMetrics.js's on_time_delivery_pct)</p>
          </div>
        </div>
      </div>

      {/* 8. HR Headcount */}
      <div className="steel-card p-5" ref={hrRef}>
        <SectionHeader
          icon={Users} title="Headcount"
          subtitle="Active employees, company-wide."
          onExport={() => exportNodeToPdf(hrRef.current, 'headcount.pdf')}
          detailPath="/human-resources" navigate={navigate}
        />
        <div className="mt-4">
          <div onClick={() => navigate('/human-resources')} className="steel-card p-4 inline-block cursor-pointer hover:bg-muted/50">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Active Employees</p>
            <p className="text-2xl font-bold">{headcount}</p>
          </div>
        </div>
      </div>

      {/* 9. Sales — Pipeline & Commission */}
      <div className="steel-card p-5" ref={salesRef}>
        <SectionHeader
          icon={HandCoins} title="Sales Pipeline &amp; Commission"
          subtitle="Open pipeline value reuses bucketPipeline (salesDashboardData.js) across every company bid. Commission is an aggregate company total only — no individual salesman detail is shown here, matching the same privacy gate as the salesman rate screens."
          onExport={() => exportNodeToPdf(salesRef.current, 'sales-pipeline-commission.pdf')}
          detailPath="/estimating" navigate={navigate}
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
          <div onClick={() => navigate('/estimating')} className="steel-card p-4 cursor-pointer hover:bg-muted/50">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Open Pipeline Value</p>
            <p className="text-2xl font-bold text-primary">{fmtMoney(pipelineValue)}</p>
            <p className="text-xs text-muted-foreground mt-1">{pipeline.prospects.length + pipeline.quotes.length} prospects + quotes</p>
          </div>
          {canViewCommission ? (
            <>
              <div className="steel-card p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Pending Commission</p>
                <p className="text-2xl font-bold">{fmtMoney(commissionTotals.thisMonthPending)}</p>
              </div>
              <div className="steel-card p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">YTD Commission Paid</p>
                <p className="text-2xl font-bold">{fmtMoney(commissionTotals.ytdPaid)}</p>
              </div>
            </>
          ) : (
            <div className="steel-card p-4 sm:col-span-2 flex items-center justify-center text-center">
              <p className="text-xs text-muted-foreground">Commission totals are restricted to Admin / Payroll Admin / HR Admin roles.</p>
            </div>
          )}
        </div>
      </div>

      {/* 10. Quarterly Tax Exposure Grid */}
      <div className="steel-card overflow-hidden" ref={taxRef}>
        <div className="p-5 pb-3">
          <SectionHeader
            icon={Landmark} title="Quarterly Tax Exposure Grid"
            subtitle="Hancock County structural tax vs. Joist & Deck jobsite tax overrides, by billing quarter, across all bids."
            onExport={() => exportNodeToPdf(taxRef.current, 'quarterly-tax-exposure.pdf')}
            detailPath="/estimating" navigate={navigate}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left py-3 px-5">Quarter</th>
                <th className="text-right py-3 px-5">Hancock County Tax</th>
                <th className="text-right py-3 px-5">Joist &amp; Deck Tax</th>
                <th className="text-right py-3 px-5">Total</th>
              </tr>
            </thead>
            <tbody>
              {taxRows.length === 0 ? (
                <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">No bid tax data available yet.</td></tr>
              ) : taxRows.map((row) => (
                <tr key={row.quarter} className="border-b border-border/50">
                  <td className="py-3 px-5 font-medium">{row.quarter}</td>
                  <td className="py-3 px-5 text-right font-mono">{fmtMoney(row.hancockCountyTax)}</td>
                  <td className="py-3 px-5 text-right font-mono">{fmtMoney(row.joistDeckTax)}</td>
                  <td className="py-3 px-5 text-right font-mono font-semibold">{fmtMoney(row.hancockCountyTax + row.joistDeckTax)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
