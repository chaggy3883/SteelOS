import React, { useState, useEffect } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { db } from '@/api/apiClient';
import { BarChart3, TrendingUp, DollarSign, Package, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/ui/PageHeader';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { getEffectiveCompany, isSuperAdmin, isImpersonating } from '@/lib/tenantContext';
import { hasModule } from '@/lib/moduleEntitlement';
import ModuleLocked from '@/components/shared/ModuleLocked';

const COLORS = ['#1d7ed8', '#f97316', '#22c55e', '#a855f7', '#ef4444', '#eab308'];

export default function Reports() {
  useDocumentTitle('SteelOS — Reports');
  const [projects, setProjects] = useState([]);
  const [pieces, setPieces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [moduleAllowed, setModuleAllowed] = useState(false);
  const [checkingModuleAccess, setCheckingModuleAccess] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => { loadData(); }, []);
  useEffect(() => {
    db.auth.me().then((me) => setCurrentUser(me || null)).catch(() => setCurrentUser(null));
    getEffectiveCompany()
      .then((company) => setModuleAllowed(hasModule(company, '/reports')))
      .catch(() => setModuleAllowed(false))
      .finally(() => setCheckingModuleAccess(false));
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [projData, pieceData] = await Promise.all([
        db.entities.Project.filter({ is_archived: false }, '-created_date', 100),
        db.entities.PieceMark.list('-created_date', 500),
      ]);
      setProjects(projData);
      setPieces(pieceData);
    } catch (e) {} finally { setLoading(false); }
  };

  const statusBreakdown = ['estimating','awarded','engineering','fabrication','erection','complete'].map(s => ({
    name: s.charAt(0).toUpperCase() + s.slice(1),
    value: projects.filter(p => p.status === s).length,
  })).filter(d => d.value > 0);

  const pieceStatusData = ['not_started','in_fabrication','fabricated','inspected','painted','shipped','erected'].map(s => ({
    name: s.replace('_',' ').replace(/\b\w/g,c=>c.toUpperCase()),
    value: pieces.filter(p => p.status === s).length,
  })).filter(d => d.value > 0);

  const riskBreakdown = [
    { name: 'Low', value: projects.filter(p => p.risk_level === 'low').length },
    { name: 'Medium', value: projects.filter(p => p.risk_level === 'medium').length },
    { name: 'High', value: projects.filter(p => p.risk_level === 'high').length },
    { name: 'Critical', value: projects.filter(p => p.risk_level === 'critical').length },
  ].filter(d => d.value > 0);

  const totalContractValue = projects.reduce((s, p) => s + (p.contract_value || 0), 0);
  const totalTons = projects.reduce((s, p) => s + (p.estimated_tons || 0), 0);
  const avgHealth = projects.length > 0 ? Math.round(projects.reduce((s, p) => s + (p.health_score || 100), 0) / projects.length) : 0;

  const isPlatformOperatorView = isSuperAdmin(currentUser) && !isImpersonating();
  const showModule = moduleAllowed || isPlatformOperatorView;

  if (checkingModuleAccess) return <div className="p-6"><div className="h-96 bg-muted rounded-xl animate-pulse" /></div>;

  // Route guard — a direct URL to /reports can't bypass the nav's
  // module-pack filtering.
  if (!showModule) {
    return <ModuleLocked modulePath="/reports" title="Reports Not Included" />;
  }

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader
        title="Reports & Analytics"
        subtitle="Executive dashboards and operational insights"
        actions={<Button variant="outline"><Download className="w-4 h-4 mr-2" />Export Report</Button>}
      />

      {/* Top KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Active Projects', value: projects.filter(p => !['complete','cancelled'].includes(p.status)).length, icon: BarChart3, color: 'text-blue-500' },
          { label: 'Total Contract Value', value: `$${(totalContractValue/1000000).toFixed(1)}M`, icon: DollarSign, color: 'text-green-500' },
          { label: 'Total Estimated Tons', value: `${totalTons.toLocaleString()} T`, icon: Package, color: 'text-orange-500' },
          { label: 'Avg Project Health', value: `${avgHealth}%`, icon: TrendingUp, color: avgHealth >= 80 ? 'text-green-500' : avgHealth >= 60 ? 'text-yellow-500' : 'text-red-500' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="steel-card p-4">
            <div className="flex items-center gap-2 mb-1"><Icon className={`w-4 h-4 ${color}`} /><p className="text-xs text-muted-foreground">{label}</p></div>
            <p className={`text-2xl font-bold ${color}`}>{loading ? '—' : value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Project Status */}
        <div className="steel-card p-5">
          <h3 className="font-semibold mb-4">Project Status Distribution</h3>
          {statusBreakdown.length === 0
            ? <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">No project data</div>
            : <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={statusBreakdown} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({ name, value }) => `${name}: ${value}`} labelLine={false}>
                    {statusBreakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
          }
        </div>

        {/* Risk Breakdown */}
        <div className="steel-card p-5">
          <h3 className="font-semibold mb-4">Project Risk Levels</h3>
          {riskBreakdown.length === 0
            ? <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">No risk data</div>
            : <ResponsiveContainer width="100%" height={200}>
                <BarChart data={riskBreakdown}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }} />
                  <Bar dataKey="value" fill="hsl(213 94% 45%)" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
          }
        </div>
      </div>

      {/* Piece Mark Production */}
      <div className="steel-card p-5">
        <h3 className="font-semibold mb-4">Shop Floor Production by Status</h3>
        {pieceStatusData.length === 0
          ? <div className="flex items-center justify-center h-36 text-muted-foreground text-sm">No production data yet</div>
          : <ResponsiveContainer width="100%" height={160}>
              <BarChart data={pieceStatusData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }} />
                <Bar dataKey="value" fill="hsl(142 71% 45%)" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
        }
      </div>
    </div>
  );
}