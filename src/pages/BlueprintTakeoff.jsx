import React, { useState, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { simulateAiBatchTakeoff } from '@/lib/aiIntelligenceEngine';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, UploadCloud, ScanLine, Plus, Trash2, FileStack } from 'lucide-react';

const emptyRow = (overrides = {}) => ({
  _key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  page_number: 1,
  shape_type: '',
  size_designation: '',
  confidence: null,
  quantity: 1,
  unit_weight_lbs_per_ft: 0,
  length_ft: 0,
  unit_cost_cents: 0,
  is_accepted: true,
  ...overrides,
});

export default function BlueprintTakeoff() {
  const { user } = useOutletContext() || {};
  const [fileUrl, setFileUrl] = useState(null);
  const [fileName, setFileName] = useState('');
  const [sheetCount, setSheetCount] = useState(null);
  const [scaleReference, setScaleReference] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [rows, setRows] = useState([]);
  const [takeoffId, setTakeoffId] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const stageFile = async (file) => {
    if (!file) return;
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setFileUrl(file_url);
    setFileName(file.name);
    setSheetCount(null);
    setRows([]);
    setTakeoffId(null);
    setScanError(null);
  };

  const handleBrowseSelect = async (e) => {
    const file = e.target.files?.[0];
    await stageFile(file);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    await stageFile(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => setIsDragOver(false);

  // Single-action batch trigger — one click scans every sheet in the
  // uploaded document at once and drops the whole result into one unified,
  // simultaneously-reviewable grid. No page picker, no per-sheet buttons.
  const handleProcessFullDocument = async () => {
    if (!fileUrl) return;
    setScanning(true);
    setScanError(null);
    try {
      const result = await simulateAiBatchTakeoff(user?.company_id, fileUrl, fileName, scaleReference);
      if (!result) {
        setScanError('No local vision model reachable — connect a local VLM proxy (VITE_LOCAL_VLM_URL) to enable automatic detection, or add takeoff rows manually below.');
        setRows([]);
      } else {
        setSheetCount(result.sheetCount || 1);
        setRows(result.detections.map((d) => emptyRow({ ...d, is_accepted: true })));
      }
    } finally {
      setScanning(false);
    }
  };

  const persist = async (newRows) => {
    const accepted = newRows.filter((r) => r.is_accepted);
    const totalCostCents = accepted.reduce((sum, it) => sum + (it.unit_cost_cents || 0) * (it.quantity || 1), 0);
    const payload = {
      company_id: user?.company_id,
      file_url: fileUrl,
      file_name: fileName,
      sheet_count: sheetCount || 1,
      scale_reference: scaleReference,
      accepted_items: newRows.map(({ _key, ...rest }) => rest),
      total_cost_cents: totalCostCents,
    };
    if (takeoffId) {
      await base44.entities.blueprint_takeoffs.update(takeoffId, payload);
    } else {
      const created = await base44.entities.blueprint_takeoffs.create(payload);
      setTakeoffId(created.id);
    }
  };

  const updateRow = (key, field, value) => {
    const newRows = rows.map((r) => r._key === key ? { ...r, [field]: value } : r);
    setRows(newRows);
    persist(newRows);
  };

  const removeRow = (key) => {
    const newRows = rows.filter((r) => r._key !== key);
    setRows(newRows);
    persist(newRows);
  };

  const addManualRow = () => {
    setRows((prev) => [...prev, emptyRow()]);
  };

  const acceptedRows = rows.filter((r) => r.is_accepted);
  const totalWeight = acceptedRows.reduce((sum, r) => sum + (r.quantity || 0) * (r.unit_weight_lbs_per_ft || 0) * (r.length_ft || 0), 0);
  const totalCost = acceptedRows.reduce((sum, r) => sum + (r.quantity || 0) * (r.unit_cost_cents || 0), 0) / 100;

  return (
    <div className="p-6 w-full max-w-none space-y-4 animate-fade-in">
      <PageHeader title="Blueprint Takeoff" subtitle="Drop the entire blueprint package, process it in one shot, review the whole job's quantity takeoff at once." icon={ScanLine} />

      {/* Dual-input dropzone: native HTML5 drag-and-drop, or click to browse */}
      <div
        onClick={() => fileInputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`rounded-lg border-2 border-dashed p-8 flex flex-col items-center justify-center gap-2 text-center cursor-pointer transition-colors ${isDragOver ? 'border-primary bg-primary/10' : 'border-border bg-muted/20 hover:bg-muted/30'}`}
      >
        <input ref={fileInputRef} type="file" accept=".pdf,image/*" className="hidden" onChange={handleBrowseSelect} />
        <UploadCloud className="w-10 h-10 text-primary" />
        {fileUrl ? (
          <>
            <p className="font-semibold">{fileName}</p>
            <p className="text-xs text-muted-foreground">Drop a different file, or click to browse, to replace the loaded document.</p>
          </>
        ) : (
          <>
            <p className="font-semibold">Drag & drop the entire blueprint package here</p>
            <p className="text-xs text-muted-foreground">or click to browse your file system — multi-page PDFs and drawing sets accepted</p>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Drawing scale (e.g. 1/4in = 1ft)" value={scaleReference} onChange={(e) => setScaleReference(e.target.value)} className="w-64" onClick={(e) => e.stopPropagation()} />
      </div>

      {/* Single-action batch trigger */}
      <Button
        onClick={handleProcessFullDocument}
        disabled={!fileUrl || scanning}
        className="w-full h-16 text-lg font-extrabold uppercase tracking-wide steel-gradient text-white border-0"
      >
        {scanning ? <Loader2 className="w-6 h-6 mr-3 animate-spin" /> : <ScanLine className="w-6 h-6 mr-3" />}
        PROCESS FULL DOCUMENT TAKEOFF
      </Button>

      {scanning && (
        <div className="w-full rounded-lg border-2 border-primary bg-primary text-primary-foreground px-4 py-3 flex items-center gap-3 animate-pulse">
          <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" />
          <p className="text-sm font-bold uppercase tracking-wide">
            AI Vision Core Analyzing Entire Multi-Sheet Blueprint Package. Processing Elements Across All Drawing Pages...
          </p>
        </div>
      )}
      {scanError && <p className="text-sm text-amber-600">{scanError}</p>}

      {rows.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <FileStack className="w-4 h-4 text-primary" />
              Unified Quantity Takeoff — {sheetCount || 1} sheet{(sheetCount || 1) === 1 ? '' : 's'}, {rows.length} item{rows.length === 1 ? '' : 's'}
            </h3>
            <Button size="sm" variant="outline" onClick={addManualRow}><Plus className="w-3.5 h-3.5 mr-1" />Add Row</Button>
          </div>
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm min-w-[1100px]">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="p-2 font-medium w-10">✓</th>
                  <th className="p-2 font-medium w-16">Sheet</th>
                  <th className="p-2 font-medium">Shape Type</th>
                  <th className="p-2 font-medium">Size Designation</th>
                  <th className="p-2 font-medium w-20">Conf.</th>
                  <th className="p-2 font-medium w-20">Qty</th>
                  <th className="p-2 font-medium w-24">Wt (lb/ft)</th>
                  <th className="p-2 font-medium w-20">Length (ft)</th>
                  <th className="p-2 font-medium w-24">Total Wt (lb)</th>
                  <th className="p-2 font-medium w-24">Unit Cost ($)</th>
                  <th className="p-2 font-medium w-28">Ext. Cost ($)</th>
                  <th className="p-2 font-medium w-10"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const rowWeight = (r.quantity || 0) * (r.unit_weight_lbs_per_ft || 0) * (r.length_ft || 0);
                  const rowCost = (r.quantity || 0) * (r.unit_cost_cents || 0) / 100;
                  return (
                    <tr key={r._key} className={`border-t ${r.is_accepted ? '' : 'opacity-50'}`}>
                      <td className="p-2">
                        <input type="checkbox" checked={r.is_accepted} onChange={(e) => updateRow(r._key, 'is_accepted', e.target.checked)} />
                      </td>
                      <td className="p-2 text-xs text-muted-foreground">{r.page_number || 1}</td>
                      <td className="p-2"><Input value={r.shape_type} onChange={(e) => updateRow(r._key, 'shape_type', e.target.value)} className="h-8" /></td>
                      <td className="p-2"><Input value={r.size_designation} onChange={(e) => updateRow(r._key, 'size_designation', e.target.value)} className="h-8" /></td>
                      <td className="p-2 text-xs text-muted-foreground">{r.confidence != null ? `${Math.round(r.confidence * 100)}%` : '—'}</td>
                      <td className="p-2"><Input type="number" min={0} value={r.quantity} onChange={(e) => updateRow(r._key, 'quantity', Number(e.target.value) || 0)} className="h-8" /></td>
                      <td className="p-2"><Input type="number" min={0} value={r.unit_weight_lbs_per_ft} onChange={(e) => updateRow(r._key, 'unit_weight_lbs_per_ft', Number(e.target.value) || 0)} className="h-8" /></td>
                      <td className="p-2"><Input type="number" min={0} value={r.length_ft} onChange={(e) => updateRow(r._key, 'length_ft', Number(e.target.value) || 0)} className="h-8" /></td>
                      <td className="p-2 text-xs font-medium">{rowWeight.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                      <td className="p-2"><Input type="number" min={0} value={r.unit_cost_cents ? r.unit_cost_cents / 100 : ''} onChange={(e) => updateRow(r._key, 'unit_cost_cents', Math.round((Number(e.target.value) || 0) * 100))} className="h-8" /></td>
                      <td className="p-2 text-xs font-medium">${rowCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      <td className="p-2">
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeRow(r._key)}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/30 font-semibold">
                  <td colSpan={8} className="p-2 text-right">Job Totals ({acceptedRows.length} accepted)</td>
                  <td className="p-2 text-xs">{totalWeight.toLocaleString(undefined, { maximumFractionDigits: 0 })} lb</td>
                  <td></td>
                  <td className="p-2">${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
