import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { getEffectiveCompany } from '@/lib/tenantContext';
import { hasModule } from '@/lib/moduleEntitlement';
import { getCertStatus } from '@/lib/certAlerts';
import { listEmployeesForRole } from '@/lib/employeesApi';

// Live/expired ordering for the qualified-welders drill-down — expired
// welders surface first so QA can see who dropped off, not just who's
// currently active.
const WELD_CERT_STATUS_SORT = { Expired: 0, Expiring_Soon: 1, Valid: 2 };

// The two AISC certification programs this page tracks. They're distinct
// certs with distinct requirements (shop vs. field), so QA categories,
// certifications, and records all carry a track — see QA_CATEGORIES below
// for which track(s) each checklist item belongs to.
const QA_TRACK = { FABRICATOR: 'fabricator', ERECTOR: 'erector' };

const QA_TRACK_LABELS = {
  [QA_TRACK.FABRICATOR]: 'AISC Fabricator',
  [QA_TRACK.ERECTOR]: 'AISC Erector',
};

// Each category is tagged with the track(s) whose AISC cert program actually
// requires it. Items common to both programs (e.g. NCR procedures, third
// party inspection) are tagged with both tracks and defined once here rather
// than duplicated per-track.
const QA_CATEGORIES = [
  { name: 'AISC Certification', tracks: [QA_TRACK.FABRICATOR, QA_TRACK.ERECTOR] },
  { name: 'Shop QC Program', tracks: [QA_TRACK.FABRICATOR] },
  { name: 'Material Control', tracks: [QA_TRACK.FABRICATOR] },
  { name: 'Welding Procedures (WPS)', tracks: [QA_TRACK.FABRICATOR] },
  { name: 'Welder Qualifications', tracks: [QA_TRACK.FABRICATOR] },
  { name: 'NDT', tracks: [QA_TRACK.FABRICATOR] },
  { name: 'Fit-Up & Dimensional Inspection', tracks: [QA_TRACK.FABRICATOR] },
  { name: 'Surface Preparation', tracks: [QA_TRACK.FABRICATOR] },
  { name: 'Field QC Program', tracks: [QA_TRACK.ERECTOR] },
  { name: 'Erection Procedures', tracks: [QA_TRACK.ERECTOR] },
  { name: 'Bolting Inspection (Snug/Pretensioned, RCT)', tracks: [QA_TRACK.ERECTOR] },
  { name: 'Field Welding', tracks: [QA_TRACK.ERECTOR] },
  { name: 'Plumbness & Alignment Survey', tracks: [QA_TRACK.ERECTOR] },
  { name: 'Safety Program Interface', tracks: [QA_TRACK.ERECTOR] },
  { name: 'Inspection Hold Points', tracks: [QA_TRACK.FABRICATOR, QA_TRACK.ERECTOR] },
  { name: 'Third Party Inspection', tracks: [QA_TRACK.FABRICATOR, QA_TRACK.ERECTOR] },
  { name: 'NCR Procedures', tracks: [QA_TRACK.FABRICATOR, QA_TRACK.ERECTOR] },
];

const QA_CERTIFICATIONS = [
  { cert: 'AISC Fabricator Certification', status: 'verified', expiry: '2026-03-15', tracks: [QA_TRACK.FABRICATOR] },
  { cert: 'AWS Certified Welders (Active)', status: 'verified', expiry: null, tracks: [QA_TRACK.FABRICATOR] },
  { cert: 'WPS / PQR Documents', status: 'pending', expiry: null, tracks: [QA_TRACK.FABRICATOR] },
  { cert: 'SSPC QP 1 Certification', status: 'not_started', expiry: null, tracks: [QA_TRACK.FABRICATOR] },
  { cert: 'AISC Certified Steel Erector', status: 'not_started', expiry: null, tracks: [QA_TRACK.ERECTOR] },
  { cert: 'Rotational Capacity Testing (RCT) Records', status: 'not_started', expiry: null, tracks: [QA_TRACK.ERECTOR] },
  { cert: 'Field Welding Personnel Qualifications', status: 'not_started', expiry: null, tracks: [QA_TRACK.ERECTOR] },
  { cert: 'Erection Safety Program Documentation', status: 'not_started', expiry: null, tracks: [QA_TRACK.ERECTOR] },
  { cert: 'Third Party Inspection Agency', status: 'pending', expiry: null, tracks: [QA_TRACK.FABRICATOR, QA_TRACK.ERECTOR] },
];

const emptyRecordForm = (track) => {
  const resolvedTrack = track || QA_TRACK.FABRICATOR;
  return {
    project_id: '',
    category: QA_CATEGORIES.find(c => c.tracks.includes(resolvedTrack))?.name || QA_CATEGORIES[0].name,
    track: resolvedTrack,
    inspector_name: '',
    inspection_date: new Date().toISOString().slice(0, 10), result: 'Pass', notes: '',
  };
};

export default function Quality() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('findings');
  const [findings, setFindings] = useState([]);
  const [records, setRecords] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState(null);
  const [showNewRecord, setShowNewRecord] = useState(false);
  const [recordForm, setRecordForm] = useState(emptyRecordForm());
  const [savingRecord, setSavingRecord] = useState(false);
  const [detailRecord, setDetailRecord] = useState(null);
  const [company, setCompany] = useState(null);
  const [selectedTrack, setSelectedTrack] = useState(null);
  const [certifications, setCertifications] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [showWeldersList, setShowWeldersList] = useState(false);

  useEffect(() => { loadData(); }, []);
  useEffect(() => { getEffectiveCompany().then(setCompany).catch(() => setCompany(null)); }, []);

  // Fabricator/Erector cert tracks are visible per the same pack gating as
  // the Shop Fabrication and Field Operations modules — Quality itself is a
  // shared page (visible to every pack), so it derives per-track visibility
  // from those pack-exclusive module keys rather than a dedicated one.
  const canFabricator = hasModule(company, '/shop-fabrication');
  const canErector = hasModule(company, '/field-operations');
  const visibleTracks = useMemo(
    () => [canFabricator && QA_TRACK.FABRICATOR, canErector && QA_TRACK.ERECTOR].filter(Boolean),
    [canFabricator, canErector]
  );
  const activeTrack = visibleTracks.includes(selectedTrack) ? selectedTrack : (visibleTracks[0] || QA_TRACK.FABRICATOR);

  const loadData = async () => {
    setLoading(true);
    try {
      const [findingsData, recordsData, projectsData, certData] = await Promise.all([
        db.entities.AIFinding.filter({ review_package: 'quality_assurance' }, '-created_date', 100),
        db.entities.quality_inspection_records.list('-created_date', 200),
        db.entities.Project.list('-created_date', 200),
        db.entities.employee_certifications.list('-created_date', 2000),
      ]);
      setFindings(findingsData);
      setRecords(recordsData);
      setProjects(projectsData);
      setCertifications(certData);
      // Routed through listEmployeesForRole rather than db.entities.employees
      // directly — same masking chokepoint HR itself is built around, so a
      // QA-only role never sees SSN/pay-rate/PIN fields just because this
      // page needs employee names for the welder roster.
      let currentRoles = ['user'];
      try {
        const me = await db.auth.me();
        currentRoles = me?.roles || me?.user?.roles || ['user'];
      } catch (e) {}
      setEmployees(await listEmployeesForRole(currentRoles));
    } catch (e) {} finally { setLoading(false); }
  };

  const projectName = (id) => projects.find(p => p.id === id)?.name || 'Unassigned';

  const employeeById = new Map(employees.map((e) => [e.id, e]));
  // Position-code granularity only — cert_type IS the AWS qualification
  // (6G/3G), there's no finer process/thickness data anywhere in this app
  // to check against (see the WPS/PQR audit — that's a separate, unbuilt
  // data model, not something this page can read yet).
  const weldingCerts = certifications
    .filter((c) => c.cert_type === 'Welding_6G' || c.cert_type === 'Welding_3G')
    .map((c) => ({ ...c, liveStatus: getCertStatus(c.expiration_date) }));
  const activeWeldingCerts = weldingCerts.filter((c) => c.liveStatus !== 'Expired');
  const activeWelderCount = new Set(activeWeldingCerts.map((c) => c.employee_id)).size;
  const awsWeldersStatus = weldingCerts.length === 0 ? 'not_started' : activeWeldingCerts.length > 0 ? 'verified' : 'pending';
  const nextWeldingExpiry = activeWeldingCerts.length > 0
    ? [...activeWeldingCerts].sort((a, b) => (a.expiration_date || '').localeCompare(b.expiration_date || ''))[0].expiration_date
    : null;
  const sortedWeldingCerts = [...weldingCerts].sort((a, b) => {
    const byStatus = (WELD_CERT_STATUS_SORT[a.liveStatus] ?? 2) - (WELD_CERT_STATUS_SORT[b.liveStatus] ?? 2);
    return byStatus !== 0 ? byStatus : (a.expiration_date || '').localeCompare(b.expiration_date || '');
  });

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
        track: recordForm.track,
        inspector_name: recordForm.inspector_name.trim(),
        inspection_date: recordForm.inspection_date,
        result: recordForm.result,
        notes: recordForm.notes.trim(),
      });
      await loadData();
      setShowNewRecord(false);
      setRecordForm(emptyRecordForm(activeTrack));
      toast({ title: 'QA record saved' });
    } finally {
      setSavingRecord(false);
    }
  };

  const filtered = findings.filter(f => {
    if (search && !f.title?.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== 'all' && (statusFilter === 'pending' ? f.review_status !== 'pending' : f.status !== statusFilter)) return false;
    if (categoryFilter && !f.category?.toLowerCase().includes(categoryFilter.toLowerCase().split(' ')[0])) return false;
    return true;
  });

  const jumpToFindings = (status, category) => {
    setStatusFilter(status || 'all');
    setCategoryFilter(category || null);
    setActiveTab('findings');
  };

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
          <Button className="steel-gradient text-white border-0" onClick={() => { setRecordForm(emptyRecordForm(activeTrack)); setShowNewRecord(true); }}><Plus className="w-4 h-4 mr-2" /> New QA Record</Button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        {[
          { label: 'Total QA Findings', value: stats.total, icon: Brain, color: 'text-blue-500', status: 'all' },
          { label: 'Fail', value: stats.fail, icon: XCircle, color: 'text-red-500', status: 'fail' },
          { label: 'Warning', value: stats.warning, icon: AlertTriangle, color: 'text-yellow-500', status: 'warning' },
          { label: 'Pass', value: stats.pass, icon: CheckCircle2, color: 'text-green-500', status: 'pass' },
          { label: 'Pending Review', value: stats.pending, icon: FileText, color: 'text-orange-500', status: 'pending' },
        ].map(({ label, value, icon: Icon, color, status }) => (
          <button key={label} onClick={() => jumpToFindings(status)} className="steel-card p-4 text-left hover:bg-muted/40 transition-colors">
            <div className="flex items-center gap-2 mb-1">
              <Icon className={`w-4 h-4 ${color}`} />
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
            <p className={`text-2xl font-bold ${color}`}>{loading ? '—' : value}</p>
          </button>
        ))}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="findings">AI QA Findings</TabsTrigger>
          <TabsTrigger value="records">Inspection Records</TabsTrigger>
          <TabsTrigger value="checklist">QA Checklist</TabsTrigger>
          <TabsTrigger value="certifications">Certifications</TabsTrigger>
        </TabsList>

        <TabsContent value="findings">
          <div className="mb-4 flex items-center gap-3 flex-wrap">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search QA findings..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
            {(statusFilter !== 'all' || categoryFilter) && (
              <button
                onClick={() => { setStatusFilter('all'); setCategoryFilter(null); }}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary hover:bg-primary/20"
              >
                Filtered: {categoryFilter || statusFilter} — clear
              </button>
            )}
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
                <div
                  key={f.id}
                  onClick={() => f.project_id && navigate(`/projects/${f.project_id}`)}
                  className={`steel-card p-4 border-l-4 ${f.project_id ? 'cursor-pointer hover:bg-muted/40 transition-colors' : ''} ${
                    f.status === 'fail' ? 'border-l-red-500' :
                    f.status === 'warning' ? 'border-l-yellow-500' :
                    f.status === 'pass' ? 'border-l-green-500' : 'border-l-blue-500'
                  }`}
                >
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
                        {r.track && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{QA_TRACK_LABELS[r.track] || r.track}</span>
                        )}
                      </div>
                      <p className="font-medium text-sm">
                        {r.project_id ? (
                          <button onClick={(e) => { e.stopPropagation(); navigate(`/projects/${r.project_id}`); }} className="text-primary hover:underline">{projectName(r.project_id)}</button>
                        ) : projectName(r.project_id)}
                      </p>
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
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <h3 className="font-semibold">Standard QA Checklist Categories</h3>
              {visibleTracks.length > 1 && (
                <div className="inline-flex rounded-lg border border-border p-0.5">
                  {visibleTracks.map(t => (
                    <button
                      key={t}
                      onClick={() => setSelectedTrack(t)}
                      className={`px-3 py-1.5 text-xs rounded-md transition-colors ${activeTrack === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                    >
                      {QA_TRACK_LABELS[t]}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {QA_CATEGORIES.filter(cat => cat.tracks.includes(activeTrack)).map(cat => (
                <button
                  key={cat.name}
                  onClick={() => jumpToFindings(null, cat.name)}
                  className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <CheckSquare className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm">{cat.name}</span>
                  </div>
                  <span className="text-xs text-primary hover:underline">
                    {findings.filter(f => f.category?.toLowerCase().includes(cat.name.toLowerCase().split(' ')[0])).length} findings
                  </span>
                </button>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="certifications">
          <div className="steel-card p-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <h3 className="font-semibold">Required Certifications Tracker</h3>
              {visibleTracks.length > 1 && (
                <div className="inline-flex rounded-lg border border-border p-0.5">
                  {visibleTracks.map(t => (
                    <button
                      key={t}
                      onClick={() => setSelectedTrack(t)}
                      className={`px-3 py-1.5 text-xs rounded-md transition-colors ${activeTrack === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                    >
                      {QA_TRACK_LABELS[t]}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-3">
              {QA_CERTIFICATIONS.filter(item => item.tracks.includes(activeTrack)).map(item => {
                // "AWS Certified Welders (Active)" is the one item on this
                // list backed by real data — everything else here is still
                // a manually-tracked placeholder (see the audit: no WPS/PQR
                // data model exists yet to compute the rest from).
                const isWelders = item.cert === 'AWS Certified Welders (Active)';
                const status = isWelders ? awsWeldersStatus : item.status;
                const expiry = isWelders ? nextWeldingExpiry : item.expiry;
                return (
                  <div
                    key={item.cert}
                    onClick={isWelders ? () => setShowWeldersList(true) : undefined}
                    className={`flex items-center justify-between p-4 rounded-lg border border-border ${isWelders ? 'cursor-pointer hover:bg-muted/40 transition-colors' : ''}`}
                  >
                    <div className="flex items-center gap-3">
                      {status === 'verified'
                        ? <CheckCircle2 className="w-5 h-5 text-green-500" />
                        : status === 'pending'
                        ? <Clock className="w-5 h-5 text-yellow-500" />
                        : <XCircle className="w-5 h-5 text-red-500" />
                      }
                      <div>
                        <p className="text-sm font-medium">{item.cert}</p>
                        {isWelders ? (
                          <>
                            <p className="text-xs text-primary hover:underline">{activeWelderCount} active welder{activeWelderCount === 1 ? '' : 's'} — see all qualified welders</p>
                            {expiry && <p className="text-xs text-muted-foreground">Next expiration: {expiry}</p>}
                          </>
                        ) : expiry && <p className="text-xs text-muted-foreground">Expires: {expiry}</p>}
                      </div>
                    </div>
                    <StatusBadge
                      status={status === 'verified' ? 'pass' : status === 'pending' ? 'warning' : 'fail'}
                      label={status === 'verified' ? 'Verified' : status === 'pending' ? 'Pending' : 'Required'}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={showNewRecord} onOpenChange={(open) => { setShowNewRecord(open); if (!open) setRecordForm(emptyRecordForm(activeTrack)); }}>
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
            {visibleTracks.length > 1 && (
              <div>
                <Label>AISC Track</Label>
                <Select
                  value={recordForm.track}
                  onValueChange={(v) => setRecordForm(f => {
                    const validCats = QA_CATEGORIES.filter(cat => cat.tracks.includes(v));
                    const category = validCats.some(cat => cat.name === f.category) ? f.category : (validCats[0]?.name || '');
                    return { ...f, track: v, category };
                  })}
                >
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{visibleTracks.map(t => <SelectItem key={t} value={t}>{QA_TRACK_LABELS[t]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Category</Label>
              <Select value={recordForm.category} onValueChange={(v) => setRecordForm(f => ({ ...f, category: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {QA_CATEGORIES.filter(cat => cat.tracks.includes(recordForm.track)).map(cat => (
                    <SelectItem key={cat.name} value={cat.name}>{cat.name}</SelectItem>
                  ))}
                </SelectContent>
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
                  {detailRecord.track && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{QA_TRACK_LABELS[detailRecord.track] || detailRecord.track}</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Project</p>
                    {detailRecord.project_id ? (
                      <button onClick={() => navigate(`/projects/${detailRecord.project_id}`)} className="font-medium text-primary hover:underline">{projectName(detailRecord.project_id)}</button>
                    ) : (
                      <p className="font-medium">{projectName(detailRecord.project_id)}</p>
                    )}
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

      <Dialog open={showWeldersList} onOpenChange={setShowWeldersList}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Qualified Welders — Welding 6G / 3G</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            {sortedWeldingCerts.length === 0 ? (
              <p className="text-muted-foreground text-center py-6">No Welding_6G/3G certifications on file.</p>
            ) : sortedWeldingCerts.map((cert) => {
              const employee = employeeById.get(cert.employee_id);
              return (
                <div key={cert.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                  <div>
                    {employee ? (
                      <button onClick={() => navigate(`/human-resources?employee=${employee.id}`)} className="font-medium text-primary hover:underline">{employee.full_name}</button>
                    ) : (
                      <p className="font-medium text-muted-foreground">Unknown employee</p>
                    )}
                    <p className="text-xs text-muted-foreground">{cert.cert_type.replace(/_/g, ' ')} • exp {cert.expiration_date || '—'}</p>
                  </div>
                  <StatusBadge
                    status={cert.liveStatus === 'Valid' ? 'pass' : cert.liveStatus === 'Expiring_Soon' ? 'warning' : 'fail'}
                    label={cert.liveStatus.replace('_', ' ')}
                  />
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowWeldersList(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}