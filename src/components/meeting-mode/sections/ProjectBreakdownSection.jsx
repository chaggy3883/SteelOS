import React, { useEffect, useState } from 'react';
import { loadJobCostAgendaData } from '@/lib/meetingModeData';
import JobCostByJobSlide from '@/components/meeting-mode/JobCostByJobSlide';

// Pricing-bearing section — only mounted/fetched at all when 'project_breakdown'
// is one of this specific meeting's selected sections (see MeetingModeSession.jsx).
// Reuses JobCostByJobSlide + loadJobCostAgendaData verbatim from the previous
// Meeting Mode implementation; only the surrounding nav-by-project list is new.
export default function ProjectBreakdownSection() {
  const [agendaData, setAgendaData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeProjectId, setActiveProjectId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadJobCostAgendaData()
      .then((data) => {
        if (cancelled) return;
        setAgendaData(data);
        if (data[0]) setActiveProjectId(data[0].project.id);
      })
      .catch(() => { if (!cancelled) setAgendaData([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <div className="h-full flex items-center justify-center"><p className="text-2xl text-slate-400">Loading project breakdown…</p></div>;
  }

  if (agendaData.length === 0) {
    return <div className="h-full flex items-center justify-center"><p className="text-2xl text-slate-400">No active jobs to review right now.</p></div>;
  }

  const active = agendaData.find((d) => d.project.id === activeProjectId) || agendaData[0];

  return (
    <div className="h-full flex">
      <div className="w-64 flex-shrink-0 border-r border-slate-800 overflow-y-auto py-2">
        {agendaData.map(({ project }) => (
          <button
            key={project.id}
            type="button"
            onClick={() => setActiveProjectId(project.id)}
            aria-current={project.id === active.project.id ? 'true' : undefined}
            className={`w-full text-left px-4 py-3 border-l-4 transition-colors ${
              project.id === active.project.id ? 'border-blue-500 bg-slate-900 text-white' : 'border-transparent text-slate-400 hover:text-white hover:bg-slate-900/50'
            }`}
          >
            <div className="text-sm font-medium truncate">{project.name}</div>
            <div className="text-xs text-slate-500 truncate">{project.project_number}</div>
          </button>
        ))}
      </div>
      <div className="flex-1 min-w-0">
        <JobCostByJobSlide project={active.project} rows={active.rows} />
      </div>
    </div>
  );
}
