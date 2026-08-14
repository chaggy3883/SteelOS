import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { X, Lock, ChevronUp, ChevronDown } from 'lucide-react';
import { normalizeRoleName } from '@/components/dashboard/rbacConfig';
import { isAdminUser, getEffectiveCompany } from '@/lib/tenantContext';
import { getAvailableMeetingTypes, loadJobCostAgendaData } from '@/lib/meetingModeData';
import JobCostByJobSlide from '@/components/meeting-mode/JobCostByJobSlide';

// Who actually runs recurring meetings in this app today. Financial/job-cost
// data is the only agenda content that exists so far, so this mirrors the
// financial-page role lists in Accounting.jsx/Legal.jsx rather than
// inventing a new tier. admin/super_admin bypass via isAdminUser() below,
// same convention as those pages.
const MEETING_MODE_ROLES = ['project_manager', 'shop_manager', 'finance_department', 'controller', 'president', 'ceo'];

// Every agenda section built here is universal (job cost applies to both
// packs per the spec this was built against) — meetingType is threaded
// through anyway so a future Manpower-only or Project-Review-only section
// can filter on it without reworking this function's callers.
function buildAgendaSections(meetingType, jobCostAgendaData) {
  if (jobCostAgendaData.length === 0) {
    return [{ id: 'no-jobs', navLabel: 'No Active Jobs', kind: 'empty' }];
  }
  return jobCostAgendaData.map(({ project, rows }) => ({
    id: `job-cost-${project.id}`,
    navLabel: project.name,
    navSubLabel: project.project_number,
    kind: 'job-cost',
    project,
    rows,
  }));
}

export default function MeetingMode() {
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [company, setCompany] = useState(null);
  const [meetingType, setMeetingType] = useState(null);
  const [loadingAgenda, setLoadingAgenda] = useState(false);
  const [jobCostAgendaData, setJobCostAgendaData] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    // Full-bleed presentation surface: force dark/high-contrast regardless
    // of the app's own light/dark toggle (that state lives in AppLayout,
    // which doesn't render here), same trick Login.jsx uses. Restored on
    // unmount so leaving Meeting Mode doesn't change the user's normal
    // in-app theme.
    const hadDark = document.documentElement.classList.contains('dark');
    document.documentElement.classList.add('dark');
    return () => { if (!hadDark) document.documentElement.classList.remove('dark'); };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const me = await db.auth.me();
        const roles = (me?.roles || ['user']).map(normalizeRoleName);
        setAllowed(isAdminUser(me) || roles.some((r) => MEETING_MODE_ROLES.includes(r)));
      } catch (e) {
        setAllowed(false);
      } finally {
        setCheckingAccess(false);
      }
    })();
    getEffectiveCompany().then(setCompany).catch(() => setCompany(null));
  }, []);

  const meetingTypes = useMemo(() => getAvailableMeetingTypes(company), [company]);

  const selectMeetingType = useCallback(async (typeId) => {
    setMeetingType(typeId);
    setActiveIndex(0);
    setLoadingAgenda(true);
    try {
      const data = await loadJobCostAgendaData();
      setJobCostAgendaData(data);
    } catch (e) {
      setJobCostAgendaData([]);
    } finally {
      setLoadingAgenda(false);
    }
  }, []);

  const sections = useMemo(() => (meetingType ? buildAgendaSections(meetingType, jobCostAgendaData) : []), [meetingType, jobCostAgendaData]);

  const goTo = useCallback((index) => {
    setActiveIndex((current) => {
      if (sections.length === 0) return current;
      return ((index % sections.length) + sections.length) % sections.length;
    });
  }, [sections.length]);

  useEffect(() => {
    if (!meetingType) return;
    const handleKeyDown = (e) => {
      // Don't hijack navigation while a drilldown dialog is reading arrow
      // keys or anything else — Radix marks its open dialog content with
      // role="dialog" + data-state="open".
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); goTo(activeIndex + 1); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); goTo(activeIndex - 1); }
      else if (e.key === 'Escape') { e.preventDefault(); setMeetingType(null); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [meetingType, activeIndex, goTo]);

  if (checkingAccess) {
    return <div className="fixed inset-0 bg-slate-950" />;
  }

  if (!allowed) {
    return (
      <div className="fixed inset-0 bg-slate-950 flex items-center justify-center text-white">
        <div className="text-center max-w-md px-6">
          <Lock className="w-10 h-10 mx-auto mb-4 text-slate-400" />
          <h1 className="text-2xl font-semibold mb-2">Meeting Mode Restricted</h1>
          <p className="text-slate-400">
            Meeting Mode is available to Project Manager, Shop Manager, Finance, Controller, and executive roles.
          </p>
          <Link to="/" className="inline-block mt-6 text-blue-400 hover:text-white underline">Back to Dashboard</Link>
        </div>
      </div>
    );
  }

  if (!meetingType) {
    return (
      <div className="fixed inset-0 bg-slate-950 text-white flex flex-col">
        <div className="flex items-center justify-between px-8 py-6">
          <h1 className="text-2xl font-semibold">Meeting Mode</h1>
          <Link to="/" className="text-slate-400 hover:text-white flex items-center gap-1.5">
            <X className="w-5 h-5" /> Exit
          </Link>
        </div>
        <div className="flex-1 flex items-center justify-center px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl w-full">
            {meetingTypes.map((type) => (
              <button
                key={type.id}
                type="button"
                disabled={!type.available}
                onClick={() => selectMeetingType(type.id)}
                className={`text-left rounded-2xl border-2 p-8 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                  type.available
                    ? 'border-slate-700 hover:border-blue-500 hover:bg-slate-900 cursor-pointer'
                    : 'border-slate-800 opacity-50 cursor-not-allowed'
                }`}
              >
                <h2 className="text-3xl font-bold mb-2">{type.label}</h2>
                <p className="text-lg text-slate-400 flex items-center gap-1.5">
                  {!type.available && <Lock className="w-4 h-4" aria-hidden="true" />}
                  {type.packHint}
                </p>
                {!type.available && (
                  <p className="text-sm text-amber-400 mt-3">Not included in your company's current pack</p>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const activeSection = sections[activeIndex];

  return (
    <div className="fixed inset-0 bg-slate-950 text-white flex">
      {/* Section list — always visible, per-section keyboard/click nav */}
      <div className="w-72 flex-shrink-0 border-r border-slate-800 flex flex-col">
        <div className="px-5 py-5 border-b border-slate-800">
          <p className="text-sm text-slate-400 uppercase tracking-wide">{meetingTypes.find((t) => t.id === meetingType)?.label} Meeting</p>
          <button type="button" onClick={() => setMeetingType(null)} className="text-xs text-blue-400 hover:text-white mt-1 underline">
            Change meeting type
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {sections.map((section, idx) => (
            <button
              key={section.id}
              type="button"
              onClick={() => goTo(idx)}
              aria-current={idx === activeIndex ? 'true' : undefined}
              className={`w-full text-left px-5 py-3 border-l-4 transition-colors ${
                idx === activeIndex ? 'border-blue-500 bg-slate-900 text-white' : 'border-transparent text-slate-400 hover:text-white hover:bg-slate-900/50'
              }`}
            >
              <div className="text-base font-medium truncate">{section.navLabel}</div>
              {section.navSubLabel && <div className="text-xs text-slate-500 truncate">{section.navSubLabel}</div>}
            </button>
          ))}
        </div>
        <div className="px-5 py-4 border-t border-slate-800 flex items-center justify-between">
          <div className="flex gap-2">
            <button type="button" onClick={() => goTo(activeIndex - 1)} aria-label="Previous section" className="p-2 rounded hover:bg-slate-800">
              <ChevronUp className="w-4 h-4" />
            </button>
            <button type="button" onClick={() => goTo(activeIndex + 1)} aria-label="Next section" className="p-2 rounded hover:bg-slate-800">
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
          <Link to="/" className="text-slate-400 hover:text-white flex items-center gap-1.5 text-sm">
            <X className="w-4 h-4" /> Exit
          </Link>
        </div>
      </div>

      {/* Active slide */}
      <div className="flex-1 min-w-0">
        {loadingAgenda ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-2xl text-slate-400">Loading job cost data…</p>
          </div>
        ) : activeSection?.kind === 'job-cost' ? (
          <JobCostByJobSlide project={activeSection.project} rows={activeSection.rows} />
        ) : (
          <div className="h-full flex items-center justify-center">
            <p className="text-2xl text-slate-400">No active jobs to review right now.</p>
          </div>
        )}
      </div>
    </div>
  );
}
