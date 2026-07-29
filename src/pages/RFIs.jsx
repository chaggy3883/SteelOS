import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { MessageSquare, Plus, Search, AlertCircle, Clock, CheckCircle2, FileWarning } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { generateDelayImpactNoticePDF } from '@/lib/delayNoticePdf';

export default function RFIs() {
  const { toast } = useToast();
  const [rfis, setRfis] = useState([]);
  const [projects, setProjects] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ project_id: '', subject: '', description: '', priority: 'medium' });
  const [saving, setSaving] = useState(false);
  const [generatingNoticeId, setGeneratingNoticeId] = useState(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [rfiData, projData, contractData] = await Promise.all([
        base44.entities.RFI.list('-created_date', 100),
        base44.entities.Project.filter({ is_archived: false }, 'name', 50),
        base44.entities.Contract.list('-created_date', 100),
      ]);
      setRfis(rfiData);
      setProjects(projData);
      setContracts(contractData);
    } catch (e) {} finally { setLoading(false); }
  };

  // Days elapsed past the contractually mandated RFI-response window for this
  // RFI's project's Contract (if one has been scanned in the Legal module) —
  // distinct from date_required, which is just a PM-set internal target date.
  const getContractDelinquency = (rfi) => {
    const contract = contracts.find(c => c.project_id === rfi.project_id);
    if (!contract?.rfi_response_window_days || !rfi.date_submitted || ['answered', 'closed'].includes(rfi.status)) {
      return { contract: null, daysDelayed: 0 };
    }
    const daysSinceSubmitted = Math.floor((new Date() - new Date(rfi.date_submitted)) / (1000 * 60 * 60 * 24));
    const daysDelayed = daysSinceSubmitted - contract.rfi_response_window_days;
    return { contract, daysDelayed: daysDelayed > 0 ? daysDelayed : 0 };
  };

  const handleGenerateDelayNotice = async (rfi) => {
    const { contract, daysDelayed } = getContractDelinquency(rfi);
    if (!contract || daysDelayed <= 0) return;
    setGeneratingNoticeId(rfi.id);
    try {
      const project = projects.find(p => p.id === rfi.project_id);
      const { blob, filename } = generateDelayImpactNoticePDF({ rfi, contract, daysDelayed, project });
      const file = new File([blob], filename, { type: 'application/pdf' });
      const { file_url } = await base44.integrations.Core.UploadFile({ file });

      await base44.entities.Document.create({
        project_id: rfi.project_id,
        name: filename,
        file_url,
        file_name: filename,
        file_size: blob.size,
        file_type: 'application/pdf',
        document_type: 'delay_notice',
        status: 'uploaded',
      });

      await base44.entities.change_orders.create({
        project_id: rfi.project_id,
        change_order_id: `CO-DELAY-${rfi.rfi_number}`,
        description: `Schedule impact from unanswered ${rfi.rfi_number} (${rfi.subject}) — ${daysDelayed} day(s) beyond the contractual RFI response window. Delay Impact Notice attached as supporting legal evidence.`,
        cost_impact: 0,
        schedule_impact: daysDelayed,
        status: 'Pending Review',
        attachment_path: file_url,
      });

      await base44.entities.LegalAuditEvent.create({
        project_id: rfi.project_id,
        event_type: 'delay_impact_notice_generated',
        related_entity_type: 'RFI',
        related_entity_id: rfi.id,
        description: `Delay Impact Notice generated for ${rfi.rfi_number} — ${daysDelayed} day(s) delayed beyond the contractual response window.`,
        severity: 'warning',
      });

      toast({ title: 'Delay Impact Notice generated', description: `Logged to the Change Order queue for ${project?.name || rfi.project_id}.` });
    } catch (e) {
      toast({ title: 'Unable to generate notice', variant: 'destructive' });
    } finally {
      setGeneratingNoticeId(null);
    }
  };

  const handleSave = async () => {
    if (!form.subject || !form.project_id) return;
    setSaving(true);
    try {
      const rfiCount = rfis.filter(r => r.project_id === form.project_id).length + 1;
      await base44.entities.RFI.create({ ...form, rfi_number: `RFI-${String(rfiCount).padStart(3,'0')}`, status: 'draft', date_submitted: new Date().toISOString().split('T')[0] });
      toast({ title: 'RFI created!' });
      setOpen(false);
      setForm({ project_id: '', subject: '', description: '', priority: 'medium' });
      loadData();
    } catch (e) {
      toast({ title: 'Error', variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const filtered = rfis.filter(r => {
    const matchSearch = !search || r.subject?.toLowerCase().includes(search.toLowerCase()) || r.rfi_number?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || r.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const PRIORITY_COLORS = { low: 'text-gray-400', medium: 'text-yellow-500', high: 'text-orange-500', critical: 'text-red-500' };

  const stats = {
    total: rfis.length,
    open: rfis.filter(r => ['submitted','under_review'].includes(r.status)).length,
    answered: rfis.filter(r => r.status === 'answered').length,
    overdue: rfis.filter(r => r.date_required && new Date(r.date_required) < new Date() && r.status !== 'closed').length,
  };

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader
        title="RFIs"
        subtitle="Requests for Information across all projects"
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="steel-gradient text-white border-0"><Plus className="w-4 h-4 mr-2" />New RFI</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create RFI</DialogTitle></DialogHeader>
              <div className="space-y-3 py-2">
                <div>
                  <Label>Project *</Label>
                  <Select value={form.project_id} onValueChange={v => setForm(f => ({ ...f, project_id: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select project" /></SelectTrigger>
                    <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.project_number} — {p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Subject *</Label><Input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} className="mt-1" /></div>
                <div>
                  <Label>Priority</Label>
                  <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{['low','medium','high','critical'].map(p => <SelectItem key={p} value={p}>{p.charAt(0).toUpperCase()+p.slice(1)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Description</Label><Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="mt-1" rows={4} /></div>
                <Button onClick={handleSave} disabled={saving || !form.subject || !form.project_id} className="w-full steel-gradient text-white border-0">
                  {saving ? 'Creating...' : 'Create RFI'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total RFIs', value: stats.total, icon: MessageSquare, color: 'text-blue-500' },
          { label: 'Open', value: stats.open, icon: Clock, color: 'text-orange-500' },
          { label: 'Answered', value: stats.answered, icon: CheckCircle2, color: 'text-green-500' },
          { label: 'Overdue', value: stats.overdue, icon: AlertCircle, color: 'text-red-500' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="steel-card p-4">
            <div className="flex items-center gap-2 mb-1"><Icon className={`w-4 h-4 ${color}`} /><p className="text-xs text-muted-foreground">{label}</p></div>
            <p className={`text-2xl font-bold ${color}`}>{loading ? '—' : value}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search RFIs..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All Statuses" /></SelectTrigger>
          <SelectContent>
            {['all','draft','submitted','under_review','answered','closed'].map(s => (
              <SelectItem key={s} value={s}>{s === 'all' ? 'All Statuses' : s.replace('_',' ').replace(/\b\w/g,c=>c.toUpperCase())}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />)
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 steel-card">
            <MessageSquare className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No RFIs found</p>
          </div>
        ) : (
          filtered.map(r => {
            const proj = projects.find(p => p.id === r.project_id);
            const isOverdue = r.date_required && new Date(r.date_required) < new Date() && r.status !== 'closed';
            const { daysDelayed } = getContractDelinquency(r);
            const isContractuallyDelinquent = daysDelayed > 0;
            return (
              <div key={r.id} className={`steel-card p-4 border-l-4 ${isContractuallyDelinquent ? 'border-l-red-600' : isOverdue ? 'border-l-red-500' : r.priority === 'critical' ? 'border-l-red-400' : r.priority === 'high' ? 'border-l-orange-400' : 'border-l-blue-400'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-xs font-mono font-bold text-primary">{r.rfi_number}</span>
                      <StatusBadge status={r.status} />
                      <span className={`text-xs font-medium ${PRIORITY_COLORS[r.priority]}`}>{r.priority?.toUpperCase()}</span>
                      {isOverdue && <span className="text-xs bg-red-500/10 text-red-500 px-2 py-0.5 rounded-full">OVERDUE</span>}
                      {isContractuallyDelinquent && <span className="text-xs bg-red-600/10 text-red-600 px-2 py-0.5 rounded-full font-medium">{daysDelayed}d PAST CONTRACT WINDOW</span>}
                    </div>
                    <p className="font-medium text-sm">{r.subject}</p>
                    {proj && <p className="text-xs text-muted-foreground mt-1">{proj.project_number} — {proj.name}</p>}
                    {r.date_required && <p className="text-xs text-muted-foreground mt-1">Required by: {r.date_required}</p>}
                  </div>
                  {isContractuallyDelinquent && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-600 border-red-500/30 hover:bg-red-500/10 flex-shrink-0"
                      disabled={generatingNoticeId === r.id}
                      onClick={() => handleGenerateDelayNotice(r)}
                    >
                      <FileWarning className="w-3.5 h-3.5 mr-1.5" />
                      {generatingNoticeId === r.id ? 'Generating…' : 'Generate Delay Impact Notice'}
                    </Button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}