import React, { useEffect, useRef, useState } from 'react';
import { db } from '@/api/apiClient';
import { simulateAiReview } from '@/lib/aiIntelligenceEngine';
import { extractTextFromPdf } from '@/lib/pdfTextExtractor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import PageHeader from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/use-toast';
import { UploadCloud, Save, ScanSearch } from 'lucide-react';

// A bid is "active pending" front-end review while it's still being worked —
// once it's won/lost/cancelled the spec exceptions here are moot.
const PENDING_BID_STATUSES = ['draft', 'in_progress', 'submitted'];

const COLUMNS = [
  { key: 'prior_bid_ask', label: 'Prior Bid Ask', type: 'bool' },
  { key: 'post_bid_ask', label: 'Post Bid Ask', type: 'bool' },
  { key: 'document_source_key', label: 'Source Doc', type: 'text' },
  { key: 'location_page_reference', label: 'Location / Page Ref', type: 'text' },
  { key: 'provision_number_tag', label: 'Provision #', type: 'text' },
  { key: 'owner_gc_cm_comment', label: 'Owner/GC/CM Comment', type: 'textarea' },
  { key: 'owner_gc_cm_question', label: 'Owner/GC/CM Question', type: 'textarea' },
  { key: 'comment_to_estimator', label: 'Comment to Estimator', type: 'textarea' },
  { key: 'sub_supplier_detailer_comment', label: 'Sub/Supplier/Detailer Comment', type: 'textarea' },
  { key: 'estimated_additional_cost_cents', label: 'Est. Additional Cost', type: 'cents' },
  { key: 'answer_text', label: 'Answer', type: 'textarea' },
  { key: 'if_awarded_project_team_review', label: 'If Awarded — Project Team Review', type: 'textarea' },
];

export default function FrontEndReview() {
  const { toast } = useToast();
  const fileInputRef = useRef(null);

  const [bids, setBids] = useState([]);
  const [bidId, setBidId] = useState('');
  const [lines, setLines] = useState([]);
  const [loadingLines, setLoadingLines] = useState(false);

  const [isDragging, setIsDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    db.entities.Bid.list('-created_date', 200)
      .then((rows) => setBids(rows.filter((b) => PENDING_BID_STATUSES.includes(b.status))))
      .catch(() => setBids([]));
  }, []);

  useEffect(() => { loadLines(); }, [bidId]);

  const loadLines = async () => {
    if (!bidId) { setLines([]); return; }
    setLoadingLines(true);
    try {
      const rows = await db.entities.contract_exception_lines.filter({ bid_id: bidId }, '-created_date', 200);
      setLines(rows);
    } catch (e) {
      setLines([]);
    } finally {
      setLoadingLines(false);
    }
  };

  const selectedBid = bids.find((b) => b.id === bidId);

  const ingestFile = async (file) => {
    if (!bidId) {
      toast({ title: 'Select a bid first', variant: 'destructive' });
      return;
    }
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isTxt = file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt');
    if (!isPdf && !isTxt) {
      toast({ title: 'Unsupported file type', description: 'Upload a .pdf or .txt spec document.', variant: 'destructive' });
      return;
    }
    if (isTxt) {
      const reader = new FileReader();
      reader.onload = (e) => runSimulatedReview(String(e.target.result), file.name);
      reader.readAsText(file);
      return;
    }
    setParsing(true);
    try {
      const text = await extractTextFromPdf(file);
      if (!text) {
        toast({
          title: 'No extractable text found',
          description: 'This PDF appears to be scanned images with no text layer — OCR it or export a .txt version instead.',
          variant: 'destructive',
        });
        setParsing(false);
        return;
      }
      await runSimulatedReview(text, file.name);
    } catch (e) {
      toast({ title: 'PDF parsing failed', description: e?.message || 'The file may be corrupted or password-protected.', variant: 'destructive' });
      setParsing(false);
    }
  };

  const runSimulatedReview = async (rawText, filename) => {
    setParsing(true);
    setParseProgress(0);
    const tick = setInterval(() => {
      setParseProgress((p) => Math.min(p + 10, 90));
    }, 150);
    try {
      const { lines: seeded } = await simulateAiReview(selectedBid, rawText, filename);
      setParseProgress(100);
      setLines((prev) => [...seeded, ...prev]);
      toast({ title: 'AI Core parse complete', description: `${seeded.length} exception lines seeded — review and edit below.` });
    } catch (e) {
      toast({ title: 'Parse failed', variant: 'destructive' });
    } finally {
      clearInterval(tick);
      setParsing(false);
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

  const updateLine = (id, field, value) => {
    setLines((prev) => prev.map((line) => (line.id === id ? { ...line, [field]: value } : line)));
  };

  const handleSave = async () => {
    if (!bidId) return;
    setSaving(true);
    try {
      await Promise.all(lines.map((line) => db.entities.contract_exception_lines.update(line.id, line)));
      await db.entities.Bid.update(bidId, { front_end_review_status: 'in_review' });
      toast({ title: 'Front-End Spec Review saved', description: 'Bid marked as in review.' });
    } catch (e) {
      toast({ title: 'Save failed', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader title="Front-End Spec Review" subtitle="Track owner/GC/CM exceptions, questions, and answers against the bid documents" />

      <div className="steel-card p-5 mb-4">
        <label className="text-sm font-medium mb-2 block">Bid</label>
        <Select value={bidId} onValueChange={setBidId}>
          <SelectTrigger className="max-w-md">
            <SelectValue placeholder="Select a pending bid…" />
          </SelectTrigger>
          <SelectContent>
            {bids.map((b) => (
              <SelectItem key={b.id} value={b.id}>{b.bid_number ? `${b.bid_number} — ` : ''}{b.job_name || 'Untitled Bid'}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {bidId && (
        <>
          <div className="steel-card p-5 mb-4 space-y-3">
            <h3 className="font-semibold flex items-center gap-2"><ScanSearch className="w-4 h-4 text-primary" />Specification Upload</h3>
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`rounded-xl border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${isDragging ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}`}
            >
              <UploadCloud className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm font-medium">Drop a .pdf or .txt spec document here, or click to browse</p>
              <p className="text-xs text-muted-foreground mt-1">PDF text is extracted directly in your browser — scanned/image-only PDFs with no text layer will need OCR or a .txt export first.</p>
              <input ref={fileInputRef} type="file" accept=".txt,.pdf" multiple className="hidden" onChange={handleFileSelect} />
            </div>
            {parsing && (
              <div>
                <Progress value={parseProgress} className="mb-1.5" />
                <p className="text-xs text-muted-foreground">AI Core Parsing Specifications for Material Risk Exceptions…</p>
              </div>
            )}
          </div>

          <div className="steel-card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Exception Matrix</h3>
              <Button onClick={handleSave} disabled={saving || loadingLines} className="gap-2 steel-gradient text-white border-0">
                <Save className="w-4 h-4" />{saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    {COLUMNS.map((col) => (
                      <th key={col.key} className="text-left font-semibold text-xs uppercase tracking-wide text-muted-foreground p-2 whitespace-nowrap">{col.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.id} className="border-b border-border/50 align-top">
                      {COLUMNS.map((col) => (
                        <td key={col.key} className="p-1.5 min-w-[160px]">
                          {col.type === 'bool' && (
                            <Checkbox
                              checked={!!line[col.key]}
                              onCheckedChange={(checked) => updateLine(line.id, col.key, !!checked)}
                            />
                          )}
                          {col.type === 'text' && (
                            <Input
                              value={line[col.key] || ''}
                              onChange={(e) => updateLine(line.id, col.key, e.target.value)}
                              className="h-9 text-xs"
                            />
                          )}
                          {col.type === 'textarea' && (
                            <Textarea
                              value={line[col.key] || ''}
                              onChange={(e) => updateLine(line.id, col.key, e.target.value)}
                              className="min-h-[60px] text-xs"
                            />
                          )}
                          {col.type === 'cents' && (
                            <Input
                              type="number"
                              value={line[col.key] != null ? line[col.key] / 100 : ''}
                              onChange={(e) => updateLine(line.id, col.key, Math.round(Number(e.target.value || 0) * 100))}
                              className="h-9 text-xs w-28"
                            />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {!loadingLines && lines.length === 0 && (
                    <tr>
                      <td colSpan={COLUMNS.length} className="p-6 text-center text-sm text-muted-foreground">
                        No exception lines yet — upload a spec document above to seed the matrix.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
