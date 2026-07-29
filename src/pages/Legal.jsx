import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/ui/PageHeader';
import { Scale, ShieldAlert, FileText, Upload, Brain, AlertTriangle, ScrollText } from 'lucide-react';
import { computeRiskFlags, RISK_FLAG_LABELS } from '@/lib/legalBaselines';

const LEGAL_ROLES = ['admin', 'president', 'ceo'];

const emptyContractForm = () => ({ project_id: '', gc_name: '', contract_value: '' });
const emptyNoticeEdits = {};

export default function Legal() {
  const { toast } = useToast();
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [notices, setNotices] = useState([]);
  const [auditEvents, setAuditEvents] = useState([]);

  const [contractForm, setContractForm] = useState(emptyContractForm());
  const [contractFile, setContractFile] = useState(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    base44.auth.me().then((u) => { setCurrentUser(u); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  useEffect(() => { if (currentUser) loadData(); }, [currentUser]);

  const loadData = async () => {
    try {
      const [projectList, contractList, noticeList, eventList] = await Promise.all([
        base44.entities.Project.list('-created_date', 200),
        base44.entities.Contract.list('-created_date', 100),
        base44.entities.StatutoryNotice.list('-created_date', 100),
        base44.entities.LegalAuditEvent.list('-created_date', 200),
      ]);
      setProjects(projectList);
      setContracts(contractList);
      setNotices(noticeList);
      setAuditEvents(eventList);
      await flagExpiringNotices(noticeList, eventList);
    } catch (e) {}
  };

  // Logs a statutory_deadline_warning audit event once per notice when it enters
  // the 10-day red-flag window without a filed copy — guarded against re-firing
  // on every page load by checking existing audit events first.
  const flagExpiringNotices = async (noticeList, eventList) => {
    const today = new Date();
    for (const notice of noticeList) {
      if (notice.filed_status === 'filed' || notice.filed_status === 'not_required') continue;
      const daysUntil = Math.ceil((new Date(notice.deadline_date) - today) / (1000 * 60 * 60 * 24));
      if (daysUntil > 10) continue;
      const alreadyLogged = eventList.some((e) => e.event_type === 'statutory_deadline_warning' && e.related_entity_id === notice.id);
      if (alreadyLogged) continue;
      await base44.entities.LegalAuditEvent.create({
        project_id: notice.project_id,
        event_type: 'statutory_deadline_warning',
        related_entity_type: 'StatutoryNotice',
        related_entity_id: notice.id,
        severity: 'critical',
        description: daysUntil < 0
          ? `Statutory notice deadline for project has EXPIRED (${Math.abs(daysUntil)} day(s) ago) without a filed copy.`
          : `Statutory notice deadline is ${daysUntil} day(s) away without a filed copy.`,
      });
    }
  };

  const projectName = (projectId) => projects.find((p) => p.id === projectId)?.name || projectId;

  const handleScanContract = async () => {
    if (!contractForm.project_id || !contractForm.gc_name || !contractFile) {
      toast({ title: 'Project, GC Name, and a contract PDF are required', variant: 'destructive' });
      return;
    }
    setScanning(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file: contractFile });
      const document = await base44.entities.Document.create({
        project_id: contractForm.project_id,
        name: contractFile.name,
        file_url,
        file_name: contractFile.name,
        file_size: contractFile.size,
        file_type: contractFile.type,
        document_type: 'contract',
        status: 'uploaded',
        ai_processing_status: 'pending',
      });

      const response = await base44.integrations.Core.InvokeLLM({
        prompt: 'You are a construction contract review assistant. Extract from the attached General Contractor agreement: liquidated_damages_per_day (number, $ per day of delay), notice_cure_days (number, days allowed to notify of delay/extra work), rfi_response_window_days (number, contractual days for architect/engineer RFI responses), retainage_pct (decimal fraction, e.g. 0.10), retainage_release_terms (string), and a short summary. Set unknown numeric fields to 0.',
        file_urls: [file_url],
        response_json_schema: {
          type: 'object',
          properties: {
            liquidated_damages_per_day: { type: 'number' },
            notice_cure_days: { type: 'number' },
            rfi_response_window_days: { type: 'number' },
            retainage_pct: { type: 'number' },
            retainage_release_terms: { type: 'string' },
            summary: { type: 'string' },
          },
        },
      });

      const contractPayload = {
        project_id: contractForm.project_id,
        gc_name: contractForm.gc_name,
        contract_value: Number(contractForm.contract_value) || 0,
        contract_document_id: document.id,
        liquidated_damages_per_day: Number(response?.liquidated_damages_per_day) || 0,
        notice_cure_days: Number(response?.notice_cure_days) || 0,
        rfi_response_window_days: Number(response?.rfi_response_window_days) || 0,
        retainage_pct: Number(response?.retainage_pct) || 0.10,
        retainage_release_terms: String(response?.retainage_release_terms || ''),
        ai_extraction_summary: String(response?.summary || ''),
        ai_scan_status: 'complete',
        status: 'active',
      };
      const riskFlags = await computeRiskFlags(contractPayload);
      const contract = await base44.entities.Contract.create({ ...contractPayload, risk_flags: riskFlags });

      await base44.entities.LegalAuditEvent.create({
        project_id: contractForm.project_id,
        event_type: 'contract_scanned',
        related_entity_type: 'Contract',
        related_entity_id: contract.id,
        description: `Contract with ${contract.gc_name} scanned; ${riskFlags.length} risk flag(s) found.`,
        severity: riskFlags.length > 0 ? 'warning' : 'info',
      });
      for (const flag of riskFlags) {
        await base44.entities.LegalAuditEvent.create({
          project_id: contractForm.project_id,
          event_type: 'risk_flag_raised',
          related_entity_type: 'Contract',
          related_entity_id: contract.id,
          description: RISK_FLAG_LABELS[flag] || flag,
          severity: 'warning',
        });
      }

      toast({ title: 'Contract scanned', description: riskFlags.length > 0 ? `${riskFlags.length} risk flag(s) found` : 'No risk flags found' });
      setContractForm(emptyContractForm());
      setContractFile(null);
      loadData();
    } catch (e) {
      toast({ title: 'Contract scan failed', variant: 'destructive' });
    } finally {
      setScanning(false);
    }
  };

  const handleNoticeFieldSave = async (notice, patch) => {
    try {
      const updated = await base44.entities.StatutoryNotice.update(notice.id, patch);
      setNotices((prev) => prev.map((n) => (n.id === notice.id ? updated : n)));
    } catch (e) {
      toast({ title: 'Unable to save notice', variant: 'destructive' });
    }
  };

  const handleFiledUpload = async (notice, file) => {
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      const doc = await base44.entities.Document.create({
        project_id: notice.project_id,
        name: file.name,
        file_url,
        file_name: file.name,
        file_size: file.size,
        file_type: file.type,
        document_type: notice.notice_type === 'notice_to_owner' ? 'other' : 'other',
        status: 'uploaded',
      });
      await handleNoticeFieldSave(notice, {
        filed_status: 'filed',
        filed_document_id: doc.id,
        filed_date: new Date().toISOString().slice(0, 10),
      });
      await base44.entities.LegalAuditEvent.create({
        project_id: notice.project_id,
        event_type: 'statutory_notice_filed',
        related_entity_type: 'StatutoryNotice',
        related_entity_id: notice.id,
        description: `Proof of filing uploaded for ${notice.notice_type.replace(/_/g, ' ')}.`,
      });
      toast({ title: 'Filed copy uploaded' });
    } catch (e) {
      toast({ title: 'Upload failed', variant: 'destructive' });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const isAuthorized = (currentUser?.roles || []).some(r => LEGAL_ROLES.includes(r)) || currentUser?.is_admin === true;

  if (!isAuthorized) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3">
        <ShieldAlert className="w-12 h-12 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Executive Access Required</h2>
        <p className="text-sm text-muted-foreground">Contract & legal data is restricted to Executive and Administrator roles.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto animate-fade-in">
      <PageHeader title="Legal & Contracts" subtitle="Contract risk, statutory lien rights, and legal audit trail — Executive/Admin only" />

      <Tabs defaultValue="contracts">
        <TabsList className="mb-6">
          <TabsTrigger value="contracts"><Scale className="w-4 h-4 mr-1.5" />Contracts</TabsTrigger>
          <TabsTrigger value="lien"><ShieldAlert className="w-4 h-4 mr-1.5" />Lien Rights Radar</TabsTrigger>
          <TabsTrigger value="audit"><ScrollText className="w-4 h-4 mr-1.5" />Audit Log</TabsTrigger>
        </TabsList>

        <TabsContent value="contracts" className="space-y-4">
          <div className="steel-card p-5">
            <h3 className="font-semibold mb-1 flex items-center gap-2"><Brain className="w-4 h-4 text-primary" />Scan a GC Contract</h3>
            <p className="text-xs text-muted-foreground mb-3">Uploads the contract PDF and runs the AI legal-clause extraction (liquidated damages, notice/cure windows, retainage) against company baselines.</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Project</Label>
                <Select value={contractForm.project_id} onValueChange={(v) => setContractForm((f) => ({ ...f, project_id: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select a project" /></SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">General Contractor</Label>
                <Input value={contractForm.gc_name} onChange={(e) => setContractForm((f) => ({ ...f, gc_name: e.target.value }))} className="mt-1" placeholder="e.g. Turner Construction" />
              </div>
              <div>
                <Label className="text-xs">Contract Value ($)</Label>
                <Input type="number" value={contractForm.contract_value} onChange={(e) => setContractForm((f) => ({ ...f, contract_value: e.target.value }))} className="mt-1" />
              </div>
            </div>
            <div className="mt-3">
              <Label className="text-xs">Contract PDF</Label>
              <input
                type="file"
                accept=".pdf"
                onChange={(e) => setContractFile(e.target.files?.[0] || null)}
                className="mt-1 block w-full text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground file:text-xs"
              />
            </div>
            <div className="flex justify-end mt-3">
              <Button onClick={handleScanContract} disabled={scanning} className="steel-gradient text-white border-0">
                {scanning ? 'Scanning…' : <><Upload className="w-4 h-4 mr-2" />Upload & Scan Contract</>}
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            {contracts.length === 0 ? (
              <div className="steel-card p-8 text-center text-sm text-muted-foreground">No contracts scanned yet.</div>
            ) : (
              contracts.map((c) => (
                <div key={c.id} className="steel-card p-5">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h4 className="font-semibold">{c.gc_name}</h4>
                      <p className="text-xs text-muted-foreground">{projectName(c.project_id)} · ${Number(c.contract_value || 0).toLocaleString()}</p>
                    </div>
                    <Badge variant={c.risk_flags?.length > 0 ? 'destructive' : 'secondary'}>{c.risk_flags?.length > 0 ? `${c.risk_flags.length} risk flag(s)` : 'No flags'}</Badge>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs mb-3">
                    <div className="bg-muted rounded p-2"><p className="text-muted-foreground">Liquidated Damages</p><p className="font-mono font-bold">${Number(c.liquidated_damages_per_day || 0).toLocaleString()}/day</p></div>
                    <div className="bg-muted rounded p-2"><p className="text-muted-foreground">Notice/Cure</p><p className="font-mono font-bold">{c.notice_cure_days || 0} days</p></div>
                    <div className="bg-muted rounded p-2"><p className="text-muted-foreground">RFI Response Window</p><p className="font-mono font-bold">{c.rfi_response_window_days || 0} days</p></div>
                    <div className="bg-muted rounded p-2"><p className="text-muted-foreground">Retainage</p><p className="font-mono font-bold">{((c.retainage_pct || 0) * 100).toFixed(1)}%</p></div>
                  </div>
                  {c.risk_flags?.length > 0 && (
                    <div className="space-y-1 mb-2">
                      {c.risk_flags.map((flag) => (
                        <div key={flag} className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
                          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />{RISK_FLAG_LABELS[flag] || flag}
                        </div>
                      ))}
                    </div>
                  )}
                  {c.ai_extraction_summary && <p className="text-xs text-muted-foreground italic">{c.ai_extraction_summary}</p>}
                </div>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="lien">
          <LienRightsRadar
            notices={notices}
            projectName={projectName}
            onFieldSave={handleNoticeFieldSave}
            onFiledUpload={handleFiledUpload}
          />
        </TabsContent>

        <TabsContent value="audit">
          <div className="steel-card overflow-hidden">
            <div className="p-4 border-b border-border">
              <h3 className="font-semibold flex items-center gap-2"><FileText className="w-4 h-4 text-primary" />Legal Audit Trail</h3>
            </div>
            {auditEvents.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">No legal audit events yet.</p>
            ) : (
              <div className="divide-y divide-border max-h-[600px] overflow-y-auto">
                {auditEvents.map((e) => (
                  <div key={e.id} className="p-4 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{e.description}</p>
                      <p className="text-xs text-muted-foreground">{projectName(e.project_id)} · {e.event_type.replace(/_/g, ' ')} · {e.created_date?.slice(0, 10)}</p>
                    </div>
                    <Badge variant={e.severity === 'critical' ? 'destructive' : e.severity === 'warning' ? 'default' : 'secondary'}>{e.severity}</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function LienRightsRadar({ notices, projectName, onFieldSave, onFiledUpload }) {
  const [edits, setEdits] = useState(emptyNoticeEdits);

  const getField = (notice, field) => edits[notice.id]?.[field] ?? notice[field] ?? '';
  const setField = (noticeId, field, value) => setEdits((prev) => ({ ...prev, [noticeId]: { ...prev[noticeId], [field]: value } }));

  const daysUntil = (notice) => Math.ceil((new Date(notice.deadline_date) - new Date()) / (1000 * 60 * 60 * 24));

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground -mt-2">
        Statutory deadlines are illustrative estimates for a limited set of states — verify against current statutes with legal counsel before relying on any date shown here for an actual filing.
      </p>
      {notices.length === 0 ? (
        <div className="steel-card p-8 text-center text-sm text-muted-foreground">No statutory notices tracked yet. Mark a project "Awarded" from its Project Detail page to start one.</div>
      ) : (
        notices.map((notice) => {
          const remaining = daysUntil(notice);
          const isExpired = remaining < 0 && notice.filed_status !== 'filed' && notice.filed_status !== 'not_required';
          const isDanger = !isExpired && remaining <= 10 && notice.filed_status !== 'filed' && notice.filed_status !== 'not_required';
          return (
            <div key={notice.id} className={`steel-card p-5 ${isExpired ? 'border-red-600 border-2' : isDanger ? 'border-red-500/50 border-2' : ''}`}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h4 className="font-semibold">{projectName(notice.project_id)}</h4>
                  <p className="text-xs text-muted-foreground">{notice.state} · {notice.notice_type.replace(/_/g, ' ')} · deadline {notice.deadline_date}</p>
                </div>
                <div className="flex items-center gap-2">
                  {isExpired && <Badge variant="destructive">EXPIRED {Math.abs(remaining)}d ago</Badge>}
                  {isDanger && <Badge variant="destructive">{remaining}d left — not filed</Badge>}
                  {notice.filed_status === 'filed' && <Badge variant="secondary">Filed {notice.filed_date}</Badge>}
                  {!isExpired && !isDanger && notice.filed_status === 'pending' && <Badge variant="outline">{remaining}d left</Badge>}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div>
                  <Label className="text-xs">Property Owner Name</Label>
                  <Input value={getField(notice, 'owner_name')} onChange={(e) => setField(notice.id, 'owner_name', e.target.value)} onBlur={() => onFieldSave(notice, { owner_name: getField(notice, 'owner_name') })} className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Legal Description</Label>
                  <Input value={getField(notice, 'legal_description')} onChange={(e) => setField(notice.id, 'legal_description', e.target.value)} onBlur={() => onFieldSave(notice, { legal_description: getField(notice, 'legal_description') })} className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Construction Lender</Label>
                  <Input value={getField(notice, 'lender_name')} onChange={(e) => setField(notice.id, 'lender_name', e.target.value)} onBlur={() => onFieldSave(notice, { lender_name: getField(notice, 'lender_name') })} className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Lender Address</Label>
                  <Input value={getField(notice, 'lender_address')} onChange={(e) => setField(notice.id, 'lender_address', e.target.value)} onBlur={() => onFieldSave(notice, { lender_address: getField(notice, 'lender_address') })} className="mt-1" />
                </div>
              </div>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                <div>
                  <Label className="text-xs">Filed Status</Label>
                  <Select value={notice.filed_status} onValueChange={(v) => onFieldSave(notice, { filed_status: v })}>
                    <SelectTrigger className="mt-1 w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="filed">Filed</SelectItem>
                      <SelectItem value="not_required">Not Required</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Upload Verified Filed Copy</Label>
                  <input
                    type="file"
                    onChange={(e) => e.target.files?.[0] && onFiledUpload(notice, e.target.files[0])}
                    className="mt-1 block text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground file:text-xs"
                  />
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
