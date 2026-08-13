import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { saveMtrDocument, createMtrDocumentId } from '@/lib/mtrDocumentStore';
import { buildMtrWarnings } from '@/lib/mtrValidation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Brain, FileWarning, CheckCircle2, AlertTriangle, RefreshCw, FlaskConical, Gauge } from 'lucide-react';

const IDENTIFICATION_FIELDS = [
  { key: 'material_grade', label: 'Grade / Spec', placeholder: 'A992' },
  { key: 'shape_size', label: 'Shape / Size', placeholder: 'W12x26' },
  { key: 'mill_name', label: 'Mill Name', placeholder: 'Nucor' },
];

const CHEMISTRY_FIELDS = [
  { key: 'carbon_pct', label: 'C' }, { key: 'manganese_pct', label: 'Mn' },
  { key: 'phosphorus_pct', label: 'P' }, { key: 'sulfur_pct', label: 'S' },
  { key: 'silicon_pct', label: 'Si' }, { key: 'copper_pct', label: 'Cu' },
  { key: 'nickel_pct', label: 'Ni' }, { key: 'chromium_pct', label: 'Cr' },
  { key: 'molybdenum_pct', label: 'Mo' }, { key: 'vanadium_pct', label: 'V' },
  { key: 'columbium_pct', label: 'Cb' },
];

const MECHANICAL_FIELDS = [
  { key: 'yield_strength_ksi', label: 'Yield (ksi)' },
  { key: 'tensile_strength_ksi', label: 'Tensile (ksi)' },
  { key: 'elongation_pct', label: 'Elongation (%)' },
];

const EXTRACT_PROMPT = `You are a structural steel receiving assistant. Parse the uploaded Mill Test Report (MTR) / material certification.
heat_number is the single most important field — extract it exactly as printed, plus your confidence (0-1) that you read it correctly.
Also extract: material_grade/spec (e.g. A992, A572-50), shape_size, mill_name, cert_date (YYYY-MM-DD if determinable).
Extract the full chemical composition available as percent by weight: carbon_pct, manganese_pct, phosphorus_pct, sulfur_pct, silicon_pct, copper_pct, nickel_pct, chromium_pct, molybdenum_pct, vanadium_pct, columbium_pct.
Extract mechanical properties: yield_strength_ksi, tensile_strength_ksi, elongation_pct.
Extract carbon_equivalent (CE) only if the cert states one explicitly — do not calculate it yourself.
Leave any field you cannot find as null rather than guessing. List any field you could read but aren't confident about in illegible_fields.`;

const MTR_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    heat_number: { type: 'string' },
    heat_number_confidence: { type: 'number' },
    material_grade: { type: 'string' },
    shape_size: { type: 'string' },
    mill_name: { type: 'string' },
    cert_date: { type: 'string' },
    carbon_pct: { type: 'number' }, manganese_pct: { type: 'number' },
    phosphorus_pct: { type: 'number' }, sulfur_pct: { type: 'number' },
    silicon_pct: { type: 'number' }, copper_pct: { type: 'number' },
    nickel_pct: { type: 'number' }, chromium_pct: { type: 'number' },
    molybdenum_pct: { type: 'number' }, vanadium_pct: { type: 'number' },
    columbium_pct: { type: 'number' },
    yield_strength_ksi: { type: 'number' }, tensile_strength_ksi: { type: 'number' },
    elongation_pct: { type: 'number' }, carbon_equivalent: { type: 'number' },
    illegible_fields: { type: 'array', items: { type: 'string' } },
  },
};

const emptyFields = () => ({
  heat_number: '', heat_number_confidence: null, material_grade: '', shape_size: '', mill_name: '', cert_date: '',
  carbon_pct: null, manganese_pct: null, phosphorus_pct: null, sulfur_pct: null, silicon_pct: null,
  copper_pct: null, nickel_pct: null, chromium_pct: null, molybdenum_pct: null, vanadium_pct: null, columbium_pct: null,
  yield_strength_ksi: null, tensile_strength_ksi: null, elongation_pct: null, carbon_equivalent: null,
  illegible_fields: [],
});

// Never NaN, never '' — an unparseable/blank numeric input becomes null so
// it reads downstream as "not reported," not a fake zero (chemistry/mechanical
// values are legitimately 0 sometimes, so unlike target_minutes, 0 itself is
// kept as a real value here — only genuinely empty/garbage input becomes null).
const toNumberOrNull = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const isImageFile = (file) => !!file?.type?.startsWith('image/');

// Upload -> InvokeLLM -> human review table -> explicit Approve -> write —
// same shape as SmartFileDump.jsx's AI extraction pattern. Nothing under
// db.entities is ever touched before Approve; only the in-memory preview
// (a plain object URL off the File the user picked) exists before then. The
// source blob itself only reaches IndexedDB (mtrDocumentStore.js) at Approve
// time, alongside the MillTestReport row — never localStorage.
export default function MtrReader({ poId, vendorId, poLines = [], defaultPoLineId = '', onApproved }) {
  const { toast } = useToast();
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [parsing, setParsing] = useState(false);
  const [fields, setFields] = useState(null);
  const [selectedPoLineId, setSelectedPoLineId] = useState(defaultPoLineId);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!file) { setPreviewUrl(''); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => { setSelectedPoLineId(defaultPoLineId); }, [defaultPoLineId]);

  const warnings = useMemo(() => (fields ? buildMtrWarnings(fields) : []), [fields]);
  const heatNumberEntered = !!fields?.heat_number?.trim();
  const canApprove = !!fields && heatNumberEntered && !!selectedPoLineId && !approving;

  const handleFileSelected = (selected) => {
    if (!selected) return;
    setFile(selected);
    setFields(null);
    setError('');
  };

  const updateField = (key, value) => setFields((prev) => ({ ...prev, [key]: value }));

  const runExtract = async () => {
    if (!file) return;
    setParsing(true);
    setError('');
    try {
      const { file_url } = await db.integrations.Core.UploadFile({ file });
      const response = await db.integrations.Core.InvokeLLM({
        prompt: EXTRACT_PROMPT,
        file_urls: [file_url],
        response_json_schema: MTR_RESPONSE_SCHEMA,
      });
      setFields({
        ...emptyFields(),
        heat_number: String(response?.heat_number || ''),
        heat_number_confidence: toNumberOrNull(response?.heat_number_confidence),
        material_grade: String(response?.material_grade || ''),
        shape_size: String(response?.shape_size || ''),
        mill_name: String(response?.mill_name || ''),
        cert_date: String(response?.cert_date || ''),
        carbon_pct: toNumberOrNull(response?.carbon_pct),
        manganese_pct: toNumberOrNull(response?.manganese_pct),
        phosphorus_pct: toNumberOrNull(response?.phosphorus_pct),
        sulfur_pct: toNumberOrNull(response?.sulfur_pct),
        silicon_pct: toNumberOrNull(response?.silicon_pct),
        copper_pct: toNumberOrNull(response?.copper_pct),
        nickel_pct: toNumberOrNull(response?.nickel_pct),
        chromium_pct: toNumberOrNull(response?.chromium_pct),
        molybdenum_pct: toNumberOrNull(response?.molybdenum_pct),
        vanadium_pct: toNumberOrNull(response?.vanadium_pct),
        columbium_pct: toNumberOrNull(response?.columbium_pct),
        yield_strength_ksi: toNumberOrNull(response?.yield_strength_ksi),
        tensile_strength_ksi: toNumberOrNull(response?.tensile_strength_ksi),
        elongation_pct: toNumberOrNull(response?.elongation_pct),
        carbon_equivalent: toNumberOrNull(response?.carbon_equivalent),
        illegible_fields: Array.isArray(response?.illegible_fields) ? response.illegible_fields.map(String) : [],
      });
      if (!String(response?.heat_number || '').trim()) {
        toast({ title: 'AI could not read a heat number from this MTR', description: 'Enter it manually below before approving.', variant: 'destructive' });
      } else {
        toast({ title: 'MTR parsed — review fields before approving' });
      }
    } catch (e) {
      const message = e?.message || 'The AI read failed unexpectedly.';
      setError(message);
      toast({ title: 'Unable to read MTR', description: message, variant: 'destructive' });
    } finally {
      setParsing(false);
    }
  };

  const reset = () => {
    setFile(null);
    setFields(null);
    setSelectedPoLineId(defaultPoLineId);
    setError('');
  };

  const approveAndSave = async () => {
    if (!canApprove) return;
    setApproving(true);
    try {
      let cert_document_id = '';
      if (file) {
        cert_document_id = createMtrDocumentId();
        await saveMtrDocument(cert_document_id, file);
      }
      const record = await db.entities.MillTestReport.create({
        po_id: poId || '',
        po_line_id: selectedPoLineId,
        vendor_id: vendorId || '',
        heat_number: fields.heat_number.trim(),
        heat_number_confidence: fields.heat_number_confidence,
        material_grade: fields.material_grade.trim(),
        shape_size: fields.shape_size.trim(),
        mill_name: fields.mill_name.trim(),
        cert_date: fields.cert_date || '',
        carbon_pct: fields.carbon_pct,
        manganese_pct: fields.manganese_pct,
        phosphorus_pct: fields.phosphorus_pct,
        sulfur_pct: fields.sulfur_pct,
        silicon_pct: fields.silicon_pct,
        copper_pct: fields.copper_pct,
        nickel_pct: fields.nickel_pct,
        chromium_pct: fields.chromium_pct,
        molybdenum_pct: fields.molybdenum_pct,
        vanadium_pct: fields.vanadium_pct,
        columbium_pct: fields.columbium_pct,
        yield_strength_ksi: fields.yield_strength_ksi,
        tensile_strength_ksi: fields.tensile_strength_ksi,
        elongation_pct: fields.elongation_pct,
        carbon_equivalent: fields.carbon_equivalent,
        validation_warnings: warnings,
        cert_document_id,
        cert_file_name: file?.name || '',
        cert_file_mime: file?.type || '',
        cert_file_size: file?.size || 0,
        submitted_date: new Date().toISOString().slice(0, 10),
      });
      toast({ title: `MTR approved — Heat ${record.heat_number}`, className: 'bg-green-600 text-white border-0' });
      if (onApproved) onApproved(record);
      reset();
    } catch (e) {
      toast({ title: 'Unable to save MTR', description: e?.message || 'Save failed unexpectedly.', variant: 'destructive' });
    } finally {
      setApproving(false);
    }
  };

  return (
    <div className="rounded-lg border border-dashed border-border p-3 space-y-3">
      <div>
        <Label className="text-base">MTR Reader (AI)</Label>
        <p className="text-xs text-muted-foreground mt-1">Upload a Mill Test Report (PDF or photo) — review every extracted field against the source document before approving. Nothing is saved until you click Approve.</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <label className="flex-1 flex items-center gap-2 text-sm border border-border rounded-md px-3 py-2 cursor-pointer hover:bg-muted/50">
          <input type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => handleFileSelected(e.target.files?.[0])} />
          <span className="truncate text-muted-foreground">{file ? file.name : 'Choose MTR file (PDF or image)'}</span>
        </label>
        <Button variant="outline" onClick={runExtract} disabled={parsing || !file}>
          {parsing ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Reading…</> : <><Brain className="w-4 h-4 mr-2" />Read MTR</>}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
          <p className="font-semibold">AI read error</p>
          <p>{error}</p>
        </div>
      )}

      {fields && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2 border-t border-border">
          {/* Source doc preview */}
          <div>
            <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Source Document</h5>
            {previewUrl ? (
              isImageFile(file) ? (
                <img src={previewUrl} alt={file?.name || 'MTR'} className="w-full max-h-[520px] object-contain rounded-lg border border-border bg-muted/30" />
              ) : (
                <iframe src={previewUrl} title={file?.name || 'MTR'} className="w-full h-[520px] rounded-lg border border-border bg-muted/30" />
              )
            ) : (
              <p className="text-sm text-muted-foreground">No file selected.</p>
            )}
          </div>

          {/* Editable extraction */}
          <div className="space-y-4">
            <div>
              <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Extracted Fields — Review &amp; Correct</h5>
              <div className="space-y-2">
                <div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Heat Number</Label>
                    {fields.heat_number_confidence != null && (
                      <Badge variant={fields.heat_number_confidence < 0.7 ? 'destructive' : 'secondary'} className="text-[10px]">
                        {Math.round(fields.heat_number_confidence * 100)}% confidence
                      </Badge>
                    )}
                  </div>
                  <Input value={fields.heat_number} onChange={(e) => updateField('heat_number', e.target.value)} placeholder="HT-4412" className="mt-1" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {IDENTIFICATION_FIELDS.map((f) => (
                    <div key={f.key}>
                      <Label className="text-xs">{f.label}</Label>
                      <Input value={fields[f.key] || ''} onChange={(e) => updateField(f.key, e.target.value)} placeholder={f.placeholder} className="mt-1" />
                    </div>
                  ))}
                  <div>
                    <Label className="text-xs">Cert Date</Label>
                    <Input type="date" value={fields.cert_date || ''} onChange={(e) => updateField('cert_date', e.target.value)} className="mt-1" />
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5"><FlaskConical className="w-3.5 h-3.5" />Chemical Composition (%)</h5>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {CHEMISTRY_FIELDS.map((f) => (
                  <div key={f.key}>
                    <Label className="text-[10px]">{f.label}</Label>
                    <Input type="number" step="0.001" value={fields[f.key] ?? ''} onChange={(e) => updateField(f.key, toNumberOrNull(e.target.value))} className="mt-0.5 h-8 text-xs" />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5"><Gauge className="w-3.5 h-3.5" />Mechanical Properties</h5>
              <div className="grid grid-cols-3 gap-2">
                {MECHANICAL_FIELDS.map((f) => (
                  <div key={f.key}>
                    <Label className="text-[10px]">{f.label}</Label>
                    <Input type="number" step="0.1" value={fields[f.key] ?? ''} onChange={(e) => updateField(f.key, toNumberOrNull(e.target.value))} className="mt-0.5 h-8 text-xs" />
                  </div>
                ))}
                <div>
                  <Label className="text-[10px]">Carbon Equiv. (CE)</Label>
                  <Input type="number" step="0.001" value={fields.carbon_equivalent ?? ''} onChange={(e) => updateField('carbon_equivalent', toNumberOrNull(e.target.value))} className="mt-0.5 h-8 text-xs" />
                </div>
              </div>
            </div>

            <div>
              <Label className="text-xs">Linked Material (Explicit FK — required)</Label>
              <Select value={selectedPoLineId} onValueChange={setSelectedPoLineId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select the PO line this cert documents…" /></SelectTrigger>
                <SelectContent>
                  {poLines.map((line) => <SelectItem key={line.id} value={line.id}>Line {line.line_number} — {line.description}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {warnings.length > 0 && (
              <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 space-y-1.5">
                {warnings.map((w, i) => (
                  <p key={i} className="text-xs text-yellow-700 dark:text-yellow-400 flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />{w}
                  </p>
                ))}
              </div>
            )}

            {!heatNumberEntered && (
              <p className="text-xs text-red-600 flex items-center gap-1.5"><FileWarning className="w-3.5 h-3.5" />Heat number is required — type it in if the AI couldn't read it.</p>
            )}

            <Button onClick={approveAndSave} disabled={!canApprove} className="w-full bg-green-600 hover:bg-green-700 text-white border-0">
              <CheckCircle2 className="w-4 h-4 mr-2" />{approving ? 'Saving…' : 'Approve & Save MTR'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
