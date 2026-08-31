import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Lock, ChevronUp, ChevronDown, X } from 'lucide-react';
import { db } from '@/api/apiClient';
import { normalizeRoleName } from '@/components/dashboard/rbacConfig';
import { isAdminUser, getEffectiveCompany } from '@/lib/tenantContext';
import { getAvailableSections } from '@/lib/meetingModeSections';
import { loadEmployeeRoster } from '@/lib/manpowerData';
import MeetingSectionNotesPanel from '@/components/meeting-mode/MeetingSectionNotesPanel';
import UnsavedChangesModal from '@/components/meeting-mode/UnsavedChangesModal';
import ProjectStatusSection from '@/components/meeting-mode/sections/ProjectStatusSection';
import ManpowerStaffingSection from '@/components/meeting-mode/sections/ManpowerStaffingSection';
import DwellReportSection from '@/components/meeting-mode/sections/DwellReportSection';
import ProjectBreakdownSection from '@/components/meeting-mode/sections/ProjectBreakdownSection';
import EstimatingUpdatesSection from '@/components/meeting-mode/sections/EstimatingUpdatesSection';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

const MEETING_MODE_ROLES = ['project_manager', 'shop_manager', 'finance_department', 'controller', 'president', 'ceo'];

// Each section component owns its own data fetch in its own effect — none of
// them are prefetched here — so a pricing-bearing section (project_breakdown,
// estimating_updates) never runs a query unless it's actually one of THIS
// meeting's chosen sections. See src/lib/meetingModeSections.js.
function renderSectionBody(sectionKey, { company, currentUser }) {
  switch (sectionKey) {
    case 'project_status': return <ProjectStatusSection />;
    case 'manpower': return <ManpowerStaffingSection currentUser={currentUser} />;
    case 'dwell_report': return <DwellReportSection />;
    case 'project_breakdown': return <ProjectBreakdownSection />;
    case 'estimating_updates': return <EstimatingUpdatesSection company={company} currentUser={currentUser} />;
    default: return <div className="h-full flex items-center justify-center"><p className="text-2xl text-slate-400">Unknown section.</p></div>;
  }
}

export default function MeetingModeSession() {
  const { meetingId } = useParams();
  const navigate = useNavigate();
  const notesRef = useRef(null);

  const [checkingAccess, setCheckingAccess] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [company, setCompany] = useState(null);
  const [meeting, setMeeting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [savingUnsaved, setSavingUnsaved] = useState(false);
  const pendingActionRef = useRef(null);

  useDocumentTitle(meeting ? `SteelOS — Meeting: ${meeting.name}` : 'SteelOS — Meeting');

  useEffect(() => {
    const hadDark = document.documentElement.classList.contains('dark');
    document.documentElement.classList.add('dark');
    return () => { if (!hadDark) document.documentElement.classList.remove('dark'); };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const me = await db.auth.me();
        setCurrentUser(me);
        const roles = (me?.roles || ['user']).map(normalizeRoleName);
        setAllowed(isAdminUser(me) || roles.some((r) => MEETING_MODE_ROLES.includes(r)));
      } catch (e) {
        setAllowed(false);
      } finally {
        setCheckingAccess(false);
      }
    })();
    getEffectiveCompany().then(setCompany).catch(() => setCompany(null));
    loadEmployeeRoster().then((r) => setEmployees(r.employees)).catch(() => setEmployees([]));
  }, []);

  useEffect(() => {
    if (!allowed || !meetingId) return;
    (async () => {
      setLoading(true);
      try {
        const row = await db.entities.Meeting.get(meetingId);
        if (!row) { setNotFound(true); return; }
        setMeeting(row);
      } catch (e) {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [allowed, meetingId]);

  // Never render a section the company's pack no longer grants, even if it's
  // still stored on the Meeting row from before the pack changed.
  const sections = useMemo(() => {
    if (!meeting) return [];
    const available = getAvailableSections(company);
    return (meeting.sections || [])
      .map((key) => available.find((s) => s.key === key))
      .filter(Boolean);
  }, [meeting, company]);

  const activeSection = sections[activeIndex] || null;

  const isDirty = useCallback(() => !!notesRef.current?.isDirty?.(), []);

  // Every internal navigation trigger on this page (section switch, Exit)
  // routes through here so unsaved notes always block until Save/Discard is
  // chosen — same technique BidDetail.jsx uses for its own Back button,
  // generalized from one exit path to every exit path this page has.
  const attemptNavigate = useCallback((action) => {
    if (isDirty()) {
      pendingActionRef.current = action;
      setShowUnsavedModal(true);
    } else {
      action();
    }
  }, [isDirty]);

  const goTo = useCallback((index) => {
    if (sections.length === 0) return;
    const clamped = ((index % sections.length) + sections.length) % sections.length;
    attemptNavigate(() => setActiveIndex(clamped));
  }, [sections.length, attemptNavigate]);

  const handleExit = () => attemptNavigate(() => navigate('/'));

  const handleModalSave = async () => {
    setSavingUnsaved(true);
    try {
      const ok = await notesRef.current?.save?.();
      if (ok) {
        setShowUnsavedModal(false);
        pendingActionRef.current?.();
        pendingActionRef.current = null;
      }
    } finally {
      setSavingUnsaved(false);
    }
  };

  const handleModalDiscard = () => {
    setShowUnsavedModal(false);
    pendingActionRef.current?.();
    pendingActionRef.current = null;
  };

  // Tab close / refresh.
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // Browser back/forward — can't be blocked (the URL has already changed by
  // the time this fires), so this is a best-effort prompt-then-undo, same
  // accepted limitation as BidDetail.jsx's own popstate handler.
  useEffect(() => {
    const handlePopState = async () => {
      if (!isDirty()) return;
      const shouldSave = window.confirm('You have unsaved changes. Do you want to save before leaving?');
      if (shouldSave) {
        await notesRef.current?.save?.();
      } else {
        navigate(1);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isDirty, navigate]);

  useEffect(() => {
    if (sections.length === 0) return;
    const handleKeyDown = (e) => {
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); goTo(activeIndex + 1); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); goTo(activeIndex - 1); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sections.length, activeIndex, goTo]);

  if (checkingAccess || loading) {
    return <div className="fixed inset-0 bg-slate-950" />;
  }

  if (!allowed) {
    return (
      <div className="fixed inset-0 bg-slate-950 flex items-center justify-center text-white">
        <div className="text-center max-w-md px-6">
          <Lock className="w-10 h-10 mx-auto mb-4 text-slate-400" />
          <h1 className="text-2xl font-semibold mb-2">Meeting Mode Restricted</h1>
          <p className="text-slate-400">Meeting Mode is available to Project Manager, Shop Manager, Finance, Controller, and executive roles.</p>
        </div>
      </div>
    );
  }

  if (notFound || !meeting) {
    return (
      <div className="fixed inset-0 bg-slate-950 flex items-center justify-center text-white">
        <p className="text-xl text-slate-400">Meeting not found.</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-slate-950 text-white flex">
      <div className="w-72 flex-shrink-0 border-r border-slate-800 flex flex-col">
        <div className="px-5 py-5 border-b border-slate-800">
          <p className="text-lg font-semibold truncate">{meeting.name}</p>
          <p className="text-xs text-slate-500">{meeting.meeting_date}</p>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {sections.length === 0 ? (
            <p className="px-5 py-3 text-sm text-slate-500">No sections available to this meeting's current pack.</p>
          ) : sections.map((section, idx) => (
            <button
              key={section.key}
              type="button"
              onClick={() => goTo(idx)}
              aria-current={idx === activeIndex ? 'true' : undefined}
              className={`w-full text-left px-5 py-3 border-l-4 transition-colors ${
                idx === activeIndex ? 'border-blue-500 bg-slate-900 text-white' : 'border-transparent text-slate-400 hover:text-white hover:bg-slate-900/50'
              }`}
            >
              <div className="text-base font-medium truncate">{section.label}</div>
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
          <button type="button" onClick={handleExit} className="text-slate-400 hover:text-white flex items-center gap-1.5 text-sm">
            <X className="w-4 h-4" /> Exit
          </button>
        </div>
      </div>

      <div className="flex-1 min-w-0">
        {activeSection ? renderSectionBody(activeSection.key, { company, currentUser }) : (
          <div className="h-full flex items-center justify-center"><p className="text-2xl text-slate-400">No sections to show.</p></div>
        )}
      </div>

      {activeSection && (
        <MeetingSectionNotesPanel
          key={`${meeting.id}:${activeSection.key}`}
          ref={notesRef}
          meetingId={meeting.id}
          meetingName={meeting.name}
          section={activeSection}
          currentUser={currentUser}
          employees={employees}
        />
      )}

      <UnsavedChangesModal open={showUnsavedModal} onSave={handleModalSave} onDiscard={handleModalDiscard} saving={savingUnsaved} />
    </div>
  );
}
