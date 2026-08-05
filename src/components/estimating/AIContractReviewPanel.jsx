import React, { useEffect, useRef, useState } from 'react';
import { db } from '@/api/apiClient';
import { runContractRiskAudit } from '@/lib/aiIntelligenceEngine';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { UploadCloud, ScanSearch, RefreshCw, AlertTriangle, AlertCircle, CheckCircle2, FileText } from 'lucide-react';

const CATEGORY_LABELS = {
  Liquidated_Damages: 'Liquidated Damages',
  Retainage: 'Retainage',
  Scope_Gap: 'Scope Gaps',
  Payment_Milestone: 'Payment Milestones',
};

const SEVERITY_STYLE = {
  Red: { badge: 'bg-red-500/10 text-red-600 border-red-500/30', icon: AlertCircle, label: 'High Risk' },
  Yellow: { badge: 'bg-yellow-500/10 text-yellow-700 border-yellow-500/30', icon: AlertTriangle, label: 'Warning' },
  Green: { badge: 'bg-green-500/10 text-green-600 border-green-500/30', icon: CheckCircle2, label: 'Standard' },
};

export default function AIContractReviewPanel({ bid }) {
  const { toast } = useToast();
  const fileInputRef = useRef(null);
  const [reviews, setReviews] = useState([]);
  const [selectedReview, setSelectedReview] = useState(null);
  const [rawText, setRawText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadReviews(); }, [bid?.id]);

  const loadReviews = async () => {
    if (!bid?.id) return;
    setLoading(true);
    try {
      const rows = await db.entities.ai_contract_reviews.filter({ bid_id: bid.id }, '-created_date', 50);
      setReviews(rows);
      setSelectedReview(rows[0] || null);
    } catch (e) {
      setReviews([]);
    } finally {
      setLoading(false);
    }
  };

  const ingestFile = (file) => {
    if (!file) return;
    if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
      const reader = new FileReader();
      reader.onload = (e) => setRawText((prev) => (prev ? `${prev}\n\n${e.target.result}` : String(e.target.result)));
      reader.readAsText(file);
      toast({ title: `${file.name} loaded` });
    } else {
      toast({
        title: 'PDF text extraction not available',
        description: 'This app has no PDF-parsing library — paste the contract text into the box below instead.',
        variant: 'destructive',
      });
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    Array.from(e.dataTransfer.files || []).forEach(ingestFile);
  };

  const handleFileSelect = (e) => {
    Array.from(e.target.files || []).forEach(ingestFile);
    e.target.value = '';
  };

  const handleRunAudit = async () => {
    if (!rawText.trim()) {
      toast({ title: 'Paste or upload contract text first', variant: 'destructive' });
      return;
    }
    setRunning(true);
    try {
      const created = await runContractRiskAudit(bid, rawText);
      setReviews((prev) => [created, ...prev]);
      setSelectedReview(created);
      toast({ title: 'AI Risk Audit complete', description: `${created.review_summary_json.length} findings identified.` });
    } catch (e) {
      toast({ title: 'Audit failed', variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  };

  const groupedFindings = (selectedReview?.review_summary_json || []).reduce((acc, finding) => {
    (acc[finding.category] = acc[finding.category] || []).push(finding);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="steel-card p-5 space-y-4">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><ScanSearch className="w-4 h-4 text-primary" />AI Contract Review</h3>
          <p className="text-sm text-muted-foreground">Upload or paste the GC/owner contract text — this runs a deterministic keyword/regex risk scan, not a real Claude API call (this app has no LLM integration).</p>
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`rounded-xl border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${isDragging ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}`}
        >
          <UploadCloud className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm font-medium">Drop a .txt contract dump here, or click to browse</p>
          <p className="text-xs text-muted-foreground mt-1">PDFs are accepted but can't be text-extracted in this app — paste their text below instead.</p>
          <input ref={fileInputRef} type="file" accept=".txt,.pdf" multiple className="hidden" onChange={handleFileSelect} />
        </div>

        <div>
          <Textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="Paste the contract text here…"
            className="min-h-[160px] font-mono text-xs"
          />
        </div>

        <div className="flex justify-end">
          <Button onClick={handleRunAudit} disabled={running} className="gap-2 steel-gradient text-white border-0">
            {running ? <><RefreshCw className="w-4 h-4 animate-spin" />Running Risk Audit…</> : <><ScanSearch className="w-4 h-4" />Run AI Risk Audit</>}
          </Button>
        </div>
      </div>

      {selectedReview && (
        <div className="steel-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-semibold flex items-center gap-2"><FileText className="w-4 h-4 text-primary" />Risk Report</h4>
            <span className="text-xs text-muted-foreground">{new Date(selectedReview.analyzed_at).toLocaleString()}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
              <div key={key} className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                {(groupedFindings[key] || []).map((finding, i) => {
                  const style = SEVERITY_STYLE[finding.severity] || SEVERITY_STYLE.Yellow;
                  const Icon = style.icon;
                  return (
                    <div key={i} className={`rounded-lg border p-3 text-sm ${style.badge}`}>
                      <div className="flex items-center justify-between mb-1">
                        <p className="font-semibold flex items-center gap-1.5"><Icon className="w-3.5 h-3.5" />{finding.title}</p>
                        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full border">{style.label}</span>
                      </div>
                      <p className="text-xs opacity-90">{finding.detail}</p>
                      {finding.matched_text && <p className="text-[11px] font-mono mt-1.5 opacity-75">"{finding.matched_text}"</p>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && reviews.length > 0 && (
        <div className="steel-card p-4">
          <h4 className="font-semibold text-sm mb-2">Past Reviews</h4>
          <div className="space-y-1.5">
            {reviews.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelectedReview(r)}
                className={`w-full text-left text-xs px-3 py-2 rounded-lg transition-colors ${selectedReview?.id === r.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50'}`}
              >
                {new Date(r.analyzed_at).toLocaleString()} — {r.review_summary_json?.length || 0} findings
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
