import React, { useState, useEffect } from 'react';
import { AlertTriangle, Plus, X, UserPlus } from 'lucide-react';
import { db } from '@/api/apiClient';
import { useToast } from '@/components/ui/use-toast';
import { TRADE_OPTIONS, CERT_TYPE_OPTIONS, findDoubleBookings, findMissingCertifications, findLeaveConflicts } from '@/lib/manpowerData';
import EmployeePicker from '@/components/meeting-mode/EmployeePicker';
import EmployeeDetailModal from '@/components/meeting-mode/EmployeeDetailModal';
import ProjectDetailModal from '@/components/meeting-mode/ProjectDetailModal';
import AssignmentDetailModal from '@/components/meeting-mode/AssignmentDetailModal';

const todayStr = () => new Date().toISOString().slice(0, 10);

function StaffingRow({ row, onRemoveNeed, onChangeNeeded }) {
  // Local draft so typing doesn't write to the database on every keystroke —
  // committed onBlur, and re-synced whenever the parent's value changes for
  // a reason other than this input (e.g. a refresh after an assignment).
  const [draft, setDraft] = useState(row.needed);
  useEffect(() => setDraft(row.needed), [row.needed]);

  const gap = row.needed !== null ? row.assigned - row.needed : null;
  const short = gap !== null && gap < 0;
  return (
    <div className="flex items-center justify-between border-b border-slate-800 py-3">
      <span className="text-2xl font-semibold w-48">{row.trade}</span>
      <div className="flex items-center gap-8">
        <div className="text-center">
          <p className="text-sm text-slate-500 uppercase tracking-wide">Needed</p>
          {row.needed === null ? (
            <p className="text-2xl font-mono text-slate-500">—</p>
          ) : (
            <input
              type="number"
              min={0}
              value={draft}
              onChange={(e) => setDraft(Math.max(0, Number(e.target.value) || 0))}
              onBlur={() => draft !== row.needed && onChangeNeeded(row.trade, draft)}
              className="w-16 text-2xl font-mono bg-transparent border-b border-slate-700 focus:outline-none focus:border-blue-500 text-center"
            />
          )}
        </div>
        <div className="text-center">
          <p className="text-sm text-slate-500 uppercase tracking-wide">Assigned</p>
          <p className="text-2xl font-mono">{row.assigned}</p>
        </div>
        <div className={`text-center min-w-[7rem] ${short ? 'text-red-400' : gap === null ? 'text-slate-500' : 'text-emerald-400'}`}>
          <p className="text-sm uppercase tracking-wide opacity-80">{gap === null ? 'Unplanned' : short ? 'Short' : 'Covered'}</p>
          <p className="text-2xl font-mono font-bold">{gap === null ? '—' : (gap > 0 ? `+${gap}` : gap)}</p>
        </div>
        {row.needed !== null && (
          <button type="button" onClick={() => onRemoveNeed(row.trade)} aria-label={`Remove ${row.trade} need`} className="text-slate-600 hover:text-red-400">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export default function ManpowerSection({ project, staffing, assignments, manpowerData, currentUser, onDataChange, onOpenProject }) {
  const { toast } = useToast();
  const { employees, certifications, assignments: allAssignments, leaveRequests, projectsById } = manpowerData;

  const [addingNeed, setAddingNeed] = useState(false);
  const [newNeedTrade, setNewNeedTrade] = useState('');
  const [newNeedCount, setNewNeedCount] = useState(1);

  const [assigning, setAssigning] = useState(false);
  const [pickedEmployee, setPickedEmployee] = useState(null);
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [roleOnJob, setRoleOnJob] = useState('');
  const [notes, setNotes] = useState('');
  const [conflicts, setConflicts] = useState(null);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState(null);

  const [employeeModal, setEmployeeModal] = useState(null);
  const [projectModal, setProjectModal] = useState(null);
  const [assignmentModal, setAssignmentModal] = useState(null);

  const resetAssignForm = () => {
    setAssigning(false);
    setPickedEmployee(null);
    setStartDate(todayStr());
    setEndDate(todayStr());
    setRoleOnJob('');
    setNotes('');
    setConflicts(null);
  };

  const saveNeeds = async (nextNeeds) => {
    await db.entities.Project.update(project.id, { manpower_needs: nextNeeds });
    onDataChange();
  };

  const handleAddNeed = () => {
    if (!newNeedTrade.trim()) return;
    const existing = project.manpower_needs || [];
    if (existing.some((n) => n.trade === newNeedTrade.trim())) {
      toast({ title: `${newNeedTrade} already has a stated need for this job`, variant: 'destructive' });
      return;
    }
    saveNeeds([...existing, { trade: newNeedTrade.trim(), headcount_needed: Math.max(0, Number(newNeedCount) || 0) }]);
    setAddingNeed(false);
    setNewNeedTrade('');
    setNewNeedCount(1);
  };

  const handleChangeNeeded = (trade, headcount) => {
    const next = (project.manpower_needs || []).map((n) => (n.trade === trade ? { ...n, headcount_needed: headcount } : n));
    saveNeeds(next);
  };

  const handleRemoveNeed = (trade) => {
    saveNeeds((project.manpower_needs || []).filter((n) => n.trade !== trade));
  };

  const toggleRequiredCert = (certType) => {
    const current = project.required_certifications || [];
    const next = current.includes(certType) ? current.filter((c) => c !== certType) : [...current, certType];
    db.entities.Project.update(project.id, { required_certifications: next }).then(onDataChange);
  };

  const runConflictChecks = () => {
    const doubleBookings = findDoubleBookings({
      employeeId: pickedEmployee.id, startDate, endDate, excludeProjectId: project.id, allAssignments, projectsById,
    });
    const missingCerts = findMissingCertifications({
      requiredCertTypes: project.required_certifications || [], employeeId: pickedEmployee.id, endDate, allCertifications: certifications,
    });
    const leaveConflicts = findLeaveConflicts({ employeeId: pickedEmployee.id, startDate, endDate, allLeaveRequests: leaveRequests });
    return { doubleBookings, missingCerts, leaveConflicts };
  };

  const hasConflicts = (c) => c.doubleBookings.length > 0 || c.missingCerts.length > 0 || c.leaveConflicts.length > 0;

  const doAssign = async () => {
    setSaving(true);
    try {
      await db.entities.CrewAssignment.create({
        project_id: project.id,
        employee_id: pickedEmployee.id,
        crew_id: null,
        start_date: startDate,
        end_date: endDate,
        role_on_job: roleOnJob.trim() || 'Unassigned Role',
        assigned_by: currentUser?.full_name || currentUser?.email || 'Unknown',
        assigned_at: new Date().toISOString(),
        notes: notes.trim(),
      });
      toast({ title: `${pickedEmployee.full_name} assigned to ${project.name}` });
      resetAssignForm();
      onDataChange();
    } catch (e) {
      toast({ title: 'Unable to save assignment', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleCheckAndAssign = () => {
    if (!pickedEmployee || !startDate || !endDate) return;
    if (startDate > endDate) { toast({ title: 'Start date must be on or before end date', variant: 'destructive' }); return; }
    const found = runConflictChecks();
    if (hasConflicts(found)) setConflicts(found);
    else doAssign();
  };

  const handleRemoveAssignment = async (assignment) => {
    setRemovingId(assignment.id);
    try {
      await db.entities.CrewAssignment.delete(assignment.id);
      toast({ title: 'Assignment removed' });
      setAssignmentModal(null);
      onDataChange();
    } catch (e) {
      toast({ title: 'Unable to remove assignment', variant: 'destructive' });
    } finally {
      setRemovingId(null);
    }
  };

  const usedTrades = new Set((project.manpower_needs || []).map((n) => n.trade));
  const requiredCerts = project.required_certifications || [];

  return (
    <div className="flex flex-col h-full text-white">
      <div className="px-10 pt-8 pb-4">
        <p className="text-lg text-slate-400 uppercase tracking-wide">Manpower</p>
        <button type="button" onClick={() => setProjectModal(project)} className="text-5xl font-bold mt-1 hover:text-blue-300 transition-colors text-left">
          {project.name}
        </button>
        <p className="text-2xl text-slate-300 mt-1">{project.project_number}</p>
      </div>

      <div className="flex-1 overflow-y-auto px-10 pb-8 space-y-6">
        {/* Staffing vs need */}
        <div>
          {staffing.length === 0 ? (
            <p className="text-xl text-slate-400">No manpower needs stated for this job yet.</p>
          ) : (
            staffing.map((row) => (
              <StaffingRow key={row.trade} row={row} onRemoveNeed={handleRemoveNeed} onChangeNeeded={handleChangeNeeded} />
            ))
          )}
          {addingNeed ? (
            <div className="flex items-center gap-3 mt-3">
              <input
                list="trade-options"
                value={newNeedTrade}
                onChange={(e) => setNewNeedTrade(e.target.value)}
                placeholder="Trade"
                className="h-10 px-3 rounded bg-slate-900 border border-slate-700 text-base"
              />
              <datalist id="trade-options">
                {TRADE_OPTIONS.filter((t) => !usedTrades.has(t)).map((t) => <option key={t} value={t} />)}
              </datalist>
              <input type="number" min={0} value={newNeedCount} onChange={(e) => setNewNeedCount(e.target.value)} className="h-10 w-20 px-3 rounded bg-slate-900 border border-slate-700 text-base" />
              <button type="button" onClick={handleAddNeed} className="h-10 px-4 rounded bg-blue-600 hover:bg-blue-500 text-base font-medium">Add</button>
              <button type="button" onClick={() => setAddingNeed(false)} className="h-10 px-3 text-slate-400 hover:text-white text-base">Cancel</button>
            </div>
          ) : (
            <button type="button" onClick={() => setAddingNeed(true)} className="flex items-center gap-1.5 mt-3 text-base text-blue-400 hover:text-white">
              <Plus className="w-4 h-4" /> Add Trade Need
            </button>
          )}
        </div>

        {/* Required certifications */}
        <div>
          <p className="text-sm text-slate-500 uppercase tracking-wide mb-2">Required Certifications For This Job</p>
          <div className="flex flex-wrap gap-2">
            {CERT_TYPE_OPTIONS.map((cert) => (
              <button
                key={cert}
                type="button"
                onClick={() => toggleRequiredCert(cert)}
                className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                  requiredCerts.includes(cert) ? 'bg-blue-600 border-blue-500 text-white' : 'border-slate-700 text-slate-400 hover:border-slate-500'
                }`}
              >
                {cert.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </div>

        {/* Current assignments */}
        <div>
          <p className="text-sm text-slate-500 uppercase tracking-wide mb-2">Assigned Crew</p>
          {assignments.length === 0 ? (
            <p className="text-lg text-slate-400">No one is assigned to this job yet.</p>
          ) : (
            <div className="space-y-2">
              {assignments.map((a) => (
                <div key={a.id} className="flex items-center gap-4 border border-slate-800 rounded-lg px-4 py-2.5">
                  <button type="button" onClick={() => setEmployeeModal(a.employee)} className="text-lg font-medium hover:text-blue-300 disabled:hover:text-white" disabled={!a.employee}>
                    {a.employee?.full_name || 'Unknown employee'}
                  </button>
                  <span className="text-sm text-slate-400">{a.role_on_job}</span>
                  <button type="button" onClick={() => setAssignmentModal(a)} className="text-sm text-slate-400 hover:text-white underline ml-auto">
                    {a.start_date} → {a.end_date}
                  </button>
                  <button type="button" onClick={() => handleRemoveAssignment(a)} disabled={removingId === a.id} aria-label="Remove assignment" className="text-slate-600 hover:text-red-400">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Assign employee flow */}
        <div className="border-t border-slate-800 pt-5">
          {!assigning ? (
            <button type="button" onClick={() => setAssigning(true)} className="flex items-center gap-2 text-lg text-blue-400 hover:text-white">
              <UserPlus className="w-5 h-5" /> Assign Employee to This Job
            </button>
          ) : (
            <div className="max-w-2xl space-y-4">
              {!pickedEmployee ? (
                <EmployeePicker employees={employees} onPick={setPickedEmployee} />
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <span className="text-lg">Assigning</span>
                    <button type="button" onClick={() => setEmployeeModal(pickedEmployee)} className="text-lg font-semibold underline hover:text-blue-300">{pickedEmployee.full_name}</button>
                    <button type="button" onClick={() => { setPickedEmployee(null); setConflicts(null); }} className="text-sm text-slate-400 hover:text-white ml-auto">Change</button>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm text-slate-400">Start Date</label>
                      <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setConflicts(null); }} className="w-full h-11 mt-1 px-3 rounded bg-slate-900 border border-slate-700 text-base" />
                    </div>
                    <div>
                      <label className="text-sm text-slate-400">End Date</label>
                      <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setConflicts(null); }} className="w-full h-11 mt-1 px-3 rounded bg-slate-900 border border-slate-700 text-base" />
                    </div>
                  </div>
                  <div>
                    <label className="text-sm text-slate-400">Role on Job</label>
                    <input
                      list="role-options"
                      value={roleOnJob}
                      onChange={(e) => { setRoleOnJob(e.target.value); setConflicts(null); }}
                      placeholder={pickedEmployee.classification || 'e.g. Ironworker'}
                      className="w-full h-11 mt-1 px-3 rounded bg-slate-900 border border-slate-700 text-base"
                    />
                    <datalist id="role-options">
                      {TRADE_OPTIONS.map((t) => <option key={t} value={t} />)}
                    </datalist>
                  </div>
                  <div>
                    <label className="text-sm text-slate-400">Notes (optional)</label>
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full mt-1 px-3 py-2 rounded bg-slate-900 border border-slate-700 text-base" />
                  </div>

                  {conflicts && (
                    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 space-y-2">
                      <p className="flex items-center gap-2 text-amber-400 font-semibold text-base">
                        <AlertTriangle className="w-5 h-5" /> Conflicts found — review before assigning
                      </p>
                      {conflicts.doubleBookings.map((c, i) => (
                        <p key={`db-${i}`} className="text-sm text-amber-200">
                          Already assigned to{' '}
                          <button type="button" onClick={() => c.project && setProjectModal(c.project)} className="underline hover:text-white">
                            {c.project?.name || 'another job'}
                          </button>{' '}
                          from {c.assignment.start_date} to {c.assignment.end_date} (overlaps this assignment).
                        </p>
                      ))}
                      {conflicts.missingCerts.map((c) => (
                        <p key={c.cert_type} className="text-sm text-amber-200">
                          Missing or expired <strong>{c.cert_type.replace(/_/g, ' ')}</strong>, required for this job
                          {c.existingRecord?.expiration_date ? ` (on file, expired ${c.existingRecord.expiration_date})` : ' (none on file)'}.
                        </p>
                      ))}
                      {conflicts.leaveConflicts.map((c) => (
                        <p key={c.id} className="text-sm text-amber-200">
                          {c.status === 'Approved' ? 'Approved' : 'Pending'} {c.leave_type} leave from {c.start_date} to {c.end_date} overlaps this assignment.
                        </p>
                      ))}
                      <div className="flex gap-3 pt-1">
                        <button type="button" onClick={doAssign} disabled={saving} className="h-9 px-4 rounded bg-amber-600 hover:bg-amber-500 text-sm font-semibold text-white">
                          {saving ? 'Assigning…' : 'Assign Anyway'}
                        </button>
                        <button type="button" onClick={() => setConflicts(null)} className="h-9 px-4 text-sm text-slate-300 hover:text-white">Cancel</button>
                      </div>
                    </div>
                  )}

                  {!conflicts && (
                    <div className="flex gap-3">
                      <button type="button" onClick={handleCheckAndAssign} disabled={saving} className="h-11 px-5 rounded bg-blue-600 hover:bg-blue-500 text-base font-semibold">
                        {saving ? 'Assigning…' : 'Assign'}
                      </button>
                      <button type="button" onClick={resetAssignForm} className="h-11 px-4 text-slate-400 hover:text-white text-base">Cancel</button>
                    </div>
                  )}
                </>
              )}
              {!pickedEmployee && (
                <button type="button" onClick={resetAssignForm} className="text-sm text-slate-400 hover:text-white">Cancel</button>
              )}
            </div>
          )}
        </div>
      </div>

      <EmployeeDetailModal open={!!employeeModal} onOpenChange={(o) => !o && setEmployeeModal(null)} employee={employeeModal} certifications={certifications} />
      <ProjectDetailModal open={!!projectModal} onOpenChange={(o) => !o && setProjectModal(null)} project={projectModal} />
      <AssignmentDetailModal
        open={!!assignmentModal}
        onOpenChange={(o) => !o && setAssignmentModal(null)}
        assignment={assignmentModal}
        project={project}
        onRemove={assignmentModal ? () => handleRemoveAssignment(assignmentModal) : null}
        removing={assignmentModal && removingId === assignmentModal.id}
      />
    </div>
  );
}
