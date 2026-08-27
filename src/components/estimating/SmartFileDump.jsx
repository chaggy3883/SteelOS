import React, { useState, useRef, useEffect } from 'react';
import { db } from '@/api/apiClient';
import { UploadCloud, FileText, FileSpreadsheet, File, Brain, CheckCircle2, AlertCircle, X, RefreshCw, Eye, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { openDocumentViewer } from '@/lib/openDocumentViewer';
import { downloadFile } from '@/lib/downloadFile';
import { findTaxRateForAddress } from '@/lib/taxRate';

// Forces project_id to always be a valid, non-empty string before it reaches
// any Document/Bid write, and provides the same fallback chain everywhere:
// an explicit override > the bid's own won_project_id (if it's been awarded)
// > a temporary placeholder, so the write can never fail string validation
// even when the AI/parsing payload didn't supply a project_id at all.
const resolveProjectId = (candidate, bid, override) => {
  if (candidate !== undefined && candidate !== null && String(candidate).trim() !== '') {
    return String(candidate);
  }
  if (override) return String(override);
  if (bid?.won_project_id) return String(bid.won_project_id);
  return `TEMP-UNASSIGNED-${Date.now()}`;
};

const FILE_BUCKETS = [
  { key: 'addenda', label: 'Addenda / Bulletins', color: 'text-orange-500', bg: 'bg-orange-500/10' },
  { key: 'bid_form', label: 'Bid Form / Bid Supporting Docs', color: 'text-blue-500', bg: 'bg-blue-500/10' },
  { key: 'drawings', label: 'Drawings (BIM / Tekla / SDS2)', color: 'text-purple-500', bg: 'bg-purple-500/10' },
  { key: 'scope', label: 'Scope of Work', color: 'text-green-500', bg: 'bg-green-500/10' },
  { key: 'specs', label: 'Specs', color: 'text-teal-500', bg: 'bg-teal-500/10' },
];

const getFileIcon = (name) => {
  if (name?.match(/\.(xlsx|xls|csv)$/i)) return FileSpreadsheet;
  if (name?.match(/\.(pdf)$/i)) return FileText;
  return File;
};

const isPdfName = (name) => !!name?.match(/\.pdf$/i);
const isOfficeDocName = (name) => !!name?.match(/\.(docx|xlsx|xls)$/i);

export default function SmartFileDump({ bidId, bid, onParseComplete }) {
  const { toast } = useToast();
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState(0);
  const [aiResult, setAiResult] = useState(null);
  const [approved, setApproved] = useState(false);
  const [parseError, setParseError] = useState('');
  const [projects, setProjects] = useState([]);
  const [projectOverride, setProjectOverride] = useState('');
  const [taxRateCheck, setTaxRateCheck] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    db.entities.Project.list('-created_date', 100).then(setProjects).catch(() => setProjects([]));
  }, []);

  const handleFiles = (fileList) => {
    const newFiles = Array.from(fileList).map(f => ({ file: f, bucket: 'specs', status: 'pending' }));
    setFiles(prev => [...prev, ...newFiles]);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const assignBucket = (index, bucket) => {
    setFiles(prev => prev.map((f, i) => i === index ? { ...f, bucket } : f));
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const runAIParse = async () => {
    if (files.length === 0) return;
    setParsing(true);
    setParseProgress(0);
    setApproved(false);
    setParseError('');
    setTaxRateCheck(null);
    try {
      // Upload files
      for (let i = 0; i < files.length; i++) {
        setParseProgress(Math.round((i / files.length) * 50));
        const { file_url } = await db.integrations.Core.UploadFile({ file: files[i].file });
        files[i].file_url = file_url;
        files[i].status = 'uploaded';
        await db.entities.Document.create({
          bid_id: bidId,
          project_id: resolveProjectId(null, bid, projectOverride),
          name: files[i].file.name,
          file_url,
          file_name: files[i].file.name,
          file_size: files[i].file.size,
          file_type: files[i].file.type,
          document_type: files[i].bucket === 'drawings' ? 'structural_drawing' : files[i].bucket === 'specs' ? 'specification' : 'other',
          status: 'uploaded',
          ai_processing_status: 'pending',
        });
      }
      setFiles([...files]);
      setParseProgress(60);

      // AI parse against cost breakdown structure
      const fileUrls = files.map(f => f.file_url).filter(Boolean);
      const response = await db.integrations.Core.InvokeLLM({
        prompt: `You are a structural steel estimating assistant. Parse the uploaded bid documents (PDFs, Excel takeoff sheets, Word docs) and extract a cost breakdown. Return a JSON object with suggested takeoff values based on the following cost categories: detailing, engineering, bim, structural_material (tons), bolts_fasteners, outsourced_fabrication, structural_fabrication, galvanizing, steel_rolling, joist_deck, anchor_bolts, shop_priming, primer_paint, grating, outsourced_paint, outsourced_shot_blasting, jobsite_freight, misc_fab_structural, misc_fab_processing, misc_material, steel_erection, subcontractor_other, allowances, hss_contingency, additional_cost_insurance, additional_cost_leed_govt. For each, suggest a quantity, unit_cost, and confidence (0-1). Also extract: estimated_tons, estimated_man_hours, tax_rate, job_city, job_state, inclusions, exclusions, scope_summary, and a short risk review. Set any unknown numeric field to 0 and confidence to 0.`,
        file_urls: fileUrls,
        response_json_schema: {
          type: 'object',
          properties: {
            estimated_tons: { type: 'number' },
            estimated_man_hours: { type: 'number' },
            tax_rate: { type: 'number' },
            job_city: { type: 'string' },
            job_state: { type: 'string' },
            line_items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  cost_category: { type: 'string' },
                  quantity: { type: 'number' },
                  unit_cost: { type: 'number' },
                  confidence: { type: 'number' }
                }
              }
            },
            inclusions: { type: 'string' },
            exclusions: { type: 'string' },
            scope_summary: { type: 'string' },
            risk_review: { type: 'string' }
          }
        }
      });
      setParseProgress(100);
      setAiResult(response);

      // Cross-check the AI-suggested tax_rate against the real jurisdiction
      // table for this job's ZIP (per standing rule 3, AI output is always
      // human-reviewed before it writes anything — this never auto-applies
      // either number, it only flags a mismatch for the reviewer).
      const zip = bid?.zip || '';
      if (zip) {
        try {
          const zoneMatch = await findTaxRateForAddress({ zip_code: zip, street_address: bid?.street });
          const jurisdictionRate = zoneMatch ? Number(zoneMatch.tax_percentage || 0) / 100 : null;
          const aiRate = Number(response.tax_rate || 0);
          setTaxRateCheck({
            zipKnown: true,
            jurisdictionRate,
            mismatch: jurisdictionRate != null && Math.abs(jurisdictionRate - aiRate) > 0.0005,
          });
        } catch (e) {
          setTaxRateCheck({ zipKnown: true, jurisdictionRate: null, mismatch: false });
        }
      } else {
        setTaxRateCheck({ zipKnown: false, jurisdictionRate: null, mismatch: false });
      }

      toast({ title: 'AI parsing complete', description: 'Review suggested fields before saving.' });
    } catch (e) {
      const message = e?.message || 'The AI parse failed unexpectedly.';
      setParseError(message);
      toast({ title: 'AI parsing failed', description: message, variant: 'destructive' });
    } finally {
      setParsing(false);
    }
  };

  const approveAndSave = async () => {
    if (!aiResult) return;
    try {
      const projectId = resolveProjectId(projectOverride, bid, bidId);
      const lines = (aiResult.line_items || []).map(li => ({
        bid_id: bidId,
        cost_category: li.cost_category,
        quantity: li.quantity || 0,
        unit_cost: li.unit_cost || 0,
        total_cost: (li.quantity || 0) * (li.unit_cost || 0),
        is_auto_filled: true,
        source: 'ai_parse',
        notes: `AI confidence: ${((li.confidence || 0) * 100).toFixed(0)}%`,
      }));
      if (lines.length > 0) await db.entities.TakeoffLine.bulkCreate(lines);
      // Update bid header
      // tax_rate is deliberately NOT written here — it's the one authoritative
      // tax calculation path's job (computeEffectiveTaxRate, run from Base
      // Info Save / the takeoff save), not this AI extraction. The AI's
      // suggested rate is shown above for review only; see the mismatch flag
      // against the jurisdiction table when the job's ZIP is already known.
      await db.entities.Bid.update(bidId, {
        estimated_tons: Number(aiResult.estimated_tons || 0),
        estimated_man_hours: Number(aiResult.estimated_man_hours || 0),
        job_city: String(aiResult.job_city || ''),
        job_state: String(aiResult.job_state || ''),
        inclusions: String(aiResult.inclusions || ''),
        exclusions: String(aiResult.exclusions || ''),
        scope_summary: [String(aiResult.scope_summary || ''), String(aiResult.risk_review || '')].filter(Boolean).join('\n\n'),
        project_id: projectId,
      });
      setApproved(true);
      toast({ title: 'AI fields approved & saved!' });
      if (onParseComplete) onParseComplete(aiResult);
    } catch (e) {
      toast({ title: 'Save failed', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      {/* Dropzone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          'border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all',
          dragging ? 'border-primary bg-primary/5 scale-[1.01]' : 'border-border hover:border-primary/50 hover:bg-muted/50'
        )}
      >
        <input ref={fileInputRef} type="file" multiple className="hidden"
          onChange={(e) => handleFiles(e.target.files)} />
        <UploadCloud className={cn('w-10 h-10 mx-auto mb-3', dragging ? 'text-primary' : 'text-muted-foreground')} />
        <p className="font-medium text-sm">Dump Estimation Docs & Data Sheets Here</p>
        <p className="text-xs text-muted-foreground mt-1">Drag & drop PDF blueprints, Excel takeoff sheets, or Word documents — or click to browse</p>
      </div>

      {parseError && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold">AI parse error</p>
              <p>{parseError}</p>
            </div>
            <button onClick={() => setParseError('')} className="text-red-600 hover:text-red-800" aria-label="Dismiss error">×</button>
          </div>
          {parseError.toLowerCase().includes('project') && (
            <div className="flex items-center gap-2 pt-1 border-t border-red-500/20">
              <Select value={projectOverride} onValueChange={setProjectOverride}>
                <SelectTrigger className="h-8 text-xs bg-background text-foreground"><SelectValue placeholder="Select the correct project" /></SelectTrigger>
                <SelectContent>
                  {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={() => { setParseError(''); runAIParse(); }}>
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />Retry
              </Button>
            </div>
          )}
        </div>
      )}

      {/* File list with bucket assignment */}
      {files.length > 0 && (
        <div className="steel-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold">{files.length} file(s) queued</h4>
            <Button onClick={runAIParse} disabled={parsing || files.length === 0} className="steel-gradient text-white border-0">
              {parsing ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Parsing…</> : <><Brain className="w-4 h-4 mr-2" />Run AI Parse</>}
            </Button>
          </div>
          {parsing && <Progress value={parseProgress} className="mb-3" />}
          <div className="space-y-2">
            {files.map((f, i) => {
              const Icon = getFileIcon(f.file.name);
              const bucket = FILE_BUCKETS.find(b => b.key === f.bucket);
              return (
                <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-border">
                  <Icon className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{f.file.name}</p>
                    <p className="text-xs text-muted-foreground">{(f.file.size / 1024).toFixed(0)} KB · {f.status === 'uploaded' ? '✓ Uploaded' : 'Pending'}</p>
                  </div>
                  {f.file_url && isPdfName(f.file.name) && (
                    <button
                      title="Open"
                      onClick={(e) => { e.stopPropagation(); openDocumentViewer(f.file_url, f.file.name); }}
                      className="text-muted-foreground hover:text-primary flex-shrink-0"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  )}
                  {f.file_url && isOfficeDocName(f.file.name) && (
                    <button
                      title="Download to Print — Open in Word/Excel to print."
                      onClick={(e) => { e.stopPropagation(); downloadFile(f.file_url, f.file.name); }}
                      className="text-muted-foreground hover:text-primary flex-shrink-0"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  )}
                  <select
                    value={f.bucket}
                    onChange={(e) => assignBucket(i, e.target.value)}
                    className="text-xs border border-border rounded px-2 py-1 bg-background"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {FILE_BUCKETS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
                  </select>
                  <button onClick={(e) => { e.stopPropagation(); removeFile(i); }} className="text-muted-foreground hover:text-destructive">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* AI Reconciliation: Raw vs Suggested */}
      {aiResult && !approved && (
        <div className="steel-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Brain className="w-5 h-5 text-primary" />
            <h4 className="font-semibold">AI Reconciliation — Review Before Saving</h4>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Raw File Data */}
            <div>
              <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Raw File Data</h5>
              <div className="space-y-1.5 max-h-64 overflow-y-auto scrollbar-thin">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 p-2 rounded bg-muted/50 text-xs">
                    <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="truncate">{f.file.name}</span>
                    <span className="ml-auto text-muted-foreground">{FILE_BUCKETS.find(b => b.key === f.bucket)?.label}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* AI Suggested Fields */}
            <div>
              <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">AI Suggested Fields</h5>
              <div className="space-y-1.5 max-h-64 overflow-y-auto scrollbar-thin">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 rounded bg-muted/50"><span className="text-muted-foreground">Est. Tons:</span> <strong>{aiResult.estimated_tons || 0}</strong></div>
                  <div className="p-2 rounded bg-muted/50"><span className="text-muted-foreground">Est. Man-Hrs:</span> <strong>{aiResult.estimated_man_hours || 0}</strong></div>
                  <div className="p-2 rounded bg-muted/50 col-span-2">
                    <span className="text-muted-foreground">Tax Rate (not auto-applied):</span> <strong>{((aiResult.tax_rate || 0) * 100).toFixed(2)}%</strong>
                    {taxRateCheck?.zipKnown === false && (
                      <p className="text-[10px] text-amber-600 mt-0.5">AI estimate — not verified against jurisdiction table (job ZIP not yet set on this bid).</p>
                    )}
                    {taxRateCheck?.zipKnown && taxRateCheck.jurisdictionRate != null && taxRateCheck.mismatch && (
                      <p className="text-[10px] text-red-600 mt-0.5">
                        AI suggested {((aiResult.tax_rate || 0) * 100).toFixed(2)}%, jurisdiction table shows {(taxRateCheck.jurisdictionRate * 100).toFixed(2)}% for this ZIP — verify.
                      </p>
                    )}
                    {taxRateCheck?.zipKnown && taxRateCheck.jurisdictionRate == null && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">No jurisdiction table entry for this ZIP yet — not cross-checked.</p>
                    )}
                  </div>
                  <div className="p-2 rounded bg-muted/50"><span className="text-muted-foreground">Location:</span> <strong>{[aiResult.job_city, aiResult.job_state].filter(Boolean).join(', ') || '—'}</strong></div>
                </div>
                {(aiResult.line_items || []).filter(li => li.quantity > 0 || li.unit_cost > 0).slice(0, 12).map((li, i) => (
                  <div key={i} className="flex items-center justify-between p-2 rounded bg-muted/50 text-xs">
                    <span className="truncate">{li.cost_category.replace(/_/g, ' ')}</span>
                    <span className="font-mono">{li.quantity} × ${li.unit_cost?.toFixed(2)} = <strong>${(li.quantity * li.unit_cost).toFixed(0)}</strong></span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-4 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
            <AlertCircle className="w-4 h-4 text-yellow-500 flex-shrink-0" />
            <p className="text-xs text-yellow-700 dark:text-yellow-400 flex-1">Review all AI-suggested values. Approving will populate the BID Worksheet with these estimates — you can adjust any cell afterward. The suggested tax rate is not saved automatically; confirm it on the Base Information tab.</p>
            <Button onClick={approveAndSave} size="sm" className="bg-green-600 hover:bg-green-700 text-white border-0">
              <CheckCircle2 className="w-4 h-4 mr-1" />Approve & Save
            </Button>
          </div>
        </div>
      )}

      {approved && (
        <div className="steel-card p-4 flex items-center gap-3 bg-green-500/5 border-green-500/20">
          <CheckCircle2 className="w-5 h-5 text-green-500" />
          <p className="text-sm">AI fields approved and saved to takeoff. Switch to the BID Worksheet tab to adjust line items.</p>
        </div>
      )}
    </div>
  );
}