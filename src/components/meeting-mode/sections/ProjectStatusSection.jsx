import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { db } from '@/api/apiClient';
import { getLiveProjects } from '@/lib/meetingModeData';
import ProjectDetailModal from '@/components/meeting-mode/ProjectDetailModal';

const STAGE_LABELS = {
  lead: 'Lead', estimating: 'Estimating', awarded: 'Awarded', engineering: 'Engineering',
  fabrication: 'Fabrication', erection: 'Erection', complete: 'Complete', cancelled: 'Cancelled',
};

const OPEN_RFI_STATUSES = ['draft', 'submitted', 'under_review'];

// Operational-only project status for a Shop Meeting-style section — stage,
// schedule, and open blockers (RFIs). Deliberately fetches ONLY Project and
// RFI here — no CostCode/JobCostLedgerEntry/Subcontract/SubcontractPayApp/Bid
// ever enter this component's state, so there is no cost or pricing figure
// anywhere in this section to leak, by construction rather than by hiding.
export default function ProjectStatusSection() {
  const [projects, setProjects] = useState([]);
  const [openRfiCounts, setOpenRfiCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [detailProject, setDetailProject] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [liveProjects, allRfis] = await Promise.all([
          getLiveProjects(),
          db.entities.RFI.list('-created_date', 1000),
        ]);
        if (cancelled) return;
        const openRfis = allRfis.filter((rfi) => OPEN_RFI_STATUSES.includes(rfi.status));
        const counts = {};
        openRfis.forEach((rfi) => {
          counts[rfi.project_id] = (counts[rfi.project_id] || 0) + 1;
        });
        setProjects(liveProjects);
        setOpenRfiCounts(counts);
      } catch (e) {
        if (!cancelled) { setProjects([]); setOpenRfiCounts({}); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <div className="h-full flex items-center justify-center"><p className="text-2xl text-slate-400">Loading project status…</p></div>;
  }

  if (projects.length === 0) {
    return <div className="h-full flex items-center justify-center"><p className="text-2xl text-slate-400">No active jobs to review right now.</p></div>;
  }

  return (
    <div className="h-full overflow-y-auto p-8">
      <h2 className="text-2xl font-semibold mb-6">Project Status</h2>
      <div className="space-y-2">
        {projects.map((project) => {
          const blockers = openRfiCounts[project.id] || 0;
          return (
            <button
              key={project.id}
              type="button"
              onClick={() => setDetailProject(project)}
              className="w-full text-left flex items-center justify-between gap-4 rounded-lg border border-slate-800 hover:border-slate-600 hover:bg-slate-900/50 px-5 py-4 transition-colors"
            >
              <div className="min-w-0">
                <p className="text-lg font-medium truncate">{project.name}</p>
                <p className="text-sm text-slate-500 truncate">{project.project_number}</p>
              </div>
              <div className="flex items-center gap-6 flex-shrink-0 text-sm">
                <div className="text-right">
                  <p className="text-slate-500 text-xs uppercase tracking-wide">Stage</p>
                  <p className="font-medium">{STAGE_LABELS[project.status] || project.status || '—'}</p>
                </div>
                <div className="text-right">
                  <p className="text-slate-500 text-xs uppercase tracking-wide">Schedule</p>
                  <p className="font-medium">{project.start_date || '—'} → {project.completion_date || '—'}</p>
                  {(project.schedule_risk || 0) > 50 && (
                    <p className="text-xs font-semibold text-amber-400 mt-0.5">At Risk</p>
                  )}
                </div>
                <div className="text-right w-24">
                  <p className="text-slate-500 text-xs uppercase tracking-wide">Blockers</p>
                  {blockers > 0 ? (
                    <p className="font-semibold text-amber-400 flex items-center justify-end gap-1"><AlertTriangle className="w-4 h-4" />{blockers} open RFI{blockers === 1 ? '' : 's'}</p>
                  ) : (
                    <p className="text-slate-500">None</p>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <ProjectDetailModal open={!!detailProject} onOpenChange={(o) => !o && setDetailProject(null)} project={detailProject} />
    </div>
  );
}
