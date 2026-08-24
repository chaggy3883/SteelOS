import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, FolderKanban, AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getMyProjects, activeProjectsOnly, getProjectPieceStats, getProjectIssueFlags } from '@/lib/salesDashboardData';

const money = (n) => `$${(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default function MyProjectsWidget({ salesmanId }) {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [pieceStats, setPieceStats] = useState(new Map());
  const [issueFlags, setIssueFlags] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [issuesModalProject, setIssuesModalProject] = useState(null);

  useEffect(() => {
    setLoading(true);
    (async () => {
      const all = await getMyProjects(salesmanId);
      const active = activeProjectsOnly(all);
      setProjects(active);
      const ids = active.map((p) => p.id);
      const [stats, flags] = await Promise.all([getProjectPieceStats(ids), getProjectIssueFlags(ids)]);
      setPieceStats(stats);
      setIssueFlags(flags);
    })().catch(() => { setProjects([]); }).finally(() => setLoading(false));
  }, [salesmanId]);

  const rows = useMemo(() => projects.map((p) => ({
    project: p,
    stats: pieceStats.get(p.id) || { pctComplete: null, nextShipDate: null },
    flags: issueFlags.get(p.id) || { rejectedPieces: false, openRfiCount: 0, qaFailed: false, any: false },
  })), [projects, pieceStats, issueFlags]);

  return (
    <div className="steel-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <FolderKanban className="w-4 h-4 text-primary" />
        <h3 className="font-semibold">My Active Projects</h3>
      </div>

      {loading ? (
        <div className="py-8 text-center"><Loader2 className="w-5 h-5 mx-auto animate-spin text-muted-foreground" /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No active projects yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left py-1.5 pr-3">Project</th>
                <th className="text-left py-1.5 pr-3">Customer</th>
                <th className="text-right py-1.5 pr-3">Bid Amount</th>
                <th className="text-right py-1.5 pr-3">% Complete</th>
                <th className="text-left py-1.5 pr-3">Ship Date</th>
                <th className="text-left py-1.5 pr-3">Issues</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ project, stats, flags }) => (
                <tr key={project.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-1.5 pr-3">
                    <button type="button" className="font-medium hover:underline text-left" onClick={() => navigate(`/projects/${project.id}`)}>
                      {project.project_number} — {project.name}
                    </button>
                  </td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{project.customer_name}</td>
                  <td className="py-1.5 pr-3 text-right font-mono">{money(project.contract_value)}</td>
                  <td className="py-1.5 pr-3 text-right font-mono">{stats.pctComplete != null ? `${stats.pctComplete}%` : '—'}</td>
                  <td className="py-1.5 pr-3">{stats.nextShipDate || '—'}</td>
                  <td className="py-1.5 pr-3">
                    {flags.any ? (
                      <button
                        type="button"
                        onClick={() => setIssuesModalProject({ project, flags })}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 bg-red-500/10 rounded-full px-2 py-0.5 hover:bg-red-500/20"
                      >
                        <AlertTriangle className="w-3 h-3" />Issues
                      </button>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">Clear</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!issuesModalProject} onOpenChange={(o) => !o && setIssuesModalProject(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Issues — {issuesModalProject?.project?.name}</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2 text-sm">
            {issuesModalProject?.flags?.rejectedPieces && (
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <div><p className="font-medium">Rejected pieces in the shop</p><p className="text-xs text-muted-foreground">Contact the Shop Manager for rework status.</p></div>
              </div>
            )}
            {issuesModalProject?.flags?.openRfiCount > 0 && (
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <div><p className="font-medium">{issuesModalProject.flags.openRfiCount} open RFI{issuesModalProject.flags.openRfiCount === 1 ? '' : 's'}</p><p className="text-xs text-muted-foreground">Contact the Project Manager.</p></div>
              </div>
            )}
            {issuesModalProject?.flags?.qaFailed && (
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <div><p className="font-medium">A QA inspection failed on this project</p><p className="text-xs text-muted-foreground">Contact Quality/Inspection.</p></div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
