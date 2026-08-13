import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDocumentRecords } from '@/lib/inspectionDocumentStore';
import { Users, UserX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import InspectionDocumentUpload from '@/components/shared/InspectionDocumentUpload';
import { MEETING_TYPES } from '@/components/safety/SafetyMeetingFormDialog';

// Read-only drill-down for a single SafetyMeeting record — the standing
// "every row clickable to its full record" target for SafetyMeetingLog's
// list. Documents are re-read from IndexedDB (the record itself only stores
// lightweight refs, no blobs) so attachments can still be viewed/downloaded.
export default function SafetyMeetingDetailDialog({ meeting, open, onOpenChange, employees = [], projects = [] }) {
  const navigate = useNavigate();
  const [docs, setDocs] = useState([]);

  useEffect(() => {
    if (!open || !meeting?.id) { setDocs([]); return; }
    getDocumentRecords(`safety_meeting_documents_${meeting.id}`).then(setDocs).catch(() => setDocs([]));
  }, [open, meeting?.id]);

  if (!meeting) return null;

  const project = projects.find((p) => p.id === meeting.project_id);
  const typeLabel = MEETING_TYPES.find((t) => t.value === meeting.meeting_type)?.label || meeting.meeting_type;
  const attendees = meeting.attendees || [];
  const attendeeEmployeeIds = new Set(attendees.filter((a) => a.employee_id).map((a) => a.employee_id));
  const activeEmployees = employees.filter((e) => e.is_active_login !== false);
  const missed = activeEmployees.filter((e) => !attendeeEmployeeIds.has(e.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span>{meeting.topic}</span>
            <Badge variant="secondary">{typeLabel}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2 text-sm">
          {[
            ['Date', meeting.meeting_date],
            ['Location', meeting.location || '—'],
            ['Project', project?.name || (meeting.project_id ? meeting.project_id : 'No specific project'), project ? () => navigate(`/projects/${project.id}`) : null],
            ['Presenter', meeting.presenter_name],
          ].map(([label, value, onClick]) => (
            <div key={label} className="grid grid-cols-3 gap-2 border-b border-border/50 pb-2">
              <span className="text-muted-foreground">{label}</span>
              {onClick ? (
                <button onClick={onClick} className="col-span-2 font-medium text-left text-primary hover:underline">{value}</button>
              ) : (
                <span className="col-span-2 font-medium">{value}</span>
              )}
            </div>
          ))}
        </div>

        {meeting.content && (
          <div>
            <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Meeting Content</h5>
            <p className="text-sm whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-3">{meeting.content}</p>
          </div>
        )}

        <div>
          <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" />Attendees ({attendees.length})
          </h5>
          {attendees.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sign-ins recorded.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {attendees.map((a, i) => (
                a.employee_id ? (
                  <button key={a.employee_id} onClick={() => navigate(`/human-resources?employee=${a.employee_id}`)} className="text-xs px-2.5 py-0.5 rounded-full border border-primary/30 text-primary hover:bg-primary/10">
                    {a.name}
                  </button>
                ) : (
                  <span key={`${a.name}-${i}`} className="text-xs px-2.5 py-0.5 rounded-full border border-border text-muted-foreground">
                    {a.name} <span className="opacity-70">(guest)</span>
                  </span>
                )
              ))}
            </div>
          )}
        </div>

        <div>
          <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
            <UserX className="w-3.5 h-3.5" />Missed ({missed.length} of {activeEmployees.length} active employees)
          </h5>
          {missed.length === 0 ? (
            <p className="text-sm text-muted-foreground">Every active employee attended.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {missed.map((e) => (
                <button key={e.id} onClick={() => navigate(`/human-resources?employee=${e.id}`)} className="text-xs px-2.5 py-0.5 rounded-full border border-red-500/30 text-red-600 hover:bg-red-500/10">
                  {e.full_name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Documents</h5>
          <InspectionDocumentUpload pendingFiles={[]} onPendingFilesChange={() => {}} savedDocuments={docs} disabled />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
