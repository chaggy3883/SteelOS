import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getMyProjects, getRfisForProjects, OPEN_RFI_STATUSES } from '@/lib/salesDashboardData';

const STATUS_LABELS = { draft: 'Draft', submitted: 'Open', under_review: 'Under Review', answered: 'Answered', closed: 'Closed', void: 'Void' };
const ASSIGNED_ROLE_LABELS = {
  salesman: 'PM / QA / Shop / Estimating',
  project_manager: 'Salesman',
  inspector: 'Salesman',
  estimator: 'Salesman',
  other: 'Salesman',
};

export default function RecentRfisWidget({ salesmanId }) {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [rfis, setRfis] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openOnly, setOpenOnly] = useState(true);
  const [projectFilter, setProjectFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    setLoading(true);
    (async () => {
      const myProjects = await getMyProjects(salesmanId);
      setProjects(myProjects);
      const rows = await getRfisForProjects(myProjects.map((p) => p.id));
      setRfis(rows);
    })().catch(() => setRfis([])).finally(() => setLoading(false));
  }, [salesmanId]);

  const projectName = (id) => projects.find((p) => p.id === id)?.name || id;

  const filtered = useMemo(() => rfis.filter((r) => {
    if (openOnly && !OPEN_RFI_STATUSES.includes(r.status)) return false;
    if (projectFilter && r.project_id !== projectFilter) return false;
    if (statusFilter && r.status !== statusFilter) return false;
    return true;
  }), [rfis, openOnly, projectFilter, statusFilter]);

  return (
    <div className="steel-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <MessageSquare className="w-4 h-4 text-primary" />
        <h3 className="font-semibold">Recent RFIs</h3>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3 text-xs">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />Open only
        </label>
        <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="h-7 rounded-md border border-input bg-input/40 px-1.5">
          <option value="">All Projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-7 rounded-md border border-input bg-input/40 px-1.5">
          <option value="">All Statuses</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="py-8 text-center"><Loader2 className="w-5 h-5 mx-auto animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No RFIs match.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left py-1.5 pr-3">Project</th>
                <th className="text-left py-1.5 pr-3">RFI #</th>
                <th className="text-left py-1.5 pr-3">Status</th>
                <th className="text-left py-1.5 pr-3">Assigned To</th>
                <th className="text-left py-1.5 pr-3">Created</th>
                <th className="text-left py-1.5 pr-3">Due</th>
                <th className="text-right py-1.5 pr-3">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-1.5 pr-3">
                    <button type="button" className="hover:underline text-left" onClick={() => navigate(`/rfis?open=${r.id}`)}>{projectName(r.project_id)}</button>
                  </td>
                  <td className="py-1.5 pr-3">
                    <button type="button" className="font-medium hover:underline text-primary" onClick={() => navigate(`/rfis?open=${r.id}`)}>{r.rfi_number || r.id.slice(0, 8)}</button>
                  </td>
                  <td className="py-1.5 pr-3">{STATUS_LABELS[r.status] || r.status}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{ASSIGNED_ROLE_LABELS[r.created_by_role] || '—'}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{r.date_submitted || r.created_date?.slice(0, 10)}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{r.date_required || '—'}</td>
                  <td className="py-1.5 pr-3 text-right">
                    {r.pending_salesman_response && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate(`/rfis?open=${r.id}`)}>Respond</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
