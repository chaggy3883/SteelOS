import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { savePdf, getPdf } from '@/lib/pdfBlobStore';
import { downloadFile } from '@/lib/downloadFile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import FileDropzone from '@/components/ui/FileDropzone';
import { useToast } from '@/components/ui/use-toast';
import { FolderLock, Plus, Download, FileCheck2 } from 'lucide-react';

const INCIDENT_TYPES = ['Write-Up', 'Verbal Warning', 'Written Warning', 'Final Warning', 'Suspension', 'Termination Notice', 'Other'];

const emptyEntryForm = () => ({ incident_date: new Date().toISOString().slice(0, 10), incident_type: INCIDENT_TYPES[0], description: '' });

export default function EmployeeFilesPanel({ employees }) {
  const { toast } = useToast();
  const [employeeId, setEmployeeId] = useState('');
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyEntryForm());
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [currentUserName, setCurrentUserName] = useState('');

  useEffect(() => {
    db.auth.me().then((me) => setCurrentUserName(me?.full_name || me?.email || '')).catch(() => {});
  }, []);

  useEffect(() => {
    if (!employeeId) { setRecords([]); return; }
    loadRecords(employeeId);
  }, [employeeId]);

  const loadRecords = async (id) => {
    setLoading(true);
    try {
      const rows = await db.entities.employee_disciplinary_files.filter({ employee_id: id }, '-created_date', 200);
      setRecords(rows);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!form.incident_date || !form.incident_type) {
      toast({ title: 'Incident date and type are required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const created = await db.entities.employee_disciplinary_files.create({
        employee_id: employeeId,
        incident_date: form.incident_date,
        incident_type: form.incident_type,
        description: form.description,
        uploaded_by: currentUserName,
        file_blob_key: '',
      });

      let record = created;
      if (file) {
        const key = `hr_docs/${employeeId}/disciplinary/${created.id}`;
        await savePdf(key, file);
        record = await db.entities.employee_disciplinary_files.update(created.id, { file_blob_key: key });
      }

      setRecords((prev) => [record, ...prev]);
      setShowForm(false);
      setForm(emptyEntryForm());
      setFile(null);
      toast({ title: 'File entry added' });
    } catch (e) {
      toast({ title: 'Unable to save file entry', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = async (record) => {
    if (!record.file_blob_key) return;
    const url = await getPdf(record.file_blob_key);
    if (!url) {
      toast({ title: 'No file stored on this device for this record', variant: 'destructive' });
      return;
    }
    downloadFile(url, `${record.incident_type}-${record.incident_date}`.replace(/\s+/g, '_'));
  };

  const selectedEmployee = employees.find((e) => e.id === employeeId);

  return (
    <div className="space-y-3">
      <div className="steel-card p-4 max-w-lg">
        <h4 className="font-semibold text-sm mb-1 flex items-center gap-2"><FolderLock className="w-4 h-4 text-primary" />Employee Files</h4>
        <p className="text-xs text-muted-foreground mb-3">Disciplinary write-ups, warnings, and HR-defined forms on file per employee.</p>
        <Select value={employeeId} onValueChange={(v) => { setEmployeeId(v); setSelectedRecord(null); setShowForm(false); }}>
          <SelectTrigger><SelectValue placeholder="Select an employee" /></SelectTrigger>
          <SelectContent>
            {employees.map((e) => <SelectItem key={e.id} value={e.id}>#{e.employee_number} — {e.full_name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {employeeId && (
        <div className="steel-card p-4 space-y-3 max-w-2xl">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm">{selectedEmployee?.full_name}'s File</h4>
            <Button size="sm" className="gap-1.5 steel-gradient text-white border-0" onClick={() => { setShowForm((s) => !s); setSelectedRecord(null); }}>
              <Plus className="w-3.5 h-3.5" />Add File Entry
            </Button>
          </div>

          {showForm && (
            <div className="rounded-lg border border-border p-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Incident Date</Label>
                  <Input type="date" value={form.incident_date} onChange={(e) => setForm((f) => ({ ...f, incident_date: e.target.value }))} className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Incident Type</Label>
                  <Select value={form.incident_type} onValueChange={(v) => setForm((f) => ({ ...f, incident_type: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {INCIDENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs">Description</Label>
                <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Attach File (optional)</Label>
                <FileDropzone accept="image/*,.pdf" label="Upload supporting document" onFileSelected={setFile} className="mt-1" />
                {file && <p className="mt-1.5 flex items-center gap-1.5 text-xs text-green-600"><FileCheck2 className="w-3.5 h-3.5" />{file.name}</p>}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => { setShowForm(false); setForm(emptyEntryForm()); setFile(null); }}>Cancel</Button>
                <Button size="sm" onClick={handleSave} disabled={saving} className="steel-gradient text-white border-0">{saving ? 'Saving…' : 'Save Entry'}</Button>
              </div>
            </div>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
          ) : records.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No file entries on record.</p>
          ) : (
            <div className="space-y-2">
              {records.map((r) => (
                <div key={r.id} onClick={() => setSelectedRecord(selectedRecord?.id === r.id ? null : r)} className="rounded-lg border border-border p-3 text-sm cursor-pointer hover:bg-muted/50 transition-colors">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{r.incident_type}</p>
                    <span className="text-xs text-muted-foreground">{r.incident_date}</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{r.description || 'No description'}</p>
                </div>
              ))}
            </div>
          )}

          {selectedRecord && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2 text-sm">
              <p><span className="text-muted-foreground">Incident Date:</span> {selectedRecord.incident_date}</p>
              <p><span className="text-muted-foreground">Incident Type:</span> {selectedRecord.incident_type}</p>
              <p><span className="text-muted-foreground">Description:</span> {selectedRecord.description || '—'}</p>
              <p><span className="text-muted-foreground">Uploaded By:</span> {selectedRecord.uploaded_by || '—'}</p>
              <p><span className="text-muted-foreground">Created:</span> {new Date(selectedRecord.created_date).toLocaleString()}</p>
              {selectedRecord.file_blob_key && (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => handleDownload(selectedRecord)}>
                  <Download className="w-3.5 h-3.5" />Download
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
