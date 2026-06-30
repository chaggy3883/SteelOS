import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Truck, Package, CheckCircle2, Clock, Search, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';

export default function Shipping() {
  const [pieces, setPieces] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('all');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [pieceData, projData] = await Promise.all([
        base44.entities.PieceMark.filter({ status: { $in: ['painted','shipped','erected'] } }, '-updated_date', 200),
        base44.entities.Project.filter({ is_archived: false }, 'name', 50),
      ]);
      setPieces(pieceData);
      setProjects(projData);
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
    </div>
  );
}