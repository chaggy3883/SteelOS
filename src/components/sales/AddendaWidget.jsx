import React, { useState, useEffect, useMemo } from 'react';
import { db } from '@/api/apiClient';
import { useAuth } from '@/lib/AuthContext';
import { Loader2, FileText, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { getMyProjects, getBulletinsForProjects } from '@/lib/salesDashboardData';
import { dispatchBulletinNotification } from '@/lib/salesNotifications';

const TYPE_LABELS = { addendum: 'Addendum', notice: 'Notice', schedule_change: 'Schedule Change' };
const emptyForm = () => ({ project_id: '', bulletin_type: 'addendum', date_issued: new Date().toISOString().slice(0, 10), summary: '', full_text: '' });

export default function AddendaWidget({ salesmanId }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [projects, setProjects] = useState([]);
  const [bulletins, setBulletins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    return (async () => {
      const myProjects = await getMyProjects(salesmanId);
      setProjects(myProjects);
      const rows = await getBulletinsForProjects(myProjects.map((p) => p.id));
      setBulletins(rows);
    })().catch(() => setBulletins([])).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [salesmanId]);

  const projectName = (id) => projects.find((p) => p.id === id)?.name || id;

  const openCreate = () => { setForm(emptyForm()); setShowCreate(true); };

  const handleCreate = async () => {
    if (!form.project_id || !form.summary.trim()) {
      toast({ title: 'Project and summary are required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const bulletin = await db.entities.ProjectBulletin.create({
        project_id: form.project_id,
        bulletin_type: form.bulletin_type,
        date_issued: form.date_issued,
        summary: form.summary,
        full_text: form.full_text,
        created_by_employee_id: salesmanId,
      });
      const project = projects.find((p) => p.id === form.project_id);
      const recipientCount = await dispatchBulletinNotification(bulletin, project, salesmanId, user?.full_name);
      toast({ title: 'Bulletin logged', description: recipientCount > 0 ? `Notified ${recipientCount} teammate${recipientCount === 1 ? '' : 's'}.` : undefined });
      setShowCreate(false);
      load();
    } catch (e) {
      toast({ title: 'Unable to log bulletin', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const sorted = useMemo(() => [...bulletins].sort((a, b) => (b.date_issued || '').localeCompare(a.date_issued || '')), [bulletins]);

  return (
    <div className="steel-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary" />
          <h3 className="font-semibold">Addenda / Bulletins</h3>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={openCreate}><Plus className="w-3 h-3" />Log Bulletin</Button>
      </div>

      {loading ? (
        <div className="py-8 text-center"><Loader2 className="w-5 h-5 mx-auto animate-spin text-muted-foreground" /></div>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No addenda or bulletins yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left py-1.5 pr-3">Project</th>
                <th className="text-left py-1.5 pr-3">Type</th>
                <th className="text-left py-1.5 pr-3">Date Issued</th>
                <th className="text-left py-1.5 pr-3">Summary</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((b) => (
                <tr key={b.id} className="border-b border-border/50 hover:bg-muted/30 cursor-pointer" onClick={() => setViewing(b)}>
                  <td className="py-1.5 pr-3 font-medium">{projectName(b.project_id)}</td>
                  <td className="py-1.5 pr-3">{TYPE_LABELS[b.bulletin_type] || b.bulletin_type}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{b.date_issued}</td>
                  <td className="py-1.5 pr-3 truncate max-w-xs" title={b.summary}>{b.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{TYPE_LABELS[viewing?.bulletin_type] || viewing?.bulletin_type} — {projectName(viewing?.project_id)}</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2 text-sm">
            <p className="text-xs text-muted-foreground">Issued {viewing?.date_issued}</p>
            <p className="font-medium">{viewing?.summary}</p>
            {viewing?.full_text && <p className="whitespace-pre-wrap text-muted-foreground">{viewing.full_text}</p>}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Log Addendum / Bulletin</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Project</Label>
              <select value={form.project_id} onChange={(e) => setForm((f) => ({ ...f, project_id: e.target.value }))} className="mt-1 w-full rounded-md border border-input bg-input/40 px-2 py-1.5 text-sm">
                <option value="">Select a project…</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Type</Label>
              <select value={form.bulletin_type} onChange={(e) => setForm((f) => ({ ...f, bulletin_type: e.target.value }))} className="mt-1 w-full rounded-md border border-input bg-input/40 px-2 py-1.5 text-sm">
                {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <Label>Date Issued</Label>
              <Input type="date" value={form.date_issued} onChange={(e) => setForm((f) => ({ ...f, date_issued: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Summary</Label>
              <Input value={form.summary} onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))} className="mt-1" placeholder="Brief one-line summary" />
            </div>
            <div>
              <Label>Full Text (optional)</Label>
              <Textarea rows={4} value={form.full_text} onChange={(e) => setForm((f) => ({ ...f, full_text: e.target.value }))} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving} className="steel-gradient text-white border-0">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}Log & Notify</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
