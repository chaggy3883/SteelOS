import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { ClipboardList, Plus, Users, UserX, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import SafetyMeetingFormDialog, { MEETING_TYPES } from '@/components/safety/SafetyMeetingFormDialog';
import SafetyMeetingDetailDialog from '@/components/safety/SafetyMeetingDetailDialog';

const missedCount = (meeting, employees) => {
  const attendeeEmployeeIds = new Set((meeting.attendees || []).filter((a) => a.employee_id).map((a) => a.employee_id));
  return employees.filter((e) => e.is_active_login !== false && !attendeeEmployeeIds.has(e.id)).length;
};

// Weekly toolbox-talk log: filterable list of past SafetyMeeting records,
// each row clickable to its full detail (standing drill-down rule), plus
// the Log Meeting entry point. Self-contained — loads its own employees/
// projects rather than relying on Safety.jsx, matching Quality.jsx's tab
// components.
export default function SafetyMeetingLog() {
  const [meetings, setMeetings] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [viewingMeeting, setViewingMeeting] = useState(null);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [meetingData, employeeData, projectData] = await Promise.all([
        db.entities.SafetyMeeting.list('-meeting_date', 200),
        db.entities.employees.list('full_name', 500),
        db.entities.Project.filter({ is_archived: false }, 'name', 200),
      ]);
      setMeetings(meetingData);
      setEmployees(employeeData);
      setProjects(projectData);
    } catch (e) {} finally { setLoading(false); }
  };

  const handleCreated = (created) => setMeetings((prev) => [created, ...prev]);

  const projectName = (id) => projects.find((p) => p.id === id)?.name;
  const typeLabel = (value) => MEETING_TYPES.find((t) => t.value === value)?.label || value;

  const filtered = meetings.filter((m) => {
    if (dateFrom && m.meeting_date < dateFrom) return false;
    if (dateTo && m.meeting_date > dateTo) return false;
    if (typeFilter !== 'all' && m.meeting_type !== typeFilter) return false;
    if (projectFilter !== 'all' && m.project_id !== projectFilter) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 justify-between">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">From</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="mt-1 w-40" />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="mt-1 w-40" />
          </div>
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="mt-1 w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {MEETING_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Project</Label>
            <Select value={projectFilter} onValueChange={setProjectFilter}>
              <SelectTrigger className="mt-1 w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button className="gap-2 steel-gradient text-white border-0" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4" />Log Meeting
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 steel-card">
          <ClipboardList className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {meetings.length === 0 ? 'No safety meetings logged yet. Click "Log Meeting" to record your first toolbox talk.' : 'No meetings match these filters.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((m) => {
            const attendeeCount = (m.attendees || []).length;
            const missed = missedCount(m, employees);
            return (
              <div
                key={m.id}
                onClick={() => setViewingMeeting(m)}
                className="steel-card p-4 cursor-pointer hover:bg-muted/40 transition-colors"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="secondary">{typeLabel(m.meeting_type)}</Badge>
                      <span className="text-xs text-muted-foreground font-mono">{m.meeting_date}</span>
                    </div>
                    <p className="font-medium text-sm">{m.topic}</p>
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5 flex-wrap">
                      {m.location && <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{m.location}</span>}
                      {m.presenter_name && <span>• Presented by {m.presenter_name}</span>}
                      {projectName(m.project_id) && <span>• {projectName(m.project_id)}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge variant="outline" className="gap-1"><Users className="w-3 h-3" />{attendeeCount}</Badge>
                    {missed > 0 && <Badge variant="outline" className="gap-1 text-red-600 border-red-500/30"><UserX className="w-3 h-3" />{missed} missed</Badge>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <SafetyMeetingFormDialog open={showCreate} onOpenChange={setShowCreate} projects={projects} employees={employees} onCreated={handleCreated} />
      <SafetyMeetingDetailDialog meeting={viewingMeeting} open={!!viewingMeeting} onOpenChange={(o) => !o && setViewingMeeting(null)} employees={employees} projects={projects} />
    </div>
  );
}
