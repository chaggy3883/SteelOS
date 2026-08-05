import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { Loader2, Gauge } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const efficiencyColor = (pct) => {
  if (pct >= 100) return 'text-emerald-600';
  if (pct >= 85) return 'text-amber-600';
  return 'text-red-600';
};

export default function ShopEfficiency() {
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [projects, setProjects] = useState([]);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [logData, employeeData, projectData] = await Promise.all([
        db.entities.piece_production_logs.filter({ status: 'Complete' }, '-created_date', 1000),
        db.entities.employees.list('-created_date', 500),
        db.entities.Project.list('-created_date', 200),
      ]);
      setLogs(logData);
      setEmployees(employeeData);
      setProjects(projectData);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const employeeName = (id) => employees.find((e) => e.id === id)?.full_name || 'Unknown';
  const projectLabel = (id) => {
    const p = projects.find((pr) => pr.id === id);
    return p ? `${p.project_number} — ${p.name}` : 'Unassigned';
  };

  const leaderboard = Object.values(
    logs.reduce((acc, log) => {
      const key = log.employee_id;
      if (!acc[key]) acc[key] = { employee_id: key, pieces: 0, actualMinutes: 0, targetMinutes: 0 };
      acc[key].pieces += 1;
      acc[key].actualMinutes += log.elapsed_minutes || 0;
      acc[key].targetMinutes += log.target_minutes || 0;
      return acc;
    }, {})
  ).map((row) => ({
    ...row,
    efficiencyPct: row.actualMinutes > 0 ? Math.round((row.targetMinutes / row.actualMinutes) * 100) : null,
  })).sort((a, b) => (b.efficiencyPct || 0) - (a.efficiencyPct || 0));

  const varianceMatrix = Object.values(
    logs.reduce((acc, log) => {
      const key = log.material_profile_type || 'Other';
      if (!acc[key]) acc[key] = { material_profile_type: key, pieces: 0, actualMinutes: 0, targetMinutes: 0 };
      acc[key].pieces += 1;
      acc[key].actualMinutes += log.elapsed_minutes || 0;
      acc[key].targetMinutes += log.target_minutes || 0;
      return acc;
    }, {})
  ).map((row) => ({
    ...row,
    varianceMinutes: row.actualMinutes - row.targetMinutes,
  }));

  const tonnageRollup = Object.values(
    logs.reduce((acc, log) => {
      const key = log.project_id || 'unassigned';
      if (!acc[key]) acc[key] = { project_id: log.project_id, pieces: 0, actualMinutes: 0 };
      acc[key].pieces += 1;
      acc[key].actualMinutes += log.elapsed_minutes || 0;
      return acc;
    }, {})
  ).map((row) => {
    const project = projects.find((p) => p.id === row.project_id);
    const hours = row.actualMinutes / 60;
    return {
      ...row,
      estimatedTons: project?.estimated_tons || null,
      hoursConsumed: hours,
      hoursPerTon: project?.estimated_tons ? (hours / project.estimated_tons) : null,
    };
  });

  if (loading) return <div className="flex items-center justify-center h-96"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>;

  return (
    <div className="p-6 w-full max-w-none space-y-4 animate-fade-in">
      <PageHeader title="Shop Floor Efficiency" subtitle="Piece-level production performance across the shop." icon={Gauge} />

      <Tabs defaultValue="leaderboard">
        <TabsList className="mb-4">
          <TabsTrigger value="leaderboard">Employee Leaderboard</TabsTrigger>
          <TabsTrigger value="variance">Piece Variance Matrix</TabsTrigger>
          <TabsTrigger value="tonnage">Project Tonnage Rollup</TabsTrigger>
        </TabsList>

        <TabsContent value="leaderboard">
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr><th className="p-3 font-medium">Employee</th><th className="p-3 font-medium">Pieces</th><th className="p-3 font-medium">Actual Min</th><th className="p-3 font-medium">Target Min</th><th className="p-3 font-medium">Efficiency</th></tr>
              </thead>
              <tbody>
                {leaderboard.length === 0 ? (
                  <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No completed pieces logged yet.</td></tr>
                ) : leaderboard.map((row) => (
                  <tr key={row.employee_id} className="border-t">
                    <td className="p-3 font-medium">{employeeName(row.employee_id)}</td>
                    <td className="p-3">{row.pieces}</td>
                    <td className="p-3">{row.actualMinutes}</td>
                    <td className="p-3">{row.targetMinutes}</td>
                    <td className={`p-3 font-semibold ${efficiencyColor(row.efficiencyPct || 0)}`}>{row.efficiencyPct != null ? `${row.efficiencyPct}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="variance">
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr><th className="p-3 font-medium">Material Profile</th><th className="p-3 font-medium">Pieces</th><th className="p-3 font-medium">Actual Min</th><th className="p-3 font-medium">Target Min</th><th className="p-3 font-medium">Variance</th></tr>
              </thead>
              <tbody>
                {varianceMatrix.length === 0 ? (
                  <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No completed pieces logged yet.</td></tr>
                ) : varianceMatrix.map((row) => (
                  <tr key={row.material_profile_type} className="border-t">
                    <td className="p-3 font-medium">{row.material_profile_type.replace(/_/g, ' ')}</td>
                    <td className="p-3">{row.pieces}</td>
                    <td className="p-3">{row.actualMinutes}</td>
                    <td className="p-3">{row.targetMinutes}</td>
                    <td className={`p-3 font-semibold ${row.varianceMinutes > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{row.varianceMinutes > 0 ? '+' : ''}{row.varianceMinutes} min</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="tonnage">
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr><th className="p-3 font-medium">Project</th><th className="p-3 font-medium">Pieces</th><th className="p-3 font-medium">Labor Hours Consumed</th><th className="p-3 font-medium">Estimated Tons</th><th className="p-3 font-medium">Hours / Ton</th></tr>
              </thead>
              <tbody>
                {tonnageRollup.length === 0 ? (
                  <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No completed pieces logged yet.</td></tr>
                ) : tonnageRollup.map((row) => (
                  <tr key={row.project_id || 'unassigned'} className="border-t">
                    <td className="p-3 font-medium">{projectLabel(row.project_id)}</td>
                    <td className="p-3">{row.pieces}</td>
                    <td className="p-3">{row.hoursConsumed.toFixed(1)}</td>
                    <td className="p-3">{row.estimatedTons ?? '—'}</td>
                    <td className="p-3">{row.hoursPerTon != null ? row.hoursPerTon.toFixed(2) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
