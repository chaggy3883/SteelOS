import React, { useEffect, useState } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { db } from '@/api/apiClient';
import { Loader2, Gauge } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { computeEfficiencyPct, normalizeTargetMinutes } from '@/lib/shopOpsMetrics';
import { getEffectiveCompany, isSuperAdmin, isImpersonating } from '@/lib/tenantContext';
import { hasModule } from '@/lib/moduleEntitlement';
import ModuleLocked from '@/components/shared/ModuleLocked';

const efficiencyColor = (pct) => {
  if (pct >= 100) return 'text-emerald-600';
  if (pct >= 85) return 'text-amber-600';
  return 'text-red-600';
};

export default function ShopEfficiency() {
  useDocumentTitle('SteelOS — Shop Efficiency');
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [projects, setProjects] = useState([]);
  const [moduleAllowed, setModuleAllowed] = useState(false);
  const [checkingModuleAccess, setCheckingModuleAccess] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [logDialog, setLogDialog] = useState(null);
  const openLogDialog = (title, rows) => setLogDialog({ title, rows });

  useEffect(() => { loadData(); }, []);
  useEffect(() => {
    db.auth.me().then((me) => setCurrentUser(me || null)).catch(() => setCurrentUser(null));
    getEffectiveCompany()
      .then((company) => setModuleAllowed(hasModule(company, '/shop-efficiency')))
      .catch(() => setModuleAllowed(false))
      .finally(() => setCheckingModuleAccess(false));
  }, []);

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

  // actualMinutes/targetMinutes only accumulate over pieces that HAVE a
  // target (missingTarget tracks the rest) — mixing an untimed piece's real
  // elapsed time into a sum whose matching target never landed would drag
  // the ratio down for reasons that have nothing to do with performance.
  const accumulateTargetedTotals = (acc, log) => {
    acc.pieces += 1;
    const target = normalizeTargetMinutes(log.target_minutes);
    if (target == null) {
      acc.missingTarget += 1;
    } else {
      acc.actualMinutes += log.elapsed_minutes || 0;
      acc.targetMinutes += target;
    }
    return acc;
  };

  const leaderboard = Object.values(
    logs.reduce((acc, log) => {
      const key = log.employee_id;
      if (!acc[key]) acc[key] = { employee_id: key, pieces: 0, actualMinutes: 0, targetMinutes: 0, missingTarget: 0 };
      accumulateTargetedTotals(acc[key], log);
      return acc;
    }, {})
  ).map((row) => ({
    ...row,
    efficiencyPct: computeEfficiencyPct(row.actualMinutes, row.targetMinutes),
  })).sort((a, b) => (b.efficiencyPct || 0) - (a.efficiencyPct || 0));

  const varianceMatrix = Object.values(
    logs.reduce((acc, log) => {
      const key = log.material_profile_type || 'Other';
      if (!acc[key]) acc[key] = { material_profile_type: key, pieces: 0, actualMinutes: 0, targetMinutes: 0, missingTarget: 0 };
      accumulateTargetedTotals(acc[key], log);
      return acc;
    }, {})
  ).map((row) => ({
    ...row,
    varianceMinutes: row.targetMinutes > 0 ? row.actualMinutes - row.targetMinutes : null,
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

  const isPlatformOperatorView = isSuperAdmin(currentUser) && !isImpersonating();
  const showModule = moduleAllowed || isPlatformOperatorView;

  if (loading || checkingModuleAccess) return <div className="flex items-center justify-center h-96"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>;

  // Route guard — a direct URL to /shop-efficiency can't bypass the nav's
  // module-pack filtering. Shop floor efficiency reporting is Fabricator +
  // Enterprise Connect only (see modulePacks.js); an Erector-pack company
  // has no shop performance to report on, so none of this applies to them.
  if (!showModule) {
    return <ModuleLocked modulePath="/shop-efficiency" title="Shop Floor Efficiency Not Included" />;
  }

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
                  <tr
                    key={row.employee_id}
                    onClick={() => openLogDialog(
                      `${employeeName(row.employee_id)} — Completed Pieces`,
                      logs.filter((l) => l.employee_id === row.employee_id).map((l) => ({ label: l.piece_mark || l.id, sublabel: `${l.elapsed_minutes || 0}m actual${normalizeTargetMinutes(l.target_minutes) != null ? ` / ${normalizeTargetMinutes(l.target_minutes)}m target` : ' / no target'}` }))
                    )}
                    className="border-t hover:bg-muted/40 cursor-pointer"
                  >
                    <td className="p-3 font-medium">{employeeName(row.employee_id)}</td>
                    <td className="p-3">
                      {row.pieces}
                      {row.missingTarget > 0 && <span className="text-xs text-muted-foreground"> ({row.missingTarget} no target)</span>}
                    </td>
                    <td className="p-3">{row.actualMinutes}</td>
                    <td className="p-3">{row.targetMinutes > 0 ? row.targetMinutes : '—'}</td>
                    <td className={`p-3 font-semibold ${row.efficiencyPct != null ? efficiencyColor(row.efficiencyPct) : 'text-muted-foreground'}`}>
                      {row.targetMinutes === 0 ? 'No target set' : row.efficiencyPct != null ? `${row.efficiencyPct}%` : '—'}
                    </td>
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
                  <tr
                    key={row.material_profile_type}
                    onClick={() => openLogDialog(
                      `${row.material_profile_type.replace(/_/g, ' ')} — Completed Pieces`,
                      logs.filter((l) => (l.material_profile_type || 'Other') === row.material_profile_type).map((l) => ({ label: l.piece_mark || l.id, sublabel: `${employeeName(l.employee_id)} • ${l.elapsed_minutes || 0}m` }))
                    )}
                    className="border-t hover:bg-muted/40 cursor-pointer"
                  >
                    <td className="p-3 font-medium">{row.material_profile_type.replace(/_/g, ' ')}</td>
                    <td className="p-3">
                      {row.pieces}
                      {row.missingTarget > 0 && <span className="text-xs text-muted-foreground"> ({row.missingTarget} no target)</span>}
                    </td>
                    <td className="p-3">{row.actualMinutes}</td>
                    <td className="p-3">{row.targetMinutes > 0 ? row.targetMinutes : '—'}</td>
                    <td className={`p-3 font-semibold ${row.varianceMinutes == null ? 'text-muted-foreground' : row.varianceMinutes > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {row.varianceMinutes == null ? 'No target set' : `${row.varianceMinutes > 0 ? '+' : ''}${row.varianceMinutes} min`}
                    </td>
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
                  <tr
                    key={row.project_id || 'unassigned'}
                    onClick={() => openLogDialog(
                      `${projectLabel(row.project_id)} — Completed Pieces`,
                      logs.filter((l) => (l.project_id || 'unassigned') === (row.project_id || 'unassigned')).map((l) => ({ label: l.piece_mark || l.id, sublabel: `${employeeName(l.employee_id)} • ${l.elapsed_minutes || 0}m` }))
                    )}
                    className="border-t hover:bg-muted/40 cursor-pointer"
                  >
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

      <Dialog open={!!logDialog} onOpenChange={(o) => !o && setLogDialog(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{logDialog?.title}</DialogTitle></DialogHeader>
          {(logDialog?.rows || []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No completed pieces on file.</p>
          ) : (
            <div className="space-y-1.5">
              {logDialog.rows.map((r, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg border border-border p-2.5 text-sm">
                  <span className="font-medium">{r.label}</span>
                  <span className="text-xs text-muted-foreground">{r.sublabel}</span>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLogDialog(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
