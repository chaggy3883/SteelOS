import React, { useState, useEffect } from 'react';
import { db } from '@/api/apiClient';
import { CheckSquare, AlertTriangle, XCircle, FileText, Brain, CheckCircle2, Plus, Search, Clock, ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const QA_CATEGORIES = [
  'AISC Certification', 'Welding Requirements', 'Inspection Hold Points',
  'Material Traceability', 'Surface Preparation', 'Bolting Inspection',
  'Third Party Inspection', 'NCR Procedures'
];

const emptyRecordForm = () => ({
  project_id: '', category: QA_CATEGORIES[0], inspector_name: '',
  inspection_date: new Date().toISOString().slice(0, 10), result: 'Pass', notes: '',
});

export default function Quality() {
  const { toast } = useToast();
  const [findings, setFindings] = useState([]);
  const [records, setRecords] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showNewRecord, setShowNewRecord] = useState(false);
  const [recordForm, setRecordForm] = useState(emptyRecordForm());
  const [savingRecord, setSavingRecord] = useState(false);
  const [detailRecord, setDetailRecord] = useState(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [findingsData, recordsData, projectsData] = await Promise.all([
        db.entities.AIFinding.filter({ review_package: 'quality_assurance' }, '-created_date', 100),
        db.entities.quality_inspection_records.list('-created_date', 200),
        db.entities.Project.list('-created_date', 200),
      ]);
      setFindings(findingsData);
      setRecords(recordsData);
      setProjects(projectsData);
    } catch (e) {} finally { setLoading(false); }
  };

  const projectName = (id) => projects.find(p => p.id === id)?.name || 'Unassigned';

  const handleCreateRecord = async () => {
    if (!recordForm.inspector_name.trim() || !recordForm.inspection_date) {
      toast({ title: 'Inspector name and inspection date are required', variant: 'destructive' });
      return;
    }
    setSavingRecord(true);
    try {
      await db.entities.quality_inspection_records.create({
        project_id: recordForm.project_id,
        category: recordForm.category,
        inspector_name: recordForm.inspector_name.trim(),
        inspection_date: recordForm.inspection_date,
        result: recordForm.result,
        notes: recordForm.notes.trim(),
      });
      await loadData();
      setShowNewRecord(false);
      setRecordForm(emptyRecordForm());
      toast({ title: 'QA record saved' });
    } finally {
      setSavingRecord(false);
    }
  };

  const filtered = findings.filter(f =>
    !search || f.title?.toLowerCase().includes(search.toLowerCase())
  );

  const stats = {
    total: findings.length,
    fail: findings.filter(f => f.status === 'fail').length,
    warning: findings.filter(f => f.status === 'warning').length,
    pass: findings.filter(f => f.status === 'pass').length,
    pending: findings.filter(f => f.review_status === 'pending').length,
  };

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader
        title="Quality Assurance"
        subtitle="QA review findings, inspection records, and compliance tracking"
        actions={
          <Button className="steel-gradient text-white border-0" onClick={() => setShowNewRecord(true)}><Plus className="w-4 h-4 mr-2" /> New QA Record</Button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        {[
          { label: 'Total QA Findings', value: stats.total, icon: Brain, color: 'text-blue-500' },
          { label: 'Fail', value: stats.fail, icon: XCircle, color: 'text-red-500' },
          { label: 'Warning', value: stats.warning, icon: AlertTriangle, color: 'text-yellow-500' },
          { label: 'Pass', value: stats.pass, icon: CheckCircle2, color: 'text-green-500' },
          { label: 'Pending Review', value: stats.pending, icon: FileText, color: 'text-orange-500' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="steel-card p-4">
            <div className="flex items-center gap-2 mb-1">
              <Icon className={`w-4 h-4 ${color}`} />
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
            <p className={`text-2xl font-bold ${color}`}>{loading ? '—' : value}</p>
          </div>
        ))}
      </div>

      <Tabs defaultValue="findings">
        <TabsList className="mb-4">
          <TabsTrigger value="findings">AI QA Findings</TabsTrigger>
          <TabsTrigger value="records">Inspection Records</TabsTrigger>
          <TabsTrigger value="checklist">QA Checklist</TabsTrigger>
          <TabsTrigger value="certifications">Certifications</TabsTrigger>
        </TabsList>

        <TabsContent value="findings">
          <div className="mb-4">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search QA findings..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
          </div>
          <div className="space-y-3">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />)
            ) : filtered.length === 0 ? (
              <div className="text-center py-16 steel-card">
                <CheckSquare className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No QA findings yet. Upload project documents to generate AI analysis.</p>
              </div>
            ) : (
              filtered.map(f => (
                <div key={f.id} className={`steel-card p-4 border-l-4 ${
                  f.status === 'fail' ? 'border-l-red-500' :
                  f.status === 'warning' ? 'border-l-yellow-500' :
                  f.status === 'pass' ? 'border-l-green-500' : 'border-l-blue-500'
                }`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <StatusBadge status={f.status} />
                        {f.risk_level && <StatusBadge status={f.risk_level} />}
                        <span className="text-xs text-muted-foreground">{f.category}</span>
                      </div>
                      <p className="font-medium text-sm">{f.title}</p>
                      {f.ai_explanation && <p className="text-xs text-muted-foreground mt-1 line-clamp-2" title={f.ai_explanation}>{f.ai_explanation}</p>}
                      {f.specification_section && (
                        <p className="text-xs text-primary mt-1">§{f.specification_section} {f.page_number ? `• Pg. ${f.page_number}` : ''}</p>
                      )}
                    </div>
                    <StatusBadge status={f.review_status} label={f.review_status?.replace('_', ' ')} />
                  </div>
                </div>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="records">
          <div className="space-y-3">
            {records.length === 0 ? (
              <div className="text-center py-16 steel-card">
                <ClipboardList className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No inspection records yet. Click "New QA Record" to log one.</p>
              </div>
            ) : (
              records.map(r => (
                <div
                  key={r.id}
                  onClick={() => setDetailRecord(r)}
                  className={`steel-card p-4 border-l-4 cursor-pointer hover:bg-muted/40 transition-colors ${
                    r.result === 'Fail' ? 'border-l-red-500' :
                    r.result === 'Warning' ? 'border-l-yellow-500' : 'border-l-green-500'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <StatusBadge status={r.result?.toLowerCase()} label={r.result} />
                        <span className="text-xs text-muted-foreground">{r.category}</span>
                      </div>
                      <p className="font-medium text-sm">{projectName(r.project_id)}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {r.inspector_name} • {r.inspection_date}
                      </p>
                      {r.notes && <p className="text-xs text-muted-foreground mt-1 line-clamp-2" title={r.notes}>{r.notes}</p>}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="checklist">
          <div className="steel-card p-5">
            <h3 className="font-semibold mb-4">Standard QA Checklist Categories</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {QA_CATEGORIES.map(cat => (
                <div key={cat} className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted transition-colors">
                  <div className="flex items-center gap-3">
                    <CheckSquare className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm">{cat}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {findings.filter(f => f.category?.toLowerCase().includes(cat.toLowerCase().split(' ')[0])).length} findings
                  </span>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="certifications">
          <div className="steel-card p-5">
            <h3 className="font-semibold mb-4">Required Certifications Tracker</h3>
            <div className="space-y-3">
              {[
                { cert: 'AISC Fabricator Certification', status: 'verified', expiry: '2026-03-15' },
                { cert: 'AWS Certified Welders (Active)', status: 'verified', expiry: null },
                { cert: 'WPS / PQR Documents', status: 'pending', expiry: null },
                { cert: 'SSPC QP 1 Certification', status: 'not_started', expiry: null },
                { cert: 'Third Party Inspection Agency', status: 'pending', expiry: null },
              ].map(item => (
                <div key={item.cert} className="flex items-center justify-between p-4 rounded-lg border border-border">
                  <div className="flex items-center gap-3">
                    {item.status === 'verified'
                      ? <CheckCircle2 className="w-5 h-5 text-green-500" />
                      : item.status === 'pending'
                      ? <Clock className="w-5 h-5 text-yellow-500" />
                      : <XCircle className="w-5 h-5 text-red-500" />
                    }
                    <div>
                      <p className="text-sm font-medium">{item.cert}</p>
                      {item.expiry && <p className="text-xs text-muted-foreground">Expires: {item.expiry}</p>}
                    </div>
                  </div>
                  <StatusBadge
                    status={item.status === 'verified' ? 'pass' : item.status === 'pending' ? 'warning' : 'fail'}
                    label={item.status === 'verified' ? 'Verified' : item.status === 'pending' ? 'Pending' : 'Required'}
                  />
                </div>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={showNewRecord} onOpenChange={(open) => { setShowNewRecord(open); if (!open) setRecordForm(emptyRecordForm()); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>New QA Record</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Project</Label>
              <Select value={recordForm.project_id} onValueChange={(v) => setRecordForm(f => ({ ...f, project_id: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Category</Label>
              <Select value={recordForm.category} onValueChange={(v) => setRecordForm(f => ({ ...f, category: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{QA_CATEGORIES.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Inspector Name</Label>
                <Input value={recordForm.inspector_name} onChange={(e) => setRecordForm(f => ({ ...f, inspector_name: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label>Inspection Date</Label>
                <Input type="date" value={recordForm.inspection_date} onChange={(e) => setRecordForm(f => ({ ...f, inspection_date: e.target.value }))} className="mt-1" />
              </div>
            </div>
            <div>
              <Label>Result</Label>
              <Select value={recordForm.result} onValueChange={(v) => setRecordForm(f => ({ ...f, result: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Pass">Pass</SelectItem>
                  <SelectItem value="Fail">Fail</SelectItem>
                  <SelectItem value="Warning">Warning</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea rows={3} value={recordForm.notes} onChange={(e) => setRecordForm(f => ({ ...f, notes: e.target.value }))} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewRecord(false)}>Cancel</Button>
            <Button onClick={handleCreateRecord} disabled={savingRecord} className="steel-gradient text-white border-0">
              {savingRecord ? 'Saving…' : 'Save Record'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detailRecord} onOpenChange={(open) => !open && setDetailRecord(null)}>
        <DialogContent>
          {detailRecord && (
            <>
              <DialogHeader><DialogTitle>QA Inspection Record</DialogTitle></DialogHeader>
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <StatusBadge status={detailRecord.result?.toLowerCase()} label={detailRecord.result} />
                  <span className="text-muted-foreground">{detailRecord.category}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Project</p>
                    <p className="font-medium">{projectName(detailRecord.project_id)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Inspection Date</p>
                    <p className="font-medium">{detailRecord.inspection_date}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Inspector</p>
                    <p className="font-medium">{detailRecord.inspector_name}</p>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Notes</p>
                  <p className="mt-1">{detailRecord.notes || '—'}</p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDetailRecord(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}