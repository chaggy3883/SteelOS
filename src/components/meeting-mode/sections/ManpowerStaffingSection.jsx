import React, { useCallback, useEffect, useState } from 'react';
import { loadManpowerAgendaData } from '@/lib/manpowerData';
import ManpowerSection from '@/components/meeting-mode/ManpowerSection';

// No cost/pricing entity is ever touched by loadManpowerAgendaData() — just
// Project, employees, CrewAssignment, time_off_requests, erection_fleet_assets.
export default function ManpowerStaffingSection({ currentUser }) {
  const [manpowerData, setManpowerData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeProjectId, setActiveProjectId] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const data = await loadManpowerAgendaData();
      setManpowerData(data);
      setActiveProjectId((current) => current || data.projectData[0]?.project.id || null);
    } catch (e) {
      setManpowerData({ projectData: [], employees: [], certifications: [], assignments: [], leaveRequests: [], projectsById: new Map(), assets: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading || !manpowerData) {
    return <div className="h-full flex items-center justify-center"><p className="text-2xl text-slate-400">Loading manpower data…</p></div>;
  }

  if (manpowerData.projectData.length === 0) {
    return <div className="h-full flex items-center justify-center"><p className="text-2xl text-slate-400">No active jobs to review right now.</p></div>;
  }

  const active = manpowerData.projectData.find((d) => d.project.id === activeProjectId) || manpowerData.projectData[0];

  return (
    <div className="h-full flex">
      <div className="w-64 flex-shrink-0 border-r border-slate-800 overflow-y-auto py-2">
        {manpowerData.projectData.map(({ project }) => (
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
        <ManpowerSection
          project={active.project}
          staffing={active.staffing}
          assignments={active.assignments}
          manpowerData={manpowerData}
          currentUser={currentUser}
          onDataChange={refresh}
        />
      </div>
    </div>
  );
}
