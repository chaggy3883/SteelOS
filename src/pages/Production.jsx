import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '@/api/apiClient';
import {
  Package, Search, QrCode, Plus, AlertTriangle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import StatusBadge from '@/components/ui/StatusBadge';
import PageHeader from '@/components/ui/PageHeader';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const STATUS_OPTIONS = ['all', 'not_started', 'in_fabrication', 'fabricated', 'inspected', 'painted', 'shipped', 'erected'];

// Theoretical yield is always derived from operator-entered stock_qty_required
// * parts_per_stock — never a hardcoded rule. Variance color bands: green at
// or above theoretical, amber within 10% under, red beyond that.
const getYieldVariance = (piece) => {
  const theoretical = (Number(piece.stock_qty_required) || 0) * (Number(piece.parts_per_stock) || 0);
  const actual = Number(piece.actual_parts_yielded) || 0;
  const variance = actual - theoretical;
  const pct = theoretical > 0 ? Math.round((variance / theoretical) * 100) : 0;
  return { theoretical, actual, variance, pct };
};

const varianceColorClass = ({ theoretical, variance, pct }) => {
  if (theoretical === 0) return 'text-muted-foreground';
  if (variance >= 0) return 'text-green-600';
  if (pct >= -10) return 'text-amber-600';
  return 'text-red-600';
};

const STATUS_ROW_TINT = {
  in_fabrication: 'bg-orange-500/5',
  fabricated: 'bg-blue-500/5',
  inspected: 'bg-purple-500/5',
  painted: 'bg-teal-500/5',
  shipped: 'bg-green-500/5',
  erected: 'bg-green-600/5',
  rejected: 'bg-red-500/5',
};

const formatDate = (d) => d ? new Date(d).toLocaleDateString() : null;

// Explains why a piece sits in its current status using the date fields that
// were actually set for it — no separate status-history log exists.
const statusExplanation = (piece) => {
  switch (piece.status) {
    case 'not_started': return 'Fabrication has not started yet.';
    case 'in_fabrication': {
      const d = formatDate(piece.fab_start_date);
      return d ? `In fabrication since ${d}.` : 'Currently in fabrication.';
    }
    case 'fabricated': {
      const d = formatDate(piece.fab_complete_date);
      return d ? `Fabrication completed ${d}.` : 'Fabrication complete, awaiting next step.';
    }
    case 'inspected': return 'Passed quality inspection.';
    case 'painted': return 'Painting/finish complete.';
    case 'shipped': {
      const d = formatDate(piece.ship_date);
      return d ? `Shipped ${d}.` : 'Shipped to the job site.';
    }
    case 'erected': {
      const d = formatDate(piece.erect_date);
      return d ? `Erected on site ${d}.` : 'Erected on site.';
    }
    case 'rejected': return 'On hold — flagged for quality or rework.';
    default: return null;
  }
};

export default function Production() {
  const navigate = useNavigate();
  const tableRef = useRef(null);
  const [pieces, setPieces] = useState([]);
  const [projects, setProjects] = useState([]);
  const [boltInventory, setBoltInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [phaseFilter, setPhaseFilter] = useState('all');
  const [viewingPiece, setViewingPiece] = useState(null);

  useEffect(() => { loadData(); }, []);

  const goToProject = (projectId, e) => {
    e?.stopPropagation();
    if (projectId) navigate(`/projects/${projectId}`);
  };

  const filterByStatus = (status) => {
    setStatusFilter(status);
    tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [pieceData, projectData, boltData] = await Promise.all([
        db.entities.PieceMark.list('-created_date', 200),
        db.entities.Project.filter({ is_archived: false }, 'name', 50),
        db.entities.InventoryItem.filter({ category: 'bolt' }, '-created_date', 200),
      ]);
      setPieces(pieceData);
      setProjects(projectData);
      setBoltInventory(boltData);
    } catch (e) {} finally { setLoading(false); }
  };

  const handleYieldFieldUpdate = async (piece, field, value) => {
    const updated = await db.entities.PieceMark.update(piece.id, { [field]: Number(value) || 0 });
    setPieces((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };

  const boltStockFor = (boltSize) => boltInventory.find((inv) => inv.size === boltSize);

  const projectName = (id) => projects.find((p) => p.id === id)?.name || '—';

  const piecePhaseKey = (p) => (p.phase || '').trim() || 'Unassigned';
  const phaseOptions = Array.from(new Set(pieces.map(piecePhaseKey))).sort((a, b) => {
    if (a === 'Unassigned') return 1;
    if (b === 'Unassigned') return -1;
    return a.localeCompare(b, undefined, { numeric: true });
  });

  const filtered = pieces.filter(p => {
    const matchSearch = !search || p.piece_mark?.toLowerCase().includes(search.toLowerCase()) || p.assembly?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || p.status === statusFilter;
    const matchProject = projectFilter === 'all' || p.project_id === projectFilter;
    const matchPhase = phaseFilter === 'all' || piecePhaseKey(p) === phaseFilter;
    return matchSearch && matchStatus && matchProject && matchPhase;
  });

  const statusCounts = STATUS_OPTIONS.slice(1).map(s => ({
    status: s,
    name: s.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase()),
    count: pieces.filter(p => p.status === s).length,
  }));

  const totalWeight = pieces.reduce((sum, p) => sum + (p.weight_lbs || 0), 0);
  const completedWeight = pieces.filter(p => ['shipped','erected'].includes(p.status)).reduce((sum, p) => sum + (p.weight_lbs || 0), 0);
  const progressPct = totalWeight > 0 ? Math.round((completedWeight / totalWeight) * 100) : 0;

  const projectProgress = projects.map(proj => {
    const projPieces = pieces.filter(p => p.project_id === proj.id);
    const total = projPieces.length;
    const pct = (predicate) => total > 0 ? Math.round((projPieces.filter(predicate).length / total) * 100) : 0;
    return {
      id: proj.id,
      name: proj.name,
      project_number: proj.project_number,
      total,
      detailingPct: pct(p => p.detailing_complete),
      fabricatedPct: pct(p => ['fabricated', 'inspected', 'painted', 'shipped', 'erected'].includes(p.status)),
      shippedPct: pct(p => ['shipped', 'erected'].includes(p.status)),
    };
  }).filter(p => p.total > 0);

  const yieldParts = pieces.filter((p) => (Number(p.parts_per_stock) || 0) > 0);
  const yieldRollupsByProject = projects.map((proj) => {
    const projParts = yieldParts.filter((p) => p.project_id === proj.id);
    if (projParts.length === 0) return null;
    const withVariance = projParts.map((p) => ({ part: p, ...getYieldVariance(p) }));
    const totalTheoretical = withVariance.reduce((s, x) => s + x.theoretical, 0);
    const totalActual = withVariance.reduce((s, x) => s + x.actual, 0);
    const worst = [...withVariance].sort((a, b) => a.variance - b.variance).slice(0, 3);
    return { project: proj, totalTheoretical, totalActual, worst };
  }).filter(Boolean);

  const bolts = pieces.filter((p) => p.item_type === 'Bolt');

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader
        title="Production"
        subtitle="Shop floor tracking and piece mark management"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2"><QrCode className="w-4 h-4" /> Scan Barcode</Button>
            <Button className="steel-gradient text-white border-0 gap-2"><Plus className="w-4 h-4" /> Add Piece</Button>
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        {[
          { label: 'Total Pieces', value: pieces.length, color: 'text-blue-500', status: 'all' },
          { label: 'In Fabrication', value: pieces.filter(p => p.status === 'in_fabrication').length, color: 'text-orange-500', status: 'in_fabrication' },
          { label: 'Fabricated', value: pieces.filter(p => p.status === 'fabricated').length, color: 'text-blue-400', status: 'fabricated' },
          { label: 'Shipped', value: pieces.filter(p => p.status === 'shipped').length, color: 'text-green-500', status: 'shipped' },
          { label: 'On Hold', value: pieces.filter(p => p.status === 'rejected').length, color: 'text-red-500', status: 'rejected' },
        ].map(({ label, value, color, status }) => (
          <button
            key={label}
            type="button"
            onClick={() => filterByStatus(status)}
            className="steel-card p-4 text-left hover:ring-1 hover:ring-primary/40 transition-shadow"
          >
            <p className="text-xs text-muted-foreground mb-1">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{loading ? '—' : value}</p>
          </button>
        ))}
      </div>

      {/* Project Progress Grid */}
      {projectProgress.length > 0 && (
        <div className="mb-6">
          <h3 className="font-semibold mb-3">Project Progress</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {projectProgress.map(p => (
              <div
                key={p.id}
                onClick={() => navigate(`/projects/${p.id}`)}
                className="steel-card p-4 cursor-pointer hover:ring-1 hover:ring-primary/40 transition-shadow"
              >
                <p className="font-medium text-sm truncate" title={p.name}>{p.name}</p>
                <p className="text-xs text-muted-foreground font-mono mb-3">{p.project_number} · {p.total} pieces</p>
                {[
                  { label: '% Detailing', value: p.detailingPct, color: 'bg-purple-500' },
                  { label: '% Fabricated', value: p.fabricatedPct, color: 'bg-blue-500' },
                  { label: '% Shipped', value: p.shippedPct, color: 'bg-green-500' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="mb-2 last:mb-0">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-medium">{value}%</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${value}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Yield Rollup */}
      {yieldRollupsByProject.length > 0 && (
        <div className="mb-6">
          <h3 className="font-semibold mb-3">Parts Yield Rollup</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {yieldRollupsByProject.map((r) => {
              const totalVariance = r.totalActual - r.totalTheoretical;
              return (
                <div
                  key={r.project.id}
                  onClick={() => navigate(`/projects/${r.project.id}`)}
                  className="steel-card p-4 cursor-pointer hover:ring-1 hover:ring-primary/40 transition-shadow"
                >
                  <p className="font-medium text-sm truncate" title={r.project.name}>{r.project.name}</p>
                  <p className="text-xs text-muted-foreground font-mono mb-3">{r.project.project_number}</p>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span className="text-muted-foreground">Theoretical</span>
                    <span className="font-mono">{r.totalTheoretical.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span className="text-muted-foreground">Actual</span>
                    <span className="font-mono">{r.totalActual.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm mb-3">
                    <span className="text-muted-foreground">Variance</span>
                    <span className={`font-mono font-semibold ${totalVariance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {totalVariance >= 0 ? '+' : ''}{totalVariance.toLocaleString()}
                    </span>
                  </div>
                  {r.worst.length > 0 && (
                    <div className="pt-2 border-t border-border/50 space-y-0.5">
                      <p className="text-xs font-semibold text-muted-foreground mb-1">Worst Variance</p>
                      {r.worst.map(({ part, variance, pct, theoretical, actual }) => (
                        <button
                          key={part.id}
                          onClick={(e) => { e.stopPropagation(); setViewingPiece(part); }}
                          className={`flex items-center justify-between w-full text-xs py-1 px-1 rounded hover:bg-muted/50 ${varianceColorClass({ theoretical, variance, pct })}`}
                        >
                          <span className="truncate text-foreground">{part.part_number || part.piece_mark}</span>
                          <span className="font-mono flex-shrink-0">{variance >= 0 ? '+' : ''}{variance} ({pct}%)</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Yield Tracking */}
      {yieldParts.length > 0 && (
        <div className="steel-card overflow-hidden mb-6">
          <div className="p-4 border-b border-border">
            <h3 className="font-semibold">Yield Actuals</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Parts with an operator-entered parts-per-stock ratio. Enter actual parts yielded and scrap as they come off the shop floor.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left py-3 px-4">Part</th>
                  <th className="text-left py-3 px-4">Project</th>
                  <th className="text-right py-3 px-4">Theoretical</th>
                  <th className="text-right py-3 px-4">Actual Yielded</th>
                  <th className="text-right py-3 px-4">Scrap Qty</th>
                  <th className="text-right py-3 px-4">Variance</th>
                </tr>
              </thead>
              <tbody>
                {yieldParts.map((p) => {
                  const v = getYieldVariance(p);
                  const colorClass = varianceColorClass(v);
                  return (
                    <tr key={p.id} onClick={() => setViewingPiece(p)} className="border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer">
                      <td className="py-3 px-4 font-mono font-medium text-primary">{p.part_number || p.piece_mark}</td>
                      <td className="py-3 px-4">
                        <button onClick={(e) => goToProject(p.project_id, e)} className="text-muted-foreground hover:text-primary hover:underline text-left">
                          {projectName(p.project_id)}
                        </button>
                      </td>
                      <td className="py-3 px-4 text-right font-mono">{v.theoretical.toLocaleString()}</td>
                      <td className="py-3 px-4 text-right">
                        <Input
                          type="number"
                          defaultValue={p.actual_parts_yielded || 0}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={(e) => handleYieldFieldUpdate(p, 'actual_parts_yielded', e.target.value)}
                          className="h-7 w-24 text-right ml-auto"
                        />
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Input
                          type="number"
                          defaultValue={p.scrap_qty || 0}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={(e) => handleYieldFieldUpdate(p, 'scrap_qty', e.target.value)}
                          className="h-7 w-24 text-right ml-auto"
                        />
                      </td>
                      <td className={`py-3 px-4 text-right font-mono font-semibold ${colorClass}`}>
                        {v.variance >= 0 ? '+' : ''}{v.variance} ({v.pct}%)
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Bolt Requirements vs Inventory */}
      {bolts.length > 0 && (
        <div className="steel-card overflow-hidden mb-6">
          <div className="p-4 border-b border-border">
            <h3 className="font-semibold">Bolt Requirements vs Inventory</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Read-only comparison against InventoryItem bolt stock — matched on bolt size.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left py-3 px-4">Bolt</th>
                  <th className="text-left py-3 px-4">Project</th>
                  <th className="text-right py-3 px-4">Required Qty</th>
                  <th className="text-right py-3 px-4">On Hand</th>
                  <th className="text-right py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {bolts.map((p) => {
                  const stock = boltStockFor(p.bolt_size);
                  const onHand = stock?.quantity_on_hand || 0;
                  const required = Number(p.quantity) || 0;
                  const isShort = onHand < required;
                  return (
                    <tr key={p.id} onClick={() => setViewingPiece(p)} className="border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer">
                      <td className="py-3 px-4 font-mono font-medium text-primary">{p.bolt_size || '—'} {p.bolt_grade || ''}</td>
                      <td className="py-3 px-4">
                        <button onClick={(e) => goToProject(p.project_id, e)} className="text-muted-foreground hover:text-primary hover:underline text-left">
                          {projectName(p.project_id)}
                        </button>
                      </td>
                      <td className="py-3 px-4 text-right font-mono">{required.toLocaleString()}</td>
                      <td className="py-3 px-4 text-right font-mono">{stock ? onHand.toLocaleString() : '—'}</td>
                      <td className="py-3 px-4 text-right">
                        {isShort ? (
                          <Badge variant="destructive" className="gap-1 text-[10px]"><AlertTriangle className="w-3 h-3" />Short</Badge>
                        ) : (
                          <span className="text-xs text-green-600">OK</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Progress Bar */}
      {pieces.length > 0 && (
        <div className="steel-card p-5 mb-6">
          <div className="flex justify-between text-sm mb-2">
            <span className="font-medium">Overall Fabrication Progress</span>
            <span className="text-muted-foreground">{progressPct}% by weight</span>
          </div>
          <div className="h-3 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-blue-500 to-green-500 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>{completedWeight.toLocaleString()} lbs shipped/erected</span>
            <span>{totalWeight.toLocaleString()} lbs total</span>
          </div>
        </div>
      )}

      {/* Status Chart */}
      <div className="steel-card p-5 mb-6">
        <h3 className="font-semibold mb-4">Production Status Distribution</h3>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={statusCounts}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }} />
            <Bar
              dataKey="count"
              fill="hsl(213 94% 45%)"
              radius={[4, 4, 0, 0]}
              cursor="pointer"
              onClick={(data) => filterByStatus(data.status)}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Filters */}
      <div ref={tableRef} className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search piece marks..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All Statuses" /></SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map(s => (
              <SelectItem key={s} value={s}>{s === 'all' ? 'All Statuses' : s.replace('_',' ').replace(/\b\w/g, c => c.toUpperCase())}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="w-56"><SelectValue placeholder="All Projects" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Projects</SelectItem>
            {projects.map(p => (
              <SelectItem key={p.id} value={p.id}>{p.project_number} — {p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={phaseFilter} onValueChange={setPhaseFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All Phases" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Phases</SelectItem>
            {phaseOptions.map(ph => (
              <SelectItem key={ph} value={ph}>{ph}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Pieces Table */}
      <div className="steel-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left py-3 px-4">Piece Mark</th>
                <th className="text-left py-3 px-4">Project</th>
                <th className="text-left py-3 px-4">Assembly</th>
                <th className="text-left py-3 px-4">Grade</th>
                <th className="text-right py-3 px-4">Qty</th>
                <th className="text-right py-3 px-4">Weight (lbs)</th>
                <th className="text-left py-3 px-4">Zone</th>
                <th className="text-left py-3 px-4">Drawing</th>
                <th className="text-left py-3 px-4">Phase</th>
                <th className="text-left py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}><td colSpan={10} className="py-3 px-4"><div className="h-6 bg-muted rounded animate-pulse" /></td></tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-16 text-center">
                    <Package className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">No pieces found</p>
                  </td>
                </tr>
              ) : (
                filtered.map(p => (
                  <tr
                    key={p.id}
                    onClick={() => setViewingPiece(p)}
                    className={`border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer ${STATUS_ROW_TINT[p.status] || ''}`}
                  >
                    <td className="py-3 px-4 font-mono font-bold text-primary">{p.piece_mark}</td>
                    <td className="py-3 px-4">
                      <button onClick={(e) => goToProject(p.project_id, e)} className="text-muted-foreground hover:text-primary hover:underline text-left">
                        {projectName(p.project_id)}
                      </button>
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">{p.assembly || '—'}</td>
                    <td className="py-3 px-4">{p.material_grade || '—'}</td>
                    <td className="py-3 px-4 text-right">{p.quantity || 1}</td>
                    <td className="py-3 px-4 text-right font-mono">{p.weight_lbs ? p.weight_lbs.toLocaleString() : '—'}</td>
                    <td className="py-3 px-4 text-xs font-mono text-muted-foreground">{p.warehouse_zone || '—'}</td>
                    <td className="py-3 px-4 text-xs font-mono text-muted-foreground">{p.drawing_number || '—'}</td>
                    <td className="py-3 px-4 text-xs text-muted-foreground">{piecePhaseKey(p)}</td>
                    <td className="py-3 px-4">
                      <button onClick={(e) => { e.stopPropagation(); setViewingPiece(p); }}>
                        <StatusBadge status={p.status} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={!!viewingPiece} onOpenChange={(o) => !o && setViewingPiece(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{viewingPiece?.part_number || viewingPiece?.piece_mark}</DialogTitle></DialogHeader>
          {viewingPiece && (() => {
            const v = getYieldVariance(viewingPiece);
            const stock = viewingPiece.item_type === 'Bolt' ? boltStockFor(viewingPiece.bolt_size) : null;
            const rows = [
              ['Item Type', (viewingPiece.item_type || 'Loose_Part').replace(/_/g, ' ')],
              ['Project', projectName(viewingPiece.project_id)],
              ['Piece Mark', viewingPiece.piece_mark],
              ['Assembly', viewingPiece.assembly],
              ['Part Number', viewingPiece.part_number],
              ['Description', viewingPiece.description],
              ['Quantity', viewingPiece.quantity],
              ['Weight (lbs)', viewingPiece.weight_lbs?.toLocaleString()],
              ['Material Grade', viewingPiece.material_grade],
              ['Phase', piecePhaseKey(viewingPiece)],
              ['Status', viewingPiece.status],
              ['Status Detail', statusExplanation(viewingPiece)],
              ['Warehouse Zone / Rack', [viewingPiece.warehouse_zone, viewingPiece.warehouse_rack].filter(Boolean).join(' / ')],
              ['Drawing Number', viewingPiece.drawing_number],
              ['Heat Number', viewingPiece.heat_number],
              ['Fab Start Date', formatDate(viewingPiece.fab_start_date)],
              ['Fab Complete Date', formatDate(viewingPiece.fab_complete_date)],
              ['Ship Date', formatDate(viewingPiece.ship_date)],
              ['Erect Date', formatDate(viewingPiece.erect_date)],
              ['Detailing Complete', viewingPiece.detailing_complete ? `Yes (${formatDate(viewingPiece.detailing_complete_date) || 'no date'})` : 'No'],
              ...(viewingPiece.item_type === 'Bolt' ? [
                ['Bolt Size', viewingPiece.bolt_size],
                ['Bolt Grade', viewingPiece.bolt_grade],
                ['Qty On Hand', stock ? stock.quantity_on_hand : 'No matching inventory'],
              ] : [
                ['Stock Material Description', viewingPiece.stock_material_description],
                ['Parts per Stock Length', viewingPiece.parts_per_stock],
                ['Stock Qty Required', viewingPiece.stock_qty_required],
                ['Theoretical Yield', v.theoretical],
                ['Actual Parts Yielded', viewingPiece.actual_parts_yielded],
                ['Scrap Qty', viewingPiece.scrap_qty],
                ['Variance', `${v.variance >= 0 ? '+' : ''}${v.variance} (${v.pct}%)`],
              ]),
              ['Notes', viewingPiece.notes],
            ];
            return (
              <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                {rows.map(([label, value]) => (
                  <div key={label} className="grid grid-cols-3 gap-2 text-sm border-b border-border/50 pb-2">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="col-span-2 font-medium whitespace-pre-wrap break-words">{value || value === 0 ? value : '—'}</span>
                  </div>
                ))}
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewingPiece(null)}>Close</Button>
            {viewingPiece?.project_id && (
              <Button
                className="steel-gradient text-white border-0"
                onClick={() => { const id = viewingPiece.project_id; setViewingPiece(null); navigate(`/projects/${id}`); }}
              >
                View Project
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}