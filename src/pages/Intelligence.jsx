import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import {
  Brain, Upload, FileText, AlertTriangle, CheckCircle2,
  XCircle, HelpCircle, Eye, ChevronDown, ChevronRight,
  Zap, Filter, RefreshCw, Search, Building2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import StatusBadge from '@/components/ui/StatusBadge';
import PageHeader from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/use-toast';

const REVIEW_PACKAGES = ['estimating', 'quality_assurance', 'safety', 'purchasing', 'accounting', 'executive'];

const STEEL_SYSTEM_PROMPT = `You are an expert Senior Structural Steel Estimator and ERP specialist with 25+ years of experience reviewing structural steel fabrication contracts and specifications.

You have deep expertise in:
- AISC standards and certifications
- AWS D1.1 and D1.5 Structural Welding Codes
- CSI Division 05 (Metals) specifications
- SSPC/AMPP surface preparation standards
- OSHA construction safety regulations  
- Structural steel fabrication processes (fit-up, welding, painting, galvanizing)
- Contract risk analysis for steel fabricators
- Material traceability (MTRs, heat numbers, charpy testing)
- Inspection hold points, witness points, third-party inspection
- Erection, temporary bracing, and connection design

When reviewing documents, you reason through them EXACTLY as an experienced structural steel professional would.`;

const FindingCard = ({ finding, onUpdate }) => {
  const [expanded, setExpanded] = useState(false);
  const [updating, setUpdating] = useState(false);

  const statusIcons = {
    pass: <CheckCircle2 className="w-4 h-4 text-green-500" />,
    warning: <AlertTriangle className="w-4 h-4 text-yellow-500" />,
    fail: <XCircle className="w-4 h-4 text-red-500" />,
    not_found: <HelpCircle className="w-4 h-4 text-gray-400" />,
    manual_review: <Eye className="w-4 h-4 text-blue-500" />,
  };

  const handleReview = async (status) => {
    setUpdating(true);
    try {
      await base44.entities.AIFinding.update(finding.id, { review_status: status, reviewed_by: 'Current User' });
      onUpdate();
    } catch (e) {} finally { setUpdating(false); }
  };

  return (
    <div className={`border rounded-lg overflow-hidden transition-all ${
      finding.status === 'fail' ? 'border-red-500/30 bg-red-500/5' :
      finding.status === 'warning' ? 'border-yellow-500/30 bg-yellow-500/5' :
      finding.status === 'pass' ? 'border-green-500/30 bg-green-500/5' :
      'border-border bg-card'
    }`}>
      <button
        className="w-full flex items-start gap-3 p-4 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="mt-0.5 flex-shrink-0">{statusIcons[finding.status] || statusIcons.manual_review}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-semibold">{finding.title}</span>
            {finding.risk_level && (
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                finding.risk_level === 'critical' ? 'bg-red-600/20 text-red-500' :
                finding.risk_level === 'high' ? 'bg-red-500/15 text-red-500' :
                finding.risk_level === 'medium' ? 'bg-yellow-500/15 text-yellow-500' :
                'bg-green-500/15 text-green-500'
              }`}>{finding.risk_level} risk</span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {finding.csi_division && <span>Div. {finding.csi_division}</span>}
            {finding.specification_section && <span>§{finding.specification_section}</span>}
            {finding.page_number && <span>Pg. {finding.page_number}</span>}
            {finding.confidence_score && <span>{Math.round(finding.confidence_score * 100)}% confidence</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <StatusBadge status={finding.review_status} label={finding.review_status?.replace('_', ' ')} />
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border/50 pt-3">
          {finding.quoted_text && (
            <div className="bg-muted/50 rounded-lg p-3 border-l-2 border-primary">
              <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">Quoted Text</p>
              <p className="text-sm italic">"{finding.quoted_text}"</p>
            </div>
          )}
          {finding.ai_explanation && (
            <div>
              <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">AI Analysis</p>
              <p className="text-sm">{finding.ai_explanation}</p>
            </div>
          )}
          {finding.recommendation && (
            <div>
              <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">Recommendation</p>
              <p className="text-sm text-primary">{finding.recommendation}</p>
            </div>
          )}
          {finding.estimated_financial_impact && (
            <div className="bg-orange-500/10 rounded-lg p-3">
              <p className="text-xs text-orange-500 uppercase tracking-wide mb-0.5">Financial Impact</p>
              <p className="text-sm">{finding.estimated_financial_impact}</p>
            </div>
          )}

          {finding.review_status === 'pending' && (
            <div className="flex gap-2 pt-2">
              <Button size="sm" variant="outline" className="text-green-600 border-green-500/30" onClick={() => handleReview('approved')} disabled={updating}>
                <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Approve
              </Button>
              <Button size="sm" variant="outline" className="text-red-500 border-red-500/30" onClick={() => handleReview('rejected')} disabled={updating}>
                <XCircle className="w-3.5 h-3.5 mr-1.5" /> Reject
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleReview('needs_clarification')} disabled={updating}>
                <HelpCircle className="w-3.5 h-3.5 mr-1.5" /> Needs Clarification
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleReview('requires_rfi')} disabled={updating}>
                <FileText className="w-3.5 h-3.5 mr-1.5" /> Generate RFI
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default function Intelligence() {
  const { toast } = useToast();
  const fileRef = useRef();
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [documents, setDocuments] = useState([]);
  const [findings, setFindings] = useState([]);
  const [activePackage, setActivePackage] = useState('estimating');
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [uploadedDoc, setUploadedDoc] = useState(null);
  const [docType, setDocType] = useState('specification');
  const [filterStatus, setFilterStatus] = useState('all');

  useEffect(() => {
    loadProjects();
    const params = new URLSearchParams(window.location.search);
    const proj = params.get('project');
    if (proj) setSelectedProject(proj);
  }, []);

  useEffect(() => {
    if (selectedProject) {
      loadDocuments();
      loadFindings();
    }
  }, [selectedProject]);

  const loadProjects = async () => {
    const data = await base44.entities.Project.filter({ is_archived: false }, '-created_date', 50);
    setProjects(data);
  };

  const loadDocuments = async () => {
    const data = await base44.entities.Document.filter({ project_id: selectedProject }, '-created_date', 20);
    setDocuments(data);
  };

  const loadFindings = async () => {
    const data = await base44.entities.AIFinding.filter({ project_id: selectedProject }, '-created_date', 100);
    setFindings(data);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !selectedProject) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      const doc = await base44.entities.Document.create({
        project_id: selectedProject,
        name: file.name,
        document_type: docType,
        file_url,
        file_name: file.name,
        file_size: file.size,
        file_type: file.type,
        status: 'uploaded',
        ai_processing_status: 'pending',
        version: 1,
      });
      setUploadedDoc(doc);
      toast({ title: 'Document uploaded', description: 'Ready to analyze with AI.' });
      loadDocuments();
    } catch (e) {
      toast({ title: 'Upload failed', variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const runAIAnalysis = async (doc) => {
    if (!doc) return;
    setAnalyzing(true);
    try {
      await base44.entities.Document.update(doc.id, { ai_processing_status: 'processing' });

      const fileContent = await fetch(doc.file_url).then(r => r.text()).catch(() => '');
      const project = projects.find(p => p.id === selectedProject);

      const prompt = `${STEEL_SYSTEM_PROMPT}

PROJECT: ${project?.name || 'Unknown'} (${project?.project_number || ''})
DOCUMENT: ${doc.name} (Type: ${doc.document_type})

Analyze this structural steel project document and identify critical findings across ALL review packages.

Document content (or filename if content unavailable): ${fileContent || doc.file_name}

Generate a comprehensive review with findings for EACH of these packages:
1. ESTIMATING - Identify: alternates, allowances, scope gaps, delegated design, temporary bracing, connection design, paint/galvanizing scope, liquidated damages, retainage, bonds, schedule risks
2. QUALITY_ASSURANCE - Identify: AISC certification requirements, AWS welding requirements, inspection hold points, witness points, third-party inspection, MTR requirements, charpy testing, SSPC surface prep, weld procedures (WPS/PQR), bolt inspection
3. SAFETY - Identify: fall protection requirements, OSHA requirements, crane/rigging requirements, critical picks, temporary bracing, erection stability, site restrictions
4. PURCHASING - Identify: long lead items, Buy America requirements, domestic steel, special materials, delivery requirements, owner furnished materials
5. ACCOUNTING - Identify: retainage percentage, payment terms, insurance requirements, bond requirements, certified payroll, change order procedures, billing requirements, lien waivers
6. EXECUTIVE - Provide top risks, financial risks, schedule risks, contract risks, recommended actions

For each finding provide:
- status: pass | warning | fail | not_found | manual_review
- title: clear, specific finding title
- category: category name
- subcategory: specific subcategory
- risk_level: low | medium | high | critical
- ai_explanation: detailed explanation of why this matters for a steel fabricator (2-3 sentences)
- recommendation: specific action the team should take
- estimated_financial_impact: dollar impact description
- page_number: estimated page number or null
- specification_section: CSI section if applicable
- quoted_text: relevant quoted language if applicable
- confidence_score: 0.0 to 1.0

Generate at least 15-20 realistic findings covering different risk areas.`;

      const result = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: 'object',
          properties: {
            findings: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  review_package: { type: 'string' },
                  status: { type: 'string' },
                  title: { type: 'string' },
                  category: { type: 'string' },
                  subcategory: { type: 'string' },
                  risk_level: { type: 'string' },
                  ai_explanation: { type: 'string' },
                  recommendation: { type: 'string' },
                  estimated_financial_impact: { type: 'string' },
                  page_number: { type: 'number' },
                  specification_section: { type: 'string' },
                  csi_division: { type: 'string' },
                  quoted_text: { type: 'string' },
                  confidence_score: { type: 'number' },
                  responsible_department: { type: 'string' }
                }
              }
            }
          }
        }
      });

      if (result?.findings?.length > 0) {
        await base44.entities.AIFinding.bulkCreate(
          result.findings.map(f => ({
            ...f,
            project_id: selectedProject,
            document_id: doc.id,
            review_status: 'pending',
            is_resolved: false,
          }))
        );
        await base44.entities.Document.update(doc.id, { ai_processing_status: 'complete', status: 'analyzed' });
        toast({ title: `AI Analysis Complete`, description: `${result.findings.length} findings generated across all review packages.` });
        loadFindings();
        loadDocuments();
      }
    } catch (e) {
      console.error(e);
      toast({ title: 'Analysis failed', description: 'AI analysis encountered an error.', variant: 'destructive' });
      if (doc) await base44.entities.Document.update(doc.id, { ai_processing_status: 'failed' });
    } finally {
      setAnalyzing(false);
    }
  };

  const packageFindings = findings.filter(f => f.review_package === activePackage);
  const filteredFindings = filterStatus === 'all' ? packageFindings : packageFindings.filter(f => f.status === filterStatus);

  const packageCounts = REVIEW_PACKAGES.reduce((acc, pkg) => {
    acc[pkg] = findings.filter(f => f.review_package === pkg).length;
    return acc;
  }, {});

  const packagePending = REVIEW_PACKAGES.reduce((acc, pkg) => {
    acc[pkg] = findings.filter(f => f.review_package === pkg && f.review_status === 'pending').length;
    return acc;
  }, {});

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader
        title="Project Intelligence Engine"
        subtitle="AI-powered document analysis for structural steel projects"
        actions={
          <div className="flex items-center gap-2 text-xs text-blue-400 bg-blue-500/10 px-3 py-1.5 rounded-lg border border-blue-500/20">
            <Zap className="w-3.5 h-3.5 animate-pulse" />
            Steel Knowledge Layer Active
          </div>
        }
      />

      {/* Project Selector + Upload */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="steel-card p-5 lg:col-span-2">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-primary" /> Select Project & Upload Documents
          </h3>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Project</label>
              <Select value={selectedProject} onValueChange={setSelectedProject}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a project to analyze..." />
                </SelectTrigger>
                <SelectContent>
                  {projects.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.project_number} — {p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedProject && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">Document Type</label>
                  <Select value={docType} onValueChange={setDocType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {['specification','contract','general_conditions','addendum','structural_drawing','bid_form','scope_letter','other'].map(t => (
                        <SelectItem key={t} value={t}>{t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col justify-end">
                  <input ref={fileRef} type="file" className="hidden" onChange={handleFileUpload} accept=".pdf,.docx,.doc,.xlsx,.xls,.txt" />
                  <Button
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    variant="outline"
                    className="w-full"
                  >
                    {uploading ? (
                      <><div className="w-4 h-4 border-2 border-border border-t-primary rounded-full animate-spin mr-2" /> Uploading...</>
                    ) : (
                      <><Upload className="w-4 h-4 mr-2" /> Upload Document</>
                    )}
                  </Button>
                </div>
              </div>
            )}

            {uploadedDoc && (
              <div className="flex items-center justify-between p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-400" />
                  <span className="text-sm font-medium">{uploadedDoc.name}</span>
                </div>
                <Button
                  size="sm"
                  onClick={() => runAIAnalysis(uploadedDoc)}
                  disabled={analyzing}
                  className="steel-gradient text-white border-0 shadow-lg shadow-blue-500/20"
                >
                  {analyzing ? (
                    <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" /> Analyzing...</>
                  ) : (
                    <><Brain className="w-3.5 h-3.5 mr-2" /> Run AI Analysis</>
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Summary Stats */}
        <div className="steel-card p-5">
          <h3 className="font-semibold mb-4">Analysis Summary</h3>
          <div className="space-y-2">
            {[
              { label: 'Total Findings', value: findings.length, color: 'text-foreground' },
              { label: 'Fail', value: findings.filter(f => f.status === 'fail').length, color: 'text-red-500' },
              { label: 'Warning', value: findings.filter(f => f.status === 'warning').length, color: 'text-yellow-500' },
              { label: 'Pass', value: findings.filter(f => f.status === 'pass').length, color: 'text-green-500' },
              { label: 'Pending Review', value: findings.filter(f => f.review_status === 'pending').length, color: 'text-blue-500' },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex justify-between items-center py-1.5 border-b border-border/50 last:border-0">
                <span className="text-sm text-muted-foreground">{label}</span>
                <span className={`text-sm font-bold ${color}`}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Review Packages */}
      {selectedProject && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Review Packages</h3>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Filter..." />
              </SelectTrigger>
              <SelectContent>
                {['all','pass','warning','fail','manual_review','not_found'].map(s => (
                  <SelectItem key={s} value={s}>{s === 'all' ? 'All Statuses' : s.replace('_',' ').replace(/\b\w/g, c => c.toUpperCase())}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Tabs value={activePackage} onValueChange={setActivePackage}>
            <TabsList className="flex flex-wrap gap-1 h-auto mb-4 bg-muted p-1 rounded-lg">
              {REVIEW_PACKAGES.map(pkg => (
                <TabsTrigger key={pkg} value={pkg} className="text-xs capitalize flex items-center gap-1.5">
                  {pkg.replace('_', ' ')}
                  {packageCounts[pkg] > 0 && (
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                      packagePending[pkg] > 0 ? 'bg-orange-500/20 text-orange-500' : 'bg-green-500/20 text-green-500'
                    }`}>
                      {packageCounts[pkg]}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>

            {REVIEW_PACKAGES.map(pkg => (
              <TabsContent key={pkg} value={pkg}>
                {filteredFindings.length === 0 ? (
                  <div className="text-center py-16 steel-card">
                    <Brain className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                    <p className="text-sm font-medium mb-1">No findings for {pkg.replace('_',' ')}</p>
                    <p className="text-xs text-muted-foreground">
                      {findings.length === 0
                        ? 'Upload a document and run AI analysis to generate findings'
                        : 'No findings match the current filter'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredFindings.map(f => (
                      <FindingCard key={f.id} finding={f} onUpdate={loadFindings} />
                    ))}
                  </div>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </div>
      )}

      {!selectedProject && (
        <div className="text-center py-20 steel-card">
          <Brain className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-xl font-semibold mb-2">Project Intelligence Engine</h3>
          <p className="text-muted-foreground max-w-md mx-auto mb-6">
            Select a project above to upload documents and run AI analysis. SteelOS will automatically
            identify risks, requirements, and action items across all departments.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {['Estimating Review', 'Quality Assurance', 'Safety Analysis', 'Purchasing Review', 'Accounting Review', 'Executive Summary'].map(pkg => (
              <span key={pkg} className="text-xs px-3 py-1.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">{pkg}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}