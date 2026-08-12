import React, { useMemo, useRef, useState } from 'react';
import { db } from '@/api/apiClient';
import { ShieldAlert, ShieldCheck, Brain, RefreshCw, Plus, Trash2, AlertTriangle, ListChecks } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';
import { getCertStatus } from '@/lib/certAlerts';
import {
  CHECKLIST_BY_TYPE,
  getPersonTierMismatch,
  computeExpirationDate,
} from '@/lib/heavyEquipmentChecklists';
import InspectionDetailDialog from '@/components/field-operations/InspectionDetailDialog';

const DISPATCH_WINDOW_DAYS = 30;
const INSPECTION_TYPES = ['Crane_Annual', 'DOT_Vehicle', 'Trailer_Safety', 'Rigging_Quarterly'];

const STATUS_BADGE = {
  Valid: { variant: 'secondary', className: 'bg-green-500/10 text-green-600 border-transparent', label: 'Valid' },
  Expiring_Soon: { variant: 'outline', className: 'bg-red-500/10 text-red-600 border-red-500/40', label: 'Expiring — within 30 days' },
  Expired: { variant: 'destructive', className: '', label: 'EXPIRED' },
};

const emptyReviewForm = () => ({
  asset_id: '',
  inspection_type: 'Crane_Annual',
  executed_date: '',
  expiration_date: '',
  inspector_name: '',
  competent_person: false,
  qualified_person: false,
  status_passed: true,
  checklist_items: [],
  file_url: '',
  file_name: '',
  file_size: 0,
  file_type: '',
});

export default function InspectionRadar({ inspections, assets, canManageFleet = false, onReload = async () => {} }) {
  const { toast } = useToast();
  const fileInputRef = useRef(null);
  const [scanning, setScanning] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [reviewForm, setReviewForm] = useState(emptyReviewForm());
  const [saving, setSaving] = useState(false);
  const [viewingInspection, setViewingInspection] = useState(null);
  const [showDetail, setShowDetail] = useState(false);

  const assetName = (id) => assets.find((a) => a.id === id)?.asset_name || id || '—';

  const rows = useMemo(
    () => inspections
      .map((i) => ({ ...i, status: getCertStatus(i.expiration_date, DISPATCH_WINDOW_DAYS) }))
      .sort((a, b) => new Date(a.expiration_date).getTime() - new Date(b.expiration_date).getTime()),
    [inspections]
  );

  const reviewMismatch = getPersonTierMismatch(reviewForm.inspection_type, reviewForm.competent_person, reviewForm.qualified_person);

  const runAIScan = async (file) => {
    setScanning(true);
    try {
      const { file_url } = await db.integrations.Core.UploadFile({ file });

      const response = await db.integrations.Core.InvokeLLM({
        prompt: `You are a heavy-equipment compliance assistant reading a scanned/photographed inspection checklist for a crane, rigging asset, DOT vehicle, or trailer. Determine which inspection_type it is (Crane_Annual, DOT_Vehicle, Trailer_Safety, or Rigging_Quarterly). Crane_Annual checklists follow OSHA 29 CFR 1926.1412 (shift/monthly/annual tiers) and 1926.1413 (wire rope removal criteria). Rigging_Quarterly checklists follow OSHA 29 CFR 1926.251 and ASME B30.9 (daily-before-use and periodic recorded inspection, with removal criteria specific to wire rope slings, chain slings, or synthetic web/round slings). Extract every checklist line item exactly as written or closely paraphrased, whether it passed or failed, and any handwritten notes. Also extract the executed/inspection date, the inspector's printed name, and the overall pass/fail result. Set any field you cannot find to an empty value rather than guessing.`,
        file_urls: [file_url],
        response_json_schema: {
          type: 'object',
          properties: {
            inspection_type: { type: 'string', enum: INSPECTION_TYPES },
            executed_date: { type: 'string' },
            inspector_name: { type: 'string' },
            overall_pass: { type: 'boolean' },
            checklist_items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  item: { type: 'string' },
                  pass: { type: 'boolean' },
                  notes: { type: 'string' },
                },
              },
            },
          },
        },
      });

      const inspectionType = INSPECTION_TYPES.includes(response?.inspection_type) ? response.inspection_type : 'Crane_Annual';
      const executedDate = response?.executed_date || '';
      const items = Array.isArray(response?.checklist_items)
        ? response.checklist_items.map((ci) => ({ item: String(ci.item || ''), pass: !!ci.pass, notes: String(ci.notes || '') })).filter((ci) => ci.item)
        : [];

      setReviewForm({
        asset_id: '',
        inspection_type: inspectionType,
        executed_date: executedDate,
        expiration_date: computeExpirationDate(inspectionType, executedDate),
        inspector_name: String(response?.inspector_name || ''),
        competent_person: false,
        qualified_person: false,
        status_passed: response?.overall_pass !== undefined ? !!response.overall_pass : items.every((i) => i.pass) || items.length === 0,
        checklist_items: items,
        file_url,
        file_name: file.name,
        file_size: file.size,
        file_type: file.type,
      });
      setShowReview(true);
      toast({ title: 'Checklist scanned', description: 'Review every field and item before saving — nothing has been saved yet.' });
    } catch (e) {
      toast({ title: 'AI scan failed', description: e?.message || 'The AI read failed unexpectedly.', variant: 'destructive' });
    } finally {
      setScanning(false);
    }
  };

  const handleFilePicked = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) runAIScan(file);
  };

  const applyInspectionType = (type) => {
    setReviewForm((f) => ({ ...f, inspection_type: type, expiration_date: computeExpirationDate(type, f.executed_date) }));
  };

  const applyExecutedDate = (date) => {
    setReviewForm((f) => ({ ...f, executed_date: date, expiration_date: computeExpirationDate(f.inspection_type, date) }));
  };

  const loadStandardChecklist = () => {
    const standard = CHECKLIST_BY_TYPE[reviewForm.inspection_type];
    if (!standard) {
      toast({ title: 'No standard checklist for this inspection type', variant: 'destructive' });
      return;
    }
    setReviewForm((f) => ({ ...f, checklist_items: standard.map((c) => ({ item: c.item, pass: true, notes: '' })) }));
  };

  const updateChecklistItem = (index, patch) => {
    setReviewForm((f) => ({ ...f, checklist_items: f.checklist_items.map((it, i) => (i === index ? { ...it, ...patch } : it)) }));
  };

  const removeChecklistItem = (index) => {
    setReviewForm((f) => ({ ...f, checklist_items: f.checklist_items.filter((_, i) => i !== index) }));
  };

  const addChecklistItem = () => {
    setReviewForm((f) => ({ ...f, checklist_items: [...f.checklist_items, { item: '', pass: true, notes: '' }] }));
  };

  const closeReview = () => {
    setShowReview(false);
    setReviewForm(emptyReviewForm());
  };

  const handleSaveInspection = async () => {
    if (!reviewForm.asset_id) {
      toast({ title: 'Select the asset this inspection is for', variant: 'destructive' });
      return;
    }
    if (!reviewForm.expiration_date) {
      toast({ title: 'Expiration date is required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      let certDocumentId = '';
      if (reviewForm.file_url) {
        const document = await db.entities.Document.create({
          project_id: '',
          name: reviewForm.file_name,
          file_url: reviewForm.file_url,
          file_name: reviewForm.file_name,
          file_size: reviewForm.file_size,
          file_type: reviewForm.file_type,
          document_type: 'other',
          status: 'uploaded',
          ai_processing_status: 'complete',
          description: `${reviewForm.inspection_type.replace(/_/g, ' ')} inspection checklist scan`,
        });
        certDocumentId = document.id;
      }

      const cleanItems = reviewForm.checklist_items
        .map((it) => ({ item: it.item.trim(), pass: !!it.pass, notes: it.notes.trim() }))
        .filter((it) => it.item);

      await db.entities.heavy_equipment_inspections.create({
        asset_id: reviewForm.asset_id,
        inspection_type: reviewForm.inspection_type,
        executed_date: reviewForm.executed_date,
        expiration_date: reviewForm.expiration_date,
        status_passed: reviewForm.status_passed,
        checklist_items: cleanItems,
        inspector_name: reviewForm.inspector_name.trim(),
        cert_document_id: certDocumentId,
        competent_person: reviewForm.competent_person,
        qualified_person: reviewForm.qualified_person,
      });

      await onReload();
      closeReview();
      toast({ title: 'Inspection saved' });
    } catch (e) {
      toast({ title: 'Unable to save inspection', description: e?.message || undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {canManageFleet && (
        <div className="flex justify-end">
          <input ref={fileInputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFilePicked} />
          <Button
            size="sm"
            className="gap-2 steel-gradient text-white border-0"
            disabled={scanning}
            onClick={() => fileInputRef.current?.click()}
          >
            {scanning ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
            {scanning ? 'Scanning…' : 'Scan Checklist (AI)'}
          </Button>
        </div>
      )}

      <div className="steel-card p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Asset</TableHead>
              <TableHead>Inspection Type</TableHead>
              <TableHead>Executed</TableHead>
              <TableHead>Expiration</TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">No inspections on file.</TableCell>
              </TableRow>
            )}
            {rows.map((i) => {
              const badge = STATUS_BADGE[i.status];
              const mismatch = getPersonTierMismatch(i.inspection_type, i.competent_person, i.qualified_person);
              return (
                <TableRow
                  key={i.id}
                  onClick={() => { setViewingInspection(i); setShowDetail(true); }}
                  className={`cursor-pointer hover:bg-muted/50 transition-colors ${i.status !== 'Valid' ? 'bg-red-500/5' : ''}`}
                >
                  <TableCell className="font-medium">{assetName(i.asset_id)}</TableCell>
                  <TableCell className="text-sm">
                    <div className="flex items-center gap-1.5">
                      {i.inspection_type.replace(/_/g, ' ')}
                      {mismatch && <AlertTriangle className="w-3.5 h-3.5 text-red-500" />}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm font-mono">{i.executed_date || '—'}</TableCell>
                  <TableCell className="text-sm font-mono">{i.expiration_date || '—'}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant={badge.variant} className={`gap-1 ${badge.className}`}>
                      {i.status === 'Valid' ? <ShieldCheck className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
                      {badge.label}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={showReview} onOpenChange={(o) => { if (!o) closeReview(); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Brain className="w-4 h-4 text-primary" />Review AI-Scanned Inspection</DialogTitle>
          </DialogHeader>

          <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 p-3 text-xs text-yellow-700 dark:text-yellow-400">
            Nothing has been saved yet — review and correct every field, then click Save Inspection.
          </div>

          {reviewMismatch && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-400">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{reviewMismatch}</span>
            </div>
          )}

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Asset</Label>
                <Select value={reviewForm.asset_id} onValueChange={(v) => setReviewForm((f) => ({ ...f, asset_id: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select an asset" /></SelectTrigger>
                  <SelectContent>{assets.map((a) => <SelectItem key={a.id} value={a.id}>{a.asset_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Inspection Type</Label>
                <Select value={reviewForm.inspection_type} onValueChange={applyInspectionType}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{INSPECTION_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Executed Date</Label>
                <Input type="date" value={reviewForm.executed_date} onChange={(e) => applyExecutedDate(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>Expiration Date</Label>
                <Input type="date" value={reviewForm.expiration_date} onChange={(e) => setReviewForm((f) => ({ ...f, expiration_date: e.target.value }))} className="mt-1" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Inspector Name</Label>
                <Input value={reviewForm.inspector_name} onChange={(e) => setReviewForm((f) => ({ ...f, inspector_name: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label>Overall Result</Label>
                <Select value={reviewForm.status_passed ? 'pass' : 'fail'} onValueChange={(v) => setReviewForm((f) => ({ ...f, status_passed: v === 'pass' }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pass">Passed</SelectItem>
                    <SelectItem value="fail">Failed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="rounded-lg border border-border p-3 space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Signer Tier — 29 CFR 1926.32</Label>
              <div className="flex items-center gap-2">
                <Checkbox id="competent_person" checked={reviewForm.competent_person} onCheckedChange={(v) => setReviewForm((f) => ({ ...f, competent_person: !!v }))} />
                <Label htmlFor="competent_person" className="font-normal cursor-pointer">Competent Person (1926.32(f))</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="qualified_person" checked={reviewForm.qualified_person} onCheckedChange={(v) => setReviewForm((f) => ({ ...f, qualified_person: !!v }))} />
                <Label htmlFor="qualified_person" className="font-normal cursor-pointer">Qualified Person (1926.32(m))</Label>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="flex items-center gap-1.5"><ListChecks className="w-3.5 h-3.5" />Checklist Items ({reviewForm.checklist_items.length})</Label>
                <div className="flex items-center gap-2">
                  {CHECKLIST_BY_TYPE[reviewForm.inspection_type] && (
                    <Button size="sm" variant="outline" onClick={loadStandardChecklist}>Load Standard Checklist</Button>
                  )}
                  <Button size="sm" variant="outline" onClick={addChecklistItem}><Plus className="w-3.5 h-3.5 mr-1" />Add Item</Button>
                </div>
              </div>
              <div className="space-y-2 max-h-72 overflow-y-auto scrollbar-thin">
                {reviewForm.checklist_items.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">No checklist items yet — add them manually or load the standard checklist.</p>
                )}
                {reviewForm.checklist_items.map((it, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-lg border border-border p-2">
                    <Checkbox className="mt-2" checked={it.pass} onCheckedChange={(v) => updateChecklistItem(i, { pass: !!v })} />
                    <div className="flex-1 min-w-0 space-y-1">
                      <Input value={it.item} onChange={(e) => updateChecklistItem(i, { item: e.target.value })} placeholder="Checklist item" className="text-xs h-8" />
                      <Input value={it.notes} onChange={(e) => updateChecklistItem(i, { notes: e.target.value })} placeholder="Notes (optional)" className="text-xs h-8" />
                    </div>
                    <button onClick={() => removeChecklistItem(i)} className="text-muted-foreground hover:text-destructive flex-shrink-0 mt-2">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeReview}>Cancel</Button>
            <Button onClick={handleSaveInspection} disabled={saving} className="steel-gradient text-white border-0">{saving ? 'Saving…' : 'Save Inspection'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <InspectionDetailDialog
        inspection={viewingInspection}
        open={showDetail}
        onOpenChange={(o) => { setShowDetail(o); if (!o) setViewingInspection(null); }}
        assets={assets}
      />
    </div>
  );
}
