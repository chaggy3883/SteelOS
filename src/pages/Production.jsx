import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import {
  Package, Search, QrCode, Plus
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import StatusBadge from '@/components/ui/StatusBadge';
import PageHeader from '@/components/ui/PageHeader';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const STATUS_OPTIONS = ['all', 'not_started', 'in_fabrication', 'fabricated', 'inspected', 'painted', 'shipped', 'erected'];

export default function Production() {
  const [pieces, setPieces] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [pieceData, projectData] = await Promise.all([
        base44.entities.PieceMark.list('-created_date', 200),
        base44.entities.Project.filter({ is_archived: false }, 'name', 50),
      ]);
      setPieces(pieceData);
      setProjects(projectData);
    } catch (e) {} finally { setLoading(false); }
  };

  const filtered = pieces.filter(p => {
    const matchSearch = !search || p.piece_mark?.toLowerCase().includes(search.toLowerCase()) || p.assembly?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || p.status === statusFilter;
    const matchProject = projectFilter === 'all' || p.project_id === projectFilter;
    return matchSearch && matchStatus && matchProject;
  });

  const statusCounts = STATUS_OPTIONS.slice(1).map(s => ({
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
          { label: 'Total Pieces', value: pieces.length, color: 'text-blue-500' },
          { label: 'In Fabrication', value: pieces.filter(p => p.status === 'in_fabrication').length, color: 'text-orange-500' },
          { label: 'Fabricated', value: pieces.filter(p => p.status === 'fabricated').length, color: 'text-blue-400' },
          { label: 'Shipped', value: pieces.filter(p => p.status === 'shipped').length, color: 'text-green-500' },
          { label: 'On Hold', value: pieces.filter(p => p.status === 'rejected').length, color: 'text-red-500' },
        ].map(({ label, value, color }) => (
          <div key={label} className="steel-card p-4">
            <p className="text-xs text-muted-foreground mb-1">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{loading ? '—' : value}</p>
          </div>
        ))}
      </div>

      {/* Project Progress Grid */}
      {projectProgress.length > 0 && (
        <div className="mb-6">
          <h3 className="font-semibold mb-3">Project Progress</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {projectProgress.map(p => (
              <div key={p.id} className="steel-card p-4">
                <p className="font-medium text-sm truncate">{p.name}</p>
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
            <Bar dataKey="count" fill="hsl(213 94% 45%)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
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
      </div>

      {/* Pieces Table */}
      <div className="steel-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left py-3 px-4">Piece Mark</th>
                <th className="text-left py-3 px-4">Assembly</th>
                <th className="text-left py-3 px-4">Grade</th>
                <th className="text-right py-3 px-4">Qty</th>
                <th className="text-right py-3 px-4">Weight (lbs)</th>
                <th className="text-left py-3 px-4">Zone</th>
                <th className="text-left py-3 px-4">Drawing</th>
                <th className="text-left py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}><td colSpan={8} className="py-3 px-4"><div className="h-6 bg-muted rounded animate-pulse" /></td></tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center">
                    <Package className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">No pieces found</p>
                  </td>
                </tr>
              ) : (
                filtered.map(p => (
                  <tr key={p.id} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                    <td className="py-3 px-4 font-mono font-bold text-primary">{p.piece_mark}</td>
                    <td className="py-3 px-4 text-muted-foreground">{p.assembly || '—'}</td>
                    <td className="py-3 px-4">{p.material_grade || '—'}</td>
                    <td className="py-3 px-4 text-right">{p.quantity || 1}</td>
                    <td className="py-3 px-4 text-right font-mono">{p.weight_lbs ? p.weight_lbs.toLocaleString() : '—'}</td>
                    <td className="py-3 px-4 text-xs font-mono text-muted-foreground">{p.warehouse_zone || '—'}</td>
                    <td className="py-3 px-4 text-xs font-mono text-muted-foreground">{p.drawing_number || '—'}</td>
                    <td className="py-3 px-4"><StatusBadge status={p.status} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}