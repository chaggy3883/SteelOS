import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { db } from '@/api/apiClient';
import {
  ShoppingCart, AlertTriangle, Package, TrendingDown, Plus, Search, ArrowRight,
  UploadCloud, Brain, FileText, RefreshCw, AlertCircle, Trash2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/ui/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const AUTO_APPROVE_THRESHOLD = 5000;

const emptyPoForm = () => ({ vendor_id: '', project_id: '', cost_code: '', description: '' });
const emptyManualLine = () => ({ description: '', quantity: '', unit_of_measure: 'pc', unit_cost: '' });
const emptyReviewLine = () => ({ description: '', quantity: '', unit_of_measure: 'ea', unit_cost: '', confidence: null });

const lineTotal = (line) => (Number(line.quantity) || 0) * (Number(line.unit_cost) || 0);

export default function Purchasing() {
  const { toast } = useToast();
  const [inventory, setInventory] = useState([]);
  const [findings, setFindings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [vendors, setVendors] = useState([]);
  const [projects, setProjects] = useState([]);
  const [costCodes, setCostCodes] = useState([]);
  const [showNewPo, setShowNewPo] = useState(false);
  const [poForm, setPoForm] = useState(emptyPoForm());
  const [savingPo, setSavingPo] = useState(false);

  // New PO dialog — entry mode + manual line-item table (Section B)
  const [poEntryMode, setPoEntryMode] = useState('manual');
  const [manualLines, setManualLines] = useState([emptyManualLine()]);

  // New PO dialog — quick "create a vendor on the spot" (never auto-created from AI output)
  const [showQuickVendorForm, setShowQuickVendorForm] = useState(false);
  const [quickVendorName, setQuickVendorName] = useState('');
  const [creatingVendor, setCreatingVendor] = useState(false);

  // New PO dialog — AI Quote Reader (Section A)
  const [quoteFile, setQuoteFile] = useState(null);
  const [quoteFileUrl, setQuoteFileUrl] = useState('');
  const [parsingQuote, setParsingQuote] = useState(false);
  const [quoteParseError, setQuoteParseError] = useState('');
  const [aiQuote, setAiQuote] = useState(null);
  const [reviewLines, setReviewLines] = useState([]);
  const [creatingAiPo, setCreatingAiPo] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [invData, findData, vendorData, projectData] = await Promise.all([
        db.entities.InventoryItem.filter({ is_active: true }, '-created_date', 100),
        db.entities.AIFinding.filter({ review_package: 'purchasing' }, '-created_date', 50),
        db.entities.Vendor.filter({ is_active: true }, '-created_date', 100),
        db.entities.Project.list('-created_date', 100),
      ]);
      setInventory(invData);
      setFindings(findData);
      setVendors(vendorData);
      setProjects(projectData);
    } catch (e) {} finally { setLoading(false); }
  };

  const startNewPo = () => {
    setPoForm(emptyPoForm());
    setCostCodes([]);
    setPoEntryMode('manual');
    setManualLines([emptyManualLine()]);
    setShowQuickVendorForm(false);
    setQuickVendorName('');
    setQuoteFile(null);
    setQuoteFileUrl('');
    setQuoteParseError('');
    setAiQuote(null);
    setReviewLines([]);
    setShowNewPo(true);
  };

  const handleProjectChange = async (projectId) => {
    setPoForm(f => ({ ...f, project_id: projectId, cost_code: '' }));
    try {
      const rows = await db.entities.ProjectJobCostSummary.filter({ project_id: projectId }, '-created_date', 100);
      setCostCodes(rows.filter(r => (r.cost_code || '').startsWith('05')));
    } catch (e) {
      setCostCodes([]);
    }
  };

  const handleCreateQuickVendor = async () => {
    if (!quickVendorName.trim()) return;
    setCreatingVendor(true);
    try {
      const created = await db.entities.Vendor.create({ name: quickVendorName.trim(), vendor_type: 'supplier', is_active: true });
      setVendors((prev) => [...prev, created]);
      setPoForm((f) => ({ ...f, vendor_id: created.id }));
      setShowQuickVendorForm(false);
      setQuickVendorName('');
      toast({ title: 'Vendor added' });
    } catch (e) {
      toast({ title: 'Unable to add vendor', variant: 'destructive' });
    } finally {
      setCreatingVendor(false);
    }
  };

  // Shared by both the manual and AI-quote paths — this is the fix: every PO
  // created here now gets real purchase_order_lines, which is what the
  // Receiving Kiosk actually checks items off against.
  const createPoLines = async (poId, lines) => {
    await Promise.all(lines.map((line, idx) => {
      const quantity = Number(line.quantity) || 0;
      const unitCost = Number(line.unit_cost) || 0;
      return db.entities.purchase_order_lines.create({
        po_id: poId,
        line_number: idx + 1,
        description: line.description.trim(),
        unit_of_measure: line.unit_of_measure || 'ea',
        quantity_ordered: quantity,
        unit_cost: unitCost,
        line_total: quantity * unitCost,
        quantity_received: 0,
        quantity_remaining: quantity,
        is_fully_received: false,
      });
    }));
  };

  // --- Manual line-item table (Section B) ---
  const addManualLine = () => setManualLines((prev) => [...prev, emptyManualLine()]);
  const removeManualLine = (idx) => setManualLines((prev) => prev.filter((_, i) => i !== idx));
  const updateManualLine = (idx, field, value) => setManualLines((prev) => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  const manualValidLines = manualLines.filter((l) => l.description.trim() && Number(l.quantity) > 0);
  const manualLinesTotal = manualLines.reduce((sum, l) => sum + lineTotal(l), 0);

  const handleSaveNewPo = async () => {
    if (!poForm.vendor_id || !poForm.project_id || !poForm.description) {
      toast({ title: 'Vendor, Project, and Description are required', variant: 'destructive' });
      return;
    }
    if (manualValidLines.length === 0) {
      toast({ title: 'At least one line item (description + quantity) is required', variant: 'destructive' });
      return;
    }
    setSavingPo(true);
    try {
      const totalEstimatedCost = manualLinesTotal;
      const approvalStatus = totalEstimatedCost <= AUTO_APPROVE_THRESHOLD ? 'Auto_Approved' : 'Exec_Review';
      const vendor = vendors.find(v => v.id === poForm.vendor_id);
      const po = await db.entities.purchase_orders.create({
        vendor_id: poForm.vendor_id,
        vendor_name: vendor?.name || '',
        project_id: poForm.project_id,
        po_number: `PO-${Date.now().toString().slice(-6)}`,
        cost_code: poForm.cost_code,
        description: poForm.description,
        total_estimated_cost: totalEstimatedCost,
        budgeted_cost: totalEstimatedCost,
        approval_status: approvalStatus,
        status: 'Open',
        requires_signature: approvalStatus === 'Exec_Review',
      });
      await createPoLines(po.id, manualValidLines);
      toast({ title: `PO created — ${approvalStatus.replace(/_/g, ' ')}` });
      setShowNewPo(false);
      loadData();
    } catch (e) {
      toast({ title: 'Unable to create PO', variant: 'destructive' });
    } finally {
      setSavingPo(false);
    }
  };

  // --- AI Quote Reader (Section A) ---
  const matchVendorByName = (name) => {
    if (!name) return null;
    const normalized = name.trim().toLowerCase();
    if (!normalized) return null;
    return vendors.find((v) => v.name?.trim().toLowerCase() === normalized)
      || vendors.find((v) => v.name && (v.name.toLowerCase().includes(normalized) || normalized.includes(v.name.toLowerCase())))
      || null;
  };

  const handleQuoteFileSelected = (file) => {
    if (!file) return;
    setQuoteFile(file);
    setQuoteFileUrl('');
    setAiQuote(null);
    setReviewLines([]);
    setQuoteParseError('');
  };

  // Same InvokeLLM prompt/schema/error-handling shape as SmartFileDump.jsx's
  // runAIParse — upload first, then a single structured-extraction call.
  const runQuoteParse = async () => {
    if (!quoteFile) return;
    setParsingQuote(true);
    setQuoteParseError('');
    try {
      const { file_url } = await db.integrations.Core.UploadFile({ file: quoteFile });
      setQuoteFileUrl(file_url);

      const response = await db.integrations.Core.InvokeLLM({
        prompt: 'You are a structural steel purchasing assistant. Parse the uploaded vendor quote document and extract the vendor name, quote number, quote date, and every line item with its description, quantity, unit of measure, and unit cost. If uncertain about a line item, include a confidence score from 0 to 1.',
        file_urls: [file_url],
        response_json_schema: {
          type: 'object',
          properties: {
            vendor_name: { type: 'string' },
            quote_number: { type: 'string' },
            quote_date: { type: 'string' },
            line_items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  description: { type: 'string' },
                  quantity: { type: 'number' },
                  unit_of_measure: { type: 'string' },
                  unit_cost: { type: 'number' },
                  confidence: { type: 'number' }
                }
              }
            }
          }
        }
      });

      setAiQuote(response);
      setReviewLines((response.line_items || []).map((li) => ({
        description: li.description || '',
        quantity: li.quantity ?? '',
        unit_of_measure: li.unit_of_measure || 'ea',
        unit_cost: li.unit_cost ?? '',
        confidence: typeof li.confidence === 'number' ? li.confidence : null,
      })));

      const match = matchVendorByName(response.vendor_name);
      setPoForm((f) => ({
        ...f,
        vendor_id: match ? match.id : f.vendor_id,
        description: f.description || [`Quote ${response.quote_number || ''}`.trim(), response.vendor_name].filter(Boolean).join(' — '),
      }));

      toast({ title: 'Quote parsed', description: 'Review the extracted line items before creating the PO.' });
    } catch (e) {
      const message = e?.message || 'The AI parse failed unexpectedly.';
      setQuoteParseError(message);
      toast({ title: 'AI parsing failed', description: message, variant: 'destructive' });
    } finally {
      setParsingQuote(false);
    }
  };

  const updateReviewLine = (idx, field, value) => setReviewLines((prev) => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  const addReviewLine = () => setReviewLines((prev) => [...prev, emptyReviewLine()]);
  const removeReviewLine = (idx) => setReviewLines((prev) => prev.filter((_, i) => i !== idx));
  const reviewValidLines = reviewLines.filter((l) => l.description.trim() && Number(l.quantity) > 0);
  const reviewLinesTotal = reviewLines.reduce((sum, l) => sum + lineTotal(l), 0);

  const handleApproveAiPo = async () => {
    if (!poForm.vendor_id || !poForm.project_id) {
      toast({ title: 'Vendor and Project are required', description: 'Pick or create a vendor before approving.', variant: 'destructive' });
      return;
    }
    if (reviewValidLines.length === 0) {
      toast({ title: 'At least one line item (description + quantity) is required', variant: 'destructive' });
      return;
    }
    setCreatingAiPo(true);
    try {
      const totalEstimatedCost = reviewValidLines.reduce((sum, l) => sum + lineTotal(l), 0);
      const approvalStatus = totalEstimatedCost <= AUTO_APPROVE_THRESHOLD ? 'Auto_Approved' : 'Exec_Review';
      const vendor = vendors.find(v => v.id === poForm.vendor_id);
      const po = await db.entities.purchase_orders.create({
        vendor_id: poForm.vendor_id,
        vendor_name: vendor?.name || '',
        project_id: poForm.project_id,
        po_number: `PO-${Date.now().toString().slice(-6)}`,
        cost_code: poForm.cost_code,
        description: poForm.description || `Quote ${aiQuote?.quote_number || ''}`.trim(),
        total_estimated_cost: totalEstimatedCost,
        budgeted_cost: totalEstimatedCost,
        approval_status: approvalStatus,
        status: 'Open',
        requires_signature: approvalStatus === 'Exec_Review',
      });
      await createPoLines(po.id, reviewValidLines);

      if (quoteFileUrl) {
        await db.entities.Document.create({
          project_id: poForm.project_id,
          po_id: po.id,
          name: quoteFile?.name || `Quote — ${po.po_number}`,
          file_url: quoteFileUrl,
          file_name: quoteFile?.name || '',
          file_size: quoteFile?.size || 0,
          file_type: quoteFile?.type || '',
          document_type: 'vendor_quote',
          status: 'uploaded',
          ai_processing_status: 'complete',
          description: `Source vendor quote for ${po.po_number}`,
        });
      }

      toast({ title: `PO created from quote — ${approvalStatus.replace(/_/g, ' ')}` });
      setShowNewPo(false);
      loadData();
    } catch (e) {
      toast({ title: 'Unable to create PO', variant: 'destructive' });
    } finally {
      setCreatingAiPo(false);
    }
  };

  const lowStock = inventory.filter(i => i.reorder_point && i.quantity_available <= i.reorder_point);
  const totalValue = inventory.reduce((s, i) => s + ((i.quantity_on_hand || 0) * (i.unit_cost || 0)), 0);

  const filteredInventory = inventory.filter(i =>
    !search || i.description?.toLowerCase().includes(search.toLowerCase()) || i.item_number?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader
        title="Purchasing"
        subtitle="Material procurement and AI-flagged purchasing requirements"
        actions={
          <div className="flex gap-2">
            <Button className="steel-gradient text-white border-0" onClick={startNewPo}><Plus className="w-4 h-4 mr-2" />New PO</Button>
            <Link to="/purchasing/module">
              <Button variant="outline" className="gap-2">
                <ArrowRight className="w-4 h-4" /> Procurement Module
              </Button>
            </Link>
            <Link to="/purchasing/receiving-kiosk">
              <Button variant="outline" className="gap-2">
                <ArrowRight className="w-4 h-4" /> Receiving Kiosk
              </Button>
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total SKUs', value: inventory.length, icon: Package, color: 'text-blue-500' },
          { label: 'Low Stock Alerts', value: lowStock.length, icon: AlertTriangle, color: 'text-orange-500' },
          { label: 'AI Purchasing Flags', value: findings.length, icon: TrendingDown, color: 'text-purple-500' },
          { label: 'Inventory Value', value: `$${(totalValue/1000).toFixed(0)}K`, icon: ShoppingCart, color: 'text-green-500' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="steel-card p-4">
            <div className="flex items-center gap-2 mb-1"><Icon className={`w-4 h-4 ${color}`} /><p className="text-xs text-muted-foreground">{label}</p></div>
            <p className={`text-2xl font-bold ${color}`}>{loading ? '—' : value}</p>
          </div>
        ))}
      </div>

      <Tabs defaultValue="reorder">
        <TabsList className="mb-4">
          <TabsTrigger value="reorder">Reorder Alerts ({lowStock.length})</TabsTrigger>
          <TabsTrigger value="ai">AI Purchasing Flags ({findings.length})</TabsTrigger>
          <TabsTrigger value="all">All Inventory</TabsTrigger>
        </TabsList>

        <TabsContent value="reorder">
          {lowStock.length === 0 ? (
            <div className="text-center py-16 steel-card"><Package className="w-10 h-10 text-muted-foreground mx-auto mb-3" /><p className="text-sm text-muted-foreground">No low stock alerts</p></div>
          ) : (
            <div className="steel-card overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left py-3 px-4">Item</th><th className="text-left py-3 px-4">Category</th>
                  <th className="text-right py-3 px-4">On Hand</th><th className="text-right py-3 px-4">Reorder Point</th>
                </tr></thead>
                <tbody>
                  {lowStock.map(i => (
                    <tr key={i.id} className="border-b border-border/50 hover:bg-muted/50">
                      <td className="py-3 px-4"><p className="font-medium">{i.description}</p><p className="text-xs text-muted-foreground">{i.item_number}</p></td>
                      <td className="py-3 px-4"><span className="text-xs bg-muted px-2 py-0.5 rounded">{i.category?.replace(/_/g,' ')}</span></td>
                      <td className="py-3 px-4 text-right font-mono text-orange-500 font-bold">{i.quantity_available ?? i.quantity_on_hand}</td>
                      <td className="py-3 px-4 text-right font-mono text-muted-foreground">{i.reorder_point}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="ai">
          {findings.length === 0 ? (
            <div className="text-center py-16 steel-card"><ShoppingCart className="w-10 h-10 text-muted-foreground mx-auto mb-3" /><p className="text-sm text-muted-foreground">No AI purchasing flags. Upload project specifications to generate analysis.</p></div>
          ) : (
            <div className="space-y-3">
              {findings.map(f => (
                <div key={f.id} className={`steel-card p-4 border-l-4 ${f.status === 'fail' ? 'border-l-red-500' : f.status === 'warning' ? 'border-l-yellow-500' : 'border-l-blue-500'}`}>
                  <p className="font-medium text-sm">{f.title}</p>
                  {f.ai_explanation && <p className="text-xs text-muted-foreground mt-1">{f.ai_explanation}</p>}
                  {f.recommendation && <p className="text-xs text-primary mt-1">→ {f.recommendation}</p>}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="all">
          <div className="relative max-w-sm mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search inventory..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <div className="steel-card overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left py-3 px-4">Description</th><th className="text-left py-3 px-4">Category</th>
                <th className="text-left py-3 px-4">Grade/Size</th><th className="text-right py-3 px-4">Qty On Hand</th>
                <th className="text-right py-3 px-4">Unit Cost</th>
              </tr></thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={5} className="py-3 px-4"><div className="h-6 bg-muted rounded animate-pulse" /></td></tr>)
                ) : filteredInventory.map(i => (
                  <tr key={i.id} className="border-b border-border/50 hover:bg-muted/50">
                    <td className="py-3 px-4"><p className="font-medium">{i.description}</p><p className="text-xs text-muted-foreground">{i.item_number}</p></td>
                    <td className="py-3 px-4"><span className="text-xs bg-muted px-2 py-0.5 rounded">{i.category?.replace(/_/g,' ')}</span></td>
                    <td className="py-3 px-4 text-sm text-muted-foreground">{[i.material_grade, i.size].filter(Boolean).join(' / ') || '—'}</td>
                    <td className={`py-3 px-4 text-right font-mono font-bold ${i.reorder_point && i.quantity_on_hand <= i.reorder_point ? 'text-orange-500' : 'text-foreground'}`}>{i.quantity_on_hand ?? 0}</td>
                    <td className="py-3 px-4 text-right font-mono text-muted-foreground">{i.unit_cost ? `$${i.unit_cost.toFixed(2)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={showNewPo} onOpenChange={setShowNewPo}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto border-2 border-primary/40">
          <DialogHeader><DialogTitle>New Purchase Order</DialogTitle></DialogHeader>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between">
                <Label>Vendor</Label>
                <button className="text-xs text-primary hover:underline" onClick={() => setShowQuickVendorForm((s) => !s)}>+ New Vendor</button>
              </div>
              <Select value={poForm.vendor_id} onValueChange={(v) => setPoForm(f => ({ ...f, vendor_id: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select a vendor or subcontractor" /></SelectTrigger>
                <SelectContent>
                  {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name} ({v.vendor_type?.replace(/_/g, ' ')})</SelectItem>)}
                </SelectContent>
              </Select>
              {showQuickVendorForm && (
                <div className="flex gap-2 mt-2">
                  <Input value={quickVendorName} onChange={(e) => setQuickVendorName(e.target.value)} placeholder="New vendor name" className="h-9" />
                  <Button size="sm" onClick={handleCreateQuickVendor} disabled={creatingVendor || !quickVendorName.trim()}>
                    {creatingVendor ? 'Adding…' : 'Add'}
                  </Button>
                </div>
              )}
              {aiQuote && !poForm.vendor_id && (
                <p className="text-xs text-amber-600 mt-1">Quote lists vendor "{aiQuote.vendor_name || 'unknown'}" — no match found. Pick or create a vendor above before approving.</p>
              )}
            </div>
            <div>
              <Label>Project</Label>
              <Select value={poForm.project_id} onValueChange={handleProjectChange}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select a project" /></SelectTrigger>
                <SelectContent>
                  {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Cost Code (Division 05)</Label>
              <Select value={poForm.cost_code} onValueChange={(v) => setPoForm(f => ({ ...f, cost_code: v }))} disabled={costCodes.length === 0}>
                <SelectTrigger className="mt-1"><SelectValue placeholder={costCodes.length === 0 ? 'No Division 05 cost codes for this project' : 'Select a cost code'} /></SelectTrigger>
                <SelectContent>
                  {costCodes.map(c => <SelectItem key={c.id} value={c.cost_code}>{c.cost_code} — {c.description}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Description</Label>
              <Input value={poForm.description} onChange={(e) => setPoForm(f => ({ ...f, description: e.target.value }))} className="mt-1" placeholder="e.g. Structural steel buyout" />
            </div>
          </div>

          <Tabs value={poEntryMode} onValueChange={setPoEntryMode} className="mt-3">
            <TabsList>
              <TabsTrigger value="manual">Manual Entry</TabsTrigger>
              <TabsTrigger value="ai" className="gap-1.5"><Brain className="w-3.5 h-3.5" />Read a Quote (AI)</TabsTrigger>
            </TabsList>

            <TabsContent value="manual" className="space-y-3">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground uppercase tracking-wide border-b border-border">
                      <th className="py-2 pr-2">Description</th>
                      <th className="py-2 pr-2 w-24">Qty</th>
                      <th className="py-2 pr-2 w-20">Unit</th>
                      <th className="py-2 pr-2 w-28 text-right">Unit Cost</th>
                      <th className="py-2 pr-2 w-28 text-right">Line Total</th>
                      <th className="py-2 pr-0 w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {manualLines.map((line, i) => (
                      <tr key={i} className="border-b border-border/60">
                        <td className="py-1.5 pr-2"><Input value={line.description} onChange={(e) => updateManualLine(i, 'description', e.target.value)} className="h-8" placeholder="e.g. W12x26 Beams" /></td>
                        <td className="py-1.5 pr-2"><Input type="number" value={line.quantity} onChange={(e) => updateManualLine(i, 'quantity', e.target.value)} className="h-8" /></td>
                        <td className="py-1.5 pr-2"><Input value={line.unit_of_measure} onChange={(e) => updateManualLine(i, 'unit_of_measure', e.target.value)} className="h-8" /></td>
                        <td className="py-1.5 pr-2"><Input type="number" value={line.unit_cost} onChange={(e) => updateManualLine(i, 'unit_cost', e.target.value)} className="h-8 text-right" /></td>
                        <td className="py-1.5 pr-2 text-right font-mono">${lineTotal(line).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                        <td className="py-1.5 pr-0 text-center">
                          <button onClick={() => removeManualLine(i)} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between">
                <Button size="sm" variant="outline" className="gap-1.5" onClick={addManualLine}><Plus className="w-3.5 h-3.5" />Add Line</Button>
                <p className="text-sm font-semibold">Total: ${manualLinesTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
              </div>
              <p className="text-xs text-muted-foreground">≤ ${AUTO_APPROVE_THRESHOLD.toLocaleString()} auto-approves to the Purchasing queue; above that routes to Executive Review.</p>
            </TabsContent>

            <TabsContent value="ai" className="space-y-4">
              {!aiQuote && (
                <>
                  <label className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/50 transition-colors block">
                    <input type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => handleQuoteFileSelected(e.target.files?.[0])} />
                    <UploadCloud className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm font-medium">Upload a vendor quote (PDF or image)</p>
                    <p className="text-xs text-muted-foreground mt-1">AI will extract the vendor, quote details, and line items for your review</p>
                  </label>

                  {quoteFile && (
                    <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <span className="text-sm truncate">{quoteFile.name}</span>
                      </div>
                      <Button size="sm" onClick={runQuoteParse} disabled={parsingQuote} className="steel-gradient text-white border-0">
                        {parsingQuote ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Parsing…</> : <><Brain className="w-3.5 h-3.5 mr-1.5" />Parse Quote</>}
                      </Button>
                    </div>
                  )}
                </>
              )}

              {quoteParseError && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400 space-y-2">
                  <p className="font-semibold">AI parse error</p>
                  <p>{quoteParseError}</p>
                  <Button size="sm" variant="outline" onClick={runQuoteParse}><RefreshCw className="w-3.5 h-3.5 mr-1.5" />Retry</Button>
                </div>
              )}

              {aiQuote && (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="p-2 rounded bg-muted/50"><span className="text-muted-foreground">Quote #:</span> <strong>{aiQuote.quote_number || '—'}</strong></div>
                    <div className="p-2 rounded bg-muted/50"><span className="text-muted-foreground">Quote Date:</span> <strong>{aiQuote.quote_date || '—'}</strong></div>
                    <div className="p-2 rounded bg-muted/50"><span className="text-muted-foreground">Extracted Vendor:</span> <strong>{aiQuote.vendor_name || '—'}</strong></div>
                  </div>

                  {(reviewLines.length === 0) && (
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-400">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      No line items were extracted — add them manually below or retry with a clearer scan.
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted-foreground uppercase tracking-wide border-b border-border">
                          <th className="py-2 pr-2">Description</th>
                          <th className="py-2 pr-2 w-20">Qty</th>
                          <th className="py-2 pr-2 w-16">Unit</th>
                          <th className="py-2 pr-2 w-24 text-right">Unit Cost</th>
                          <th className="py-2 pr-2 w-24 text-right">Line Total</th>
                          <th className="py-2 pr-2 w-16">Confidence</th>
                          <th className="py-2 pr-0 w-8" />
                        </tr>
                      </thead>
                      <tbody>
                        {reviewLines.map((line, i) => (
                          <tr key={i} className="border-b border-border/60">
                            <td className="py-1.5 pr-2"><Input value={line.description} onChange={(e) => updateReviewLine(i, 'description', e.target.value)} className="h-8" /></td>
                            <td className="py-1.5 pr-2"><Input type="number" value={line.quantity} onChange={(e) => updateReviewLine(i, 'quantity', e.target.value)} className="h-8" /></td>
                            <td className="py-1.5 pr-2"><Input value={line.unit_of_measure} onChange={(e) => updateReviewLine(i, 'unit_of_measure', e.target.value)} className="h-8" /></td>
                            <td className="py-1.5 pr-2"><Input type="number" value={line.unit_cost} onChange={(e) => updateReviewLine(i, 'unit_cost', e.target.value)} className="h-8 text-right" /></td>
                            <td className="py-1.5 pr-2 text-right font-mono">${lineTotal(line).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                            <td className="py-1.5 pr-2">
                              {line.confidence != null ? (
                                <Badge className={`text-[10px] border-0 ${line.confidence >= 0.8 ? 'bg-green-500/10 text-green-600' : line.confidence >= 0.5 ? 'bg-amber-500/10 text-amber-600' : 'bg-red-500/10 text-red-600'}`}>
                                  {Math.round(line.confidence * 100)}%
                                </Badge>
                              ) : <span className="text-xs text-muted-foreground">—</span>}
                            </td>
                            <td className="py-1.5 pr-0 text-center">
                              <button onClick={() => removeReviewLine(i)} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between">
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={addReviewLine}><Plus className="w-3.5 h-3.5" />Add Line</Button>
                    <p className="text-sm font-semibold">Total: ${reviewLinesTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewPo(false)}>Cancel</Button>
            {poEntryMode === 'ai' ? (
              <Button onClick={handleApproveAiPo} disabled={creatingAiPo || !aiQuote || reviewValidLines.length === 0} className="steel-gradient text-white border-0">
                {creatingAiPo ? 'Creating…' : 'Approve & Create PO'}
              </Button>
            ) : (
              <Button onClick={handleSaveNewPo} disabled={savingPo || manualValidLines.length === 0} className="steel-gradient text-white border-0">
                {savingPo ? 'Creating…' : 'Create PO'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
