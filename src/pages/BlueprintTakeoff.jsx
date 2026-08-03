import React, { useState, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { simulateAiBatchTakeoff } from '@/lib/aiIntelligenceEngine';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Upload, ScanLine, Check, X, Plus, Ruler, Layers } from 'lucide-react';

const BOX_COLOR = 'border-primary bg-primary/10';

export default function BlueprintTakeoff() {
  const { user } = useOutletContext() || {};
  const [fileUrl, setFileUrl] = useState(null);
  const [fileName, setFileName] = useState('');
  const [isPdf, setIsPdf] = useState(false);
  const [sheetCount, setSheetCount] = useState(1);
  const [scaleReference, setScaleReference] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [pendingDetections, setPendingDetections] = useState([]);
  const [acceptedItems, setAcceptedItems] = useState([]);
  const [takeoffId, setTakeoffId] = useState(null);
  const fileInputRef = useRef(null);

  // Document drop = the whole package goes in at once. No page picker, no
  // carousel, no "which sheet am I on" step — upload immediately kicks off
  // the single unified batch scan across every sheet in the file.
  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setFileUrl(file_url);
    setFileName(file.name);
    setIsPdf(file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
    setPendingDetections([]);
    setAcceptedItems([]);
    setTakeoffId(null);
    setScanError(null);
    await runBatchScan(file_url, file.name);
  };

  const runBatchScan = async (urlOverride, nameOverride) => {
    const url = urlOverride || fileUrl;
    if (!url) return;
    setScanning(true);
    setScanError(null);
    try {
      const result = await simulateAiBatchTakeoff(user?.company_id, url, nameOverride || fileName, scaleReference);
      if (!result) {
        setScanError('No local vision model reachable — connect a local VLM proxy (VITE_LOCAL_VLM_URL) to enable automatic detection, or add takeoff items manually below.');
        setPendingDetections([]);
      } else {
        setSheetCount(result.sheetCount || 1);
        setPendingDetections(result.detections.map((d, i) => ({ ...d, _key: `${Date.now()}-${i}` })));
      }
    } finally {
      setScanning(false);
    }
  };

  const persistAccepted = async (newItems) => {
    const totalCostCents = newItems.reduce((sum, it) => sum + (it.unit_cost_cents || 0) * (it.quantity || 1), 0);
    if (takeoffId) {
      await base44.entities.blueprint_takeoffs.update(takeoffId, { accepted_items: newItems, total_cost_cents: totalCostCents });
    } else {
      const created = await base44.entities.blueprint_takeoffs.create({
        company_id: user?.company_id,
        file_url: fileUrl,
        file_name: fileName,
        sheet_count: sheetCount,
        scale_reference: scaleReference,
        accepted_items: newItems,
        total_cost_cents: totalCostCents,
      });
      setTakeoffId(created.id);
    }
  };

  const acceptDetection = (key) => {
    const detection = pendingDetections.find((d) => d._key === key);
    if (!detection) return;
    const newItems = [...acceptedItems, { ...detection, quantity: 1, unit_cost_cents: 0 }];
    setAcceptedItems(newItems);
    setPendingDetections((prev) => prev.filter((d) => d._key !== key));
    persistAccepted(newItems);
  };

  const acceptAllDetections = () => {
    if (pendingDetections.length === 0) return;
    const newItems = [...acceptedItems, ...pendingDetections.map((d) => ({ ...d, quantity: 1, unit_cost_cents: 0 }))];
    setAcceptedItems(newItems);
    setPendingDetections([]);
    persistAccepted(newItems);
  };

  const rejectDetection = (key) => {
    setPendingDetections((prev) => prev.filter((d) => d._key !== key));
  };

  const updateAcceptedItem = (index, field, value) => {
    const newItems = acceptedItems.map((it, i) => i === index ? { ...it, [field]: value } : it);
    setAcceptedItems(newItems);
    persistAccepted(newItems);
  };

  const addManualItem = () => {
    const newItems = [...acceptedItems, { page_number: 1, shape_type: '', size_designation: '', bbox: null, confidence: null, quantity: 1, unit_cost_cents: 0 }];
    setAcceptedItems(newItems);
  };

  const totalCost = acceptedItems.reduce((sum, it) => sum + (it.unit_cost_cents || 0) * (it.quantity || 1), 0) / 100;

  return (
    <div className="p-6 w-full max-w-none space-y-4 animate-fade-in">
      <PageHeader title="Blueprint Takeoff" subtitle="Drop the entire blueprint package — every sheet is scanned in one batch and vetted before it hits the cost total." icon={ScanLine} />

      {scanning && (
        <div className="w-full rounded-lg border-2 border-primary bg-primary text-primary-foreground px-4 py-3 flex items-center gap-3 animate-pulse">
          <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" />
          <p className="text-sm font-bold uppercase tracking-wide">
            AI Vision Core Analyzing Entire Multi-Sheet Blueprint Package. Processing Elements Across All Drawing Pages...
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={scanning}>
              <Upload className="w-4 h-4 mr-2" />Upload Blueprint Package
            </Button>
            <input ref={fileInputRef} type="file" accept=".pdf,image/*" className="hidden" onChange={handleFileChange} />
            <div className="flex items-center gap-1.5">
              <Ruler className="w-4 h-4 text-muted-foreground" />
              <Input placeholder="Scale (e.g. 1/4in = 1ft)" value={scaleReference} onChange={(e) => setScaleReference(e.target.value)} className="w-48" />
            </div>
            {fileUrl && (
              <Button variant="outline" onClick={() => runBatchScan()} disabled={scanning}>
                {scanning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ScanLine className="w-4 h-4 mr-2" />}
                Re-scan Entire Package
              </Button>
            )}
            {fileUrl && (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground ml-auto">
                <Layers className="w-3.5 h-3.5" />{sheetCount} sheet{sheetCount === 1 ? '' : 's'} detected
              </span>
            )}
          </div>

          <div className="relative border rounded-lg bg-muted/20 min-h-[420px] overflow-hidden flex items-center justify-center">
            {!fileUrl && <p className="text-muted-foreground text-sm">No blueprint package uploaded yet.</p>}
            {fileUrl && isPdf && (
              <embed src={fileUrl} type="application/pdf" className="w-full h-[600px]" />
            )}
            {fileUrl && !isPdf && (
              <img src={fileUrl} alt={fileName} className="max-w-full max-h-[600px]" />
            )}
            {fileUrl && pendingDetections.filter((d) => (d.page_number || 1) === 1).map((d) => (
              Array.isArray(d.bbox) && d.bbox.length === 4 && (
                <div
                  key={d._key}
                  className={`absolute border-2 ${BOX_COLOR} pointer-events-none`}
                  style={{
                    left: `${d.bbox[0] * 100}%`,
                    top: `${d.bbox[1] * 100}%`,
                    width: `${d.bbox[2] * 100}%`,
                    height: `${d.bbox[3] * 100}%`,
                  }}
                  title={`${d.shape_type} ${d.size_designation}`}
                />
              )
            ))}
          </div>
          {fileUrl && sheetCount > 1 && (
            <p className="text-xs text-muted-foreground">Bounding-box overlays above are shown for sheet 1 only — the review grid on the right covers detections across all {sheetCount} sheets.</p>
          )}
          {scanError && <p className="text-sm text-amber-600">{scanError}</p>}
        </div>

        <div className="space-y-4">
          <div className="border rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Uncommitted Detections — All Sheets</h3>
              {pendingDetections.length > 0 && (
                <Button size="sm" variant="outline" onClick={acceptAllDetections}>Accept All</Button>
              )}
            </div>
            {pendingDetections.length === 0 ? (
              <p className="text-xs text-muted-foreground">Upload a blueprint package to populate this review queue — every sheet is scanned in one batch, no manual page selection required.</p>
            ) : pendingDetections.map((d) => (
              <div key={d._key} className="flex items-center justify-between gap-2 border rounded p-2 text-sm">
                <div>
                  <p className="font-medium">{d.shape_type} — {d.size_designation}</p>
                  <p className="text-xs text-muted-foreground">Sheet {d.page_number || 1} · Confidence: {d.confidence != null ? `${Math.round(d.confidence * 100)}%` : '—'}</p>
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-600" onClick={() => acceptDetection(d._key)}><Check className="w-4 h-4" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-red-600" onClick={() => rejectDetection(d._key)}><X className="w-4 h-4" /></Button>
                </div>
              </div>
            ))}
          </div>

          <div className="border rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Accepted Takeoff Package</h3>
              <Button size="sm" variant="outline" onClick={addManualItem}><Plus className="w-3.5 h-3.5 mr-1" />Manual</Button>
            </div>
            {acceptedItems.length === 0 ? (
              <p className="text-xs text-muted-foreground">No items accepted yet.</p>
            ) : acceptedItems.map((it, i) => (
              <div key={i} className="grid grid-cols-5 gap-1.5 items-center text-sm">
                <span className="text-[10px] text-muted-foreground text-center">Sh.{it.page_number || 1}</span>
                <Input placeholder="Shape" value={it.shape_type} onChange={(e) => updateAcceptedItem(i, 'shape_type', e.target.value)} className="col-span-2 h-8" />
                <Input type="number" min={1} value={it.quantity} onChange={(e) => updateAcceptedItem(i, 'quantity', Number(e.target.value) || 1)} className="h-8" />
                <Input type="number" min={0} placeholder="$/ea" value={it.unit_cost_cents ? (it.unit_cost_cents / 100) : ''} onChange={(e) => updateAcceptedItem(i, 'unit_cost_cents', Math.round((Number(e.target.value) || 0) * 100))} className="h-8" />
              </div>
            ))}
            <div className="flex items-center justify-between pt-2 border-t font-semibold text-sm">
              <span>Live Total — Entire Job</span>
              <span>${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
