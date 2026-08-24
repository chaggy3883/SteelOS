import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, FileEdit } from 'lucide-react';
import { getMyProjects, getChangeOrdersForProjects } from '@/lib/salesDashboardData';

const TERMINAL_STATUSES = ['Approved', 'Rejected', 'Void'];
const daysOpen = (co) => {
  if (!co.date_submitted || TERMINAL_STATUSES.includes(co.status)) return null;
  const days = Math.floor((Date.now() - new Date(co.date_submitted).getTime()) / (1000 * 60 * 60 * 24));
  return Number.isFinite(days) && days >= 0 ? days : null;
};
const assignedTo = (co) => (co.status === 'Draft' || co.status === 'Submitted to GC' ? 'PM / Estimating' : '—');
const money = (n) => `$${(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default function ChangeOrdersWidget({ salesmanId }) {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [cos, setCos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [awaitingOnly, setAwaitingOnly] = useState(false);
  const [projectFilter, setProjectFilter] = useState('');

  useEffect(() => {
    setLoading(true);
    (async () => {
      const myProjects = await getMyProjects(salesmanId);
      setProjects(myProjects);
      const rows = await getChangeOrdersForProjects(myProjects.map((p) => p.id));
      setCos(rows);
    })().catch(() => setCos([])).finally(() => setLoading(false));
  }, [salesmanId]);

  const projectName = (id) => projects.find((p) => p.id === id)?.name || id;

  const filtered = useMemo(() => cos.filter((co) => {
    if (awaitingOnly && co.status !== 'Submitted to GC') return false;
    if (projectFilter && co.project_id !== projectFilter) return false;
    return true;
  }), [cos, awaitingOnly, projectFilter]);

  return (
    <div className="steel-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <FileEdit className="w-4 h-4 text-primary" />
        <h3 className="font-semibold">Change Orders</h3>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3 text-xs">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={awaitingOnly} onChange={(e) => setAwaitingOnly(e.target.checked)} />Awaiting decision only
        </label>
        <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="h-7 rounded-md border border-input bg-input/40 px-1.5">
          <option value="">All Projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="py-8 text-center"><Loader2 className="w-5 h-5 mx-auto animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No change orders match.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left py-1.5 pr-3">Project</th>
                <th className="text-left py-1.5 pr-3">CO #</th>
                <th className="text-left py-1.5 pr-3">Status</th>
                <th className="text-right py-1.5 pr-3">Revenue Impact</th>
                <th className="text-right py-1.5 pr-3">Days Open</th>
                <th className="text-left py-1.5 pr-3">Assigned To</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((co) => (
                <tr key={co.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-1.5 pr-3">
                    <button type="button" className="hover:underline text-left" onClick={() => navigate(`/projects/change-orders?open=${co.id}`)}>{projectName(co.project_id)}</button>
                  </td>
                  <td className="py-1.5 pr-3">
                    <button type="button" className="font-medium hover:underline text-primary" onClick={() => navigate(`/projects/change-orders?open=${co.id}`)}>{co.change_order_id}</button>
                  </td>
                  <td className="py-1.5 pr-3">{co.status}</td>
                  <td className="py-1.5 pr-3 text-right font-mono">{money(co.cost_impact)}</td>
                  <td className="py-1.5 pr-3 text-right font-mono">{daysOpen(co) ?? '—'}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{assignedTo(co)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
