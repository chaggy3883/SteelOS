import React, { useEffect, useState } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Link } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { Lock, Plus } from 'lucide-react';
import { normalizeRoleName } from '@/components/dashboard/rbacConfig';
import { isAdminUser, getEffectiveCompany } from '@/lib/tenantContext';
import { getSectionDefinition } from '@/lib/meetingModeSections';
import AddMeetingModal from '@/components/meeting-mode/AddMeetingModal';

// Who actually runs recurring meetings in this app today. admin/super_admin
// bypass via isAdminUser() below, same convention as Accounting.jsx/Legal.jsx.
const MEETING_MODE_ROLES = ['project_manager', 'shop_manager', 'finance_department', 'controller', 'president', 'ceo'];

const openMeeting = (meetingId) => window.open(`/meeting-mode/${meetingId}`, '_blank', 'noopener,noreferrer');

export default function MeetingMode() {
  useDocumentTitle('SteelOS — Meeting Mode');
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [company, setCompany] = useState(null);
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
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

  const loadMeetings = async () => {
    setLoading(true);
    try {
      const rows = await db.entities.Meeting.list('-meeting_date', 200);
      setMeetings(rows);
    } catch (e) {
      setMeetings([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (allowed) loadMeetings(); }, [allowed]);

  const handleCreate = async ({ name, meeting_date, sections }) => {
    const me = await db.auth.me().catch(() => null);
    const created = await db.entities.Meeting.create({ name, meeting_date, sections, created_by: me?.id || '' });
    setShowAddModal(false);
    await loadMeetings();
    openMeeting(created.id);
  };

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

  return (
    <div className="fixed inset-0 bg-slate-950 text-white flex flex-col">
      <div className="flex items-center justify-between px-8 py-6">
        <h1 className="text-2xl font-semibold">Meeting Mode</h1>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 rounded px-4 py-2 text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> Add Meeting
          </button>
          <Link to="/" className="text-slate-400 hover:text-white text-sm">Exit</Link>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8">
        {loading ? (
          <p className="text-slate-400">Loading meetings…</p>
        ) : meetings.length === 0 ? (
          <div className="max-w-md mx-auto mt-20 text-center">
            <p className="text-slate-400 mb-4">No meetings yet. Create one to get started.</p>
            <button type="button" onClick={() => setShowAddModal(true)} className="text-blue-400 hover:text-white underline">
              Add Meeting
            </button>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-2">
            {meetings.map((meeting) => (
              <button
                key={meeting.id}
                type="button"
                onClick={() => openMeeting(meeting.id)}
                className="w-full text-left flex items-center justify-between gap-4 rounded-lg border border-slate-800 hover:border-blue-500 hover:bg-slate-900 px-6 py-5 transition-colors"
              >
                <div>
                  <p className="text-lg font-medium">{meeting.name}</p>
                  <p className="text-sm text-slate-500">{meeting.meeting_date}</p>
                </div>
                <div className="flex flex-wrap gap-1.5 justify-end max-w-xs">
                  {(meeting.sections || []).map((key) => (
                    <span key={key} className="text-[10px] uppercase tracking-wide bg-slate-800 text-slate-300 rounded px-1.5 py-0.5">
                      {getSectionDefinition(key)?.label || key}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <AddMeetingModal open={showAddModal} onOpenChange={setShowAddModal} company={company} onCreate={handleCreate} />
    </div>
  );
}
