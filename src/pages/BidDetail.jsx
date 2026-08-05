import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '@/api/apiClient';
import { ArrowLeft, Upload, Calculator, Link2, FileText, Brain, RefreshCw, TrendingDown, AlertTriangle, Factory, Award, BarChart3, Printer, ScanSearch, ScanLine, FolderOpen } from 'lucide-react';
import { openLocalServerPath } from '@/lib/localServerPath';
import BidProposalPrintView from '@/components/estimating/BidProposalPrintView';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import SmartFileDump from '@/components/estimating/SmartFileDump';
import AIContractReviewPanel from '@/components/estimating/AIContractReviewPanel';
import DNBReasonModal from '@/components/estimating/DNBReasonModal';
import TakeoffEngine from '@/components/estimating/TakeoffEngine';
import VendorPricing from '@/components/estimating/VendorPricing';
import MillPricingTable from '@/components/estimating/MillPricingTable';
import { useToast } from '@/components/ui/use-toast';
import { Switch } from '@/components/ui/switch';
import FullTakeoff from '@/components/estimating/FullTakeoff';
import { computeEffectiveTaxRate, HANCOCK_COUNTY_TAX_RATE, TAX_RATE_PATTERN, formatTaxRatePercent, sanitizeTaxRateInput } from '@/lib/taxRate';
import { runBidReviewSkill } from '@/lib/aiReviewSkills';

const LOSS_REASONS = [
  { value: 'price', label: 'Price — Too High' },
  { value: 'competitor', label: 'Competitor Selected' },
  { value: 'schedule', label: 'Schedule — Too Long' },
  { value: 'capacity', label: 'Capacity — No Shop Availability' },
  { value: 'scope_clarity', label: 'Scope Clarity' },
  { value: 'relationship', label: 'Relationship / Preference' },
  { value: 'other', label: 'Other' },
];

export default function BidDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [bid, setBid] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('files');
  const [showLossForm, setShowLossForm] = useState(false);
  const [showDnbModal, setShowDnbModal] = useState(false);
  const [lossForm, setLossForm] = useState({ reason: '', notes: '', competitor: '' });
  const [savingLoss, setSavingLoss] = useState(false);
  const [baseInfo, setBaseInfo] = useState({ street: '', city: '', state: '', zip: '', tax_enabled: false, tax_rate: 0, joist_deck_tax_rate: HANCOCK_COUNTY_TAX_RATE, local_server_path: '' });
  const [taxRateText, setTaxRateText] = useState('');
  const [joistDeckTaxRateText, setJoistDeckTaxRateText] = useState(formatTaxRatePercent(HANCOCK_COUNTY_TAX_RATE));
  const [savingBaseInfo, setSavingBaseInfo] = useState(false);
  const [baseInfoDirty, setBaseInfoDirty] = useState(false);
  const [savingEstimate, setSavingEstimate] = useState(false);
  const takeoffRef = useRef(null);
  const materialRef = useRef(null);

  useEffect(() => { loadBid(); }, [id]);

  useEffect(() => {
    if (bid) {
      setBaseInfo({
        street: bid.street || '',
        city: bid.city || bid.job_city || '',
        state: bid.state || bid.job_state || '',
        zip: bid.zip || '',
        tax_enabled: bid.tax_enabled ?? false,
        tax_rate: bid.tax_rate ?? 0,
        joist_deck_tax_rate: bid.joist_deck_tax_rate ?? HANCOCK_COUNTY_TAX_RATE,
        local_server_path: bid.local_server_path || '',
      });
      setTaxRateText(formatTaxRatePercent(bid.tax_rate));
      setJoistDeckTaxRateText(formatTaxRatePercent(bid.joist_deck_tax_rate ?? HANCOCK_COUNTY_TAX_RATE));
      setBaseInfoDirty(false);
    }
  }, [bid]);

  const updateBaseInfo = (field, value) => {
    setBaseInfo((prev) => ({ ...prev, [field]: value }));
    setBaseInfoDirty(true);
  };

  const handleTaxRateTextChange = (e) => {
    const sanitized = sanitizeTaxRateInput(e.target.value);
    setTaxRateText(sanitized);
    if (TAX_RATE_PATTERN.test(sanitized)) {
      updateBaseInfo('tax_rate', parseFloat(sanitized) / 100);
    }
  };

  const handleTaxRateTextBlur = () => {
    if (!TAX_RATE_PATTERN.test(taxRateText)) {
      setTaxRateText(formatTaxRatePercent(baseInfo.tax_rate));
    }
  };

  const handleJoistDeckTaxRateTextChange = (e) => {
    const sanitized = sanitizeTaxRateInput(e.target.value);
    setJoistDeckTaxRateText(sanitized);
    if (TAX_RATE_PATTERN.test(sanitized)) {
      updateBaseInfo('joist_deck_tax_rate', parseFloat(sanitized) / 100);
    }
  };

  const handleJoistDeckTaxRateTextBlur = () => {
    if (!TAX_RATE_PATTERN.test(joistDeckTaxRateText)) {
      setJoistDeckTaxRateText(formatTaxRatePercent(baseInfo.joist_deck_tax_rate));
    }
  };

  const loadBid = async () => {
    setLoading(true);
    try {
      const data = await db.entities.Bid.get(id);
      setBid(data);
    } catch (e) {} finally { setLoading(false); }
  };

  const getNextProjectNumber = async () => {
    const prefix = `P${String(new Date().getFullYear() % 100).padStart(2, '0')}`;
    const existingProjects = await db.entities.Project.list('-created_date', 500);
    const pattern = new RegExp(`^${prefix}-(\\d{3})$`);
    const maxSeq = existingProjects.reduce((max, p) => {
      const match = pattern.exec(p.project_number || '');
      return match ? Math.max(max, parseInt(match[1], 10)) : max;
    }, 0);
    return `${prefix}-${String(maxSeq + 1).padStart(3, '0')}`;
  };

  const createProjectFromWonBid = async (wonBid) => {
    const project_number = await getNextProjectNumber();
    const [takeoffLines, documents] = await Promise.all([
      db.entities.TakeoffLine.filter({ bid_id: wonBid.id }, '-created_date', 200),
      db.entities.Document.filter({ bid_id: wonBid.id }, '-created_date', 200),
    ]);

    const project = await db.entities.Project.create({
      project_number,
      name: wonBid.job_name,
      customer_id: wonBid.customer_id,
      customer_name: wonBid.customer_name,
      project_type: 'commercial',
      status: 'awarded',
      contract_value: wonBid.bid_quoted_price || wonBid.bid_total_cost || null,
      estimated_tons: wonBid.estimated_tons || null,
      address: wonBid.street,
      city: wonBid.city || wonBid.job_city,
      state: wonBid.state || wonBid.job_state,
      bid_date: wonBid.bid_due_date || null,
      estimator_id: wonBid.estimator_id,
      notes: `Auto-created from won bid ${wonBid.bid_number}.`,
      is_archived: false,
      is_pinned: false,
    });

    await Promise.all([
      ...documents.map(({ id: _id, created_date: _cd, updated_date: _ud, ...doc }) =>
        db.entities.Document.create({ ...doc, project_id: project.id, bid_id: wonBid.id })),
      ...takeoffLines.map(({ id: _id, created_date: _cd, updated_date: _ud, ...line }) =>
        db.entities.TakeoffLine.create({ ...line, bid_id: wonBid.id, project_id: project.id })),
    ]);

    await db.entities.Bid.update(wonBid.id, { won_project_id: project.id, project_id: project.id });

    return project;
  };

  const updateBidStatus = async (status) => {
    try {
      const updated = await db.entities.Bid.update(id, { status });
      if (status === 'lost') {
        setShowLossForm(true);
      } else if (status === 'won') {
        if (!updated?.won_project_id && !bid?.won_project_id) {
          try {
            const project = await createProjectFromWonBid({ ...bid, ...updated, id });
            toast({ title: 'Bid marked as won', description: `Project ${project.project_number} created.` });
          } catch (projectError) {
            toast({ title: 'Bid marked as won', description: 'Project auto-creation failed — create it manually.', variant: 'destructive' });
          }
        } else {
          toast({ title: 'Bid marked as won' });
        }
      } else {
        toast({ title: `Bid marked as ${status}` });
      }
      loadBid();
    } catch (e) { toast({ title: 'Update failed', variant: 'destructive' }); }
  };

  const submitLossReason = async () => {
    if (!lossForm.reason) { toast({ title: 'Select a loss reason', variant: 'destructive' }); return; }
    setSavingLoss(true);
    try {
      await db.entities.Bid.update(id, {
        loss_reason: lossForm.reason,
        loss_reason_notes: lossForm.notes,
        competitor_name: lossForm.competitor,
        status: 'lost',
      });
      toast({ title: 'Loss reason logged' });
      setShowLossForm(false);
      loadBid();
    } catch (e) { toast({ title: 'Failed', variant: 'destructive' }); } finally { setSavingLoss(false); }
  };

  const handleBaseInfoSave = async () => {
    setSavingBaseInfo(true);
    try {
      const computedTaxRate = computeEffectiveTaxRate({
        state: baseInfo.state,
        tax_enabled: baseInfo.tax_enabled,
        tax_rate: baseInfo.tax_rate || bid?.tax_rate,
      });
      await db.entities.Bid.update(id, {
        street: baseInfo.street,
        city: baseInfo.city,
        state: baseInfo.state,
        zip: baseInfo.zip,
        tax_enabled: baseInfo.tax_enabled,
        tax_rate: computedTaxRate,
        joist_deck_tax_rate: Number(baseInfo.joist_deck_tax_rate ?? HANCOCK_COUNTY_TAX_RATE),
        job_city: baseInfo.city,
        job_state: baseInfo.state,
        local_server_path: baseInfo.local_server_path,
      });
      toast({ title: 'Bid information saved' });
      setBaseInfoDirty(false);
      loadBid();
    } catch (e) {
      toast({ title: 'Unable to save bid information', description: e?.message || 'Please retry.', variant: 'destructive' });
    } finally {
      setSavingBaseInfo(false);
    }
  };

  const isEstimateDirty = () => baseInfoDirty || !!takeoffRef.current?.isDirty?.() || !!materialRef.current?.isDirty?.();

  const handleSaveEstimate = async () => {
    // Capture the refs before any save runs — handleBaseInfoSave's loadBid() sets
    // loading=true, which briefly unmounts the tab content and nulls out .current.
    const takeoff = takeoffRef.current;
    const material = materialRef.current;
    setSavingEstimate(true);
    try {
      await handleBaseInfoSave();
      await takeoff?.save?.();
      await material?.save?.();
      toast({ title: 'Estimate saved', description: 'Base Info, Worksheet, and Material Takeoff were all saved.' });
    } finally {
      setSavingEstimate(false);
    }
  };

  const handleBackClick = () => {
    if (isEstimateDirty()) {
      const shouldSave = window.confirm('You have unsaved changes. Do you want to save before closing?');
      if (shouldSave) {
        handleSaveEstimate().then(() => navigate('/estimating'));
      }
      return;
    }
    navigate('/estimating');
  };

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (isEstimateDirty()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [baseInfoDirty]);

  // Native browser back/forward arrows fire popstate after the URL has already
  // changed — unlike beforeunload, this can't preventDefault the navigation. Best
  // effort: if dirty, prompt; on cancel, navigate forward again to undo the back-nav.
  useEffect(() => {
    const handlePopState = () => {
      if (isEstimateDirty()) {
        const shouldSave = window.confirm('You have unsaved changes. Do you want to save before closing?');
        if (shouldSave) {
          handleSaveEstimate();
        } else {
          navigate(1);
        }
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [baseInfoDirty]);

  const effectiveTaxRate = computeEffectiveTaxRate({
    state: baseInfo.state,
    tax_enabled: baseInfo.tax_enabled,
    tax_rate: baseInfo.tax_rate || bid?.tax_rate,
  });

  if (loading) return <div className="p-6"><div className="h-96 bg-muted rounded-xl animate-pulse" /></div>;
  if (!bid) return <div className="p-6 text-center text-muted-foreground">Bid not found.</div>;

  return (
    <>
    <div className="p-6 pb-24 animate-fade-in print:hidden">
      <Button variant="ghost" size="sm" onClick={handleBackClick} className="mb-4">
        <ArrowLeft className="w-4 h-4 mr-1" />Back to Estimating
      </Button>

      <PageHeader
        title={bid.job_name}
        subtitle={`${bid.bid_number} · ${bid.customer_name} · ${bid.general_contractor_name || 'GC TBD'}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={bid.status} />
            <Button size="sm" onClick={handleSaveEstimate} disabled={savingEstimate} className="steel-gradient text-white border-0">
              {savingEstimate ? 'Saving…' : 'Save Estimate'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => window.print()}>
              <Printer className="w-3.5 h-3.5 mr-1" />Export Proposal PDF
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate(`/estimating/blueprint-takeoff/${bid.id}`)}>
              <ScanLine className="w-3.5 h-3.5 mr-1" />Blueprint Takeoff
            </Button>
            {bid.status !== 'won' && bid.status !== 'lost' && bid.status !== 'cancelled' && bid.status !== 'Did_Not_Bid' && (
              <>
                <Button size="sm" variant="outline" className="text-green-600 border-green-500/30 hover:bg-green-500/10" onClick={() => updateBidStatus('won')}>
                  <Award className="w-3.5 h-3.5 mr-1" />Mark Won
                </Button>
                <Button size="sm" variant="outline" className="text-red-600 border-red-500/30 hover:bg-red-500/10" onClick={() => updateBidStatus('lost')}>
                  <TrendingDown className="w-3.5 h-3.5 mr-1" />Mark Lost
                </Button>
                <Button size="sm" variant="outline" className="text-orange-600 border-orange-500/30 hover:bg-orange-500/10" onClick={() => setShowDnbModal(true)}>
                  <AlertTriangle className="w-3.5 h-3.5 mr-1" />Did Not Bid
                </Button>
              </>
            )}
          </div>
        }
      />

      {/* Bid Summary Bar */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        {[
          { label: 'Bid Total', value: bid.bid_total_cost ? `$${bid.bid_total_cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—' },
          { label: 'Est. Tons', value: bid.estimated_tons?.toLocaleString() || '—' },
          { label: 'Est. Man-Hrs', value: bid.estimated_man_hours?.toLocaleString() || '—' },
          { label: 'Tax Rate', value: `${(effectiveTaxRate * 100).toFixed(2)}%` },
          { label: 'Due Date', value: bid.bid_due_date || '—' },
        ].map(({ label, value }) => (
          <div key={label} className="steel-card p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-lg font-bold mt-0.5">{value}</p>
          </div>
        ))}
      </div>

      <div className="steel-card p-5 mb-6">
        <div>
          <h3 className="font-semibold">Base Information</h3>
          <p className="text-sm text-muted-foreground">Project address and tax configuration</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div>
            <Label>Street</Label>
            <Input value={baseInfo.street} onChange={(e) => updateBaseInfo('street', e.target.value)} className="mt-1" placeholder="123 Main St" />
          </div>
          <div>
            <Label>City</Label>
            <Input value={baseInfo.city} onChange={(e) => updateBaseInfo('city', e.target.value)} className="mt-1" placeholder="Findlay" />
          </div>
          <div>
            <Label>State</Label>
            <Input value={baseInfo.state} onChange={(e) => updateBaseInfo('state', e.target.value)} className="mt-1" placeholder="OH" />
          </div>
          <div>
            <Label>ZIP</Label>
            <Input value={baseInfo.zip} onChange={(e) => updateBaseInfo('zip', e.target.value)} className="mt-1" placeholder="45840" />
          </div>
          <div className="md:col-span-2 flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Tax Enabled</p>
              <p className="text-xs text-muted-foreground">Enable dynamic tax logic for this bid</p>
            </div>
            <Switch checked={baseInfo.tax_enabled} onCheckedChange={(checked) => updateBaseInfo('tax_enabled', checked)} />
          </div>
          {baseInfo.tax_enabled && (
            <div className="md:col-span-2">
              <Label>Tax Rate (%)</Label>
              <div className="relative mt-1">
                <Input type="text" inputMode="decimal" pattern="^\d{1,2}\.\d{2}$" value={taxRateText} onChange={handleTaxRateTextChange} onBlur={handleTaxRateTextBlur} placeholder="6.75" className="pr-7" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Ohio jobs default to 6.75% (Hancock County) when tax is enabled.</p>
            </div>
          )}
          <div className="md:col-span-2">
            <Label>Joist and Deck Tax Rate (%)</Label>
            <div className="relative mt-1">
              <Input type="text" inputMode="decimal" pattern="^\d{1,2}\.\d{2}$" value={joistDeckTaxRateText} onChange={handleJoistDeckTaxRateTextChange} onBlur={handleJoistDeckTaxRateTextBlur} placeholder="6.75" className="pr-7" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Independent tax rate applied only to Joist &amp; Deck line items, routed by physical job site location. Enter as a percentage (e.g. 7.75 for 7.75%).</p>
          </div>
          <div className="md:col-span-2">
            <Label>Local Server Network Path</Label>
            <div className="flex items-center gap-2 mt-1">
              <Input
                value={baseInfo.local_server_path}
                onChange={(e) => updateBaseInfo('local_server_path', e.target.value)}
                placeholder="//Server/Estimating/Job123"
                className="flex-1"
              />
              <Button type="button" variant="outline" onClick={() => openLocalServerPath(baseInfo.local_server_path)} disabled={!baseInfo.local_server_path}>
                <FolderOpen className="w-4 h-4 mr-1.5" />OPEN LOCAL SERVER DIRECTORY
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Best-effort local-network launch — most browsers sandbox file:// links, so this may not open Explorer on every machine.</p>
          </div>
        </div>
      </div>

      {/* Loss Reason Form */}
      {showLossForm && (
        <div className="steel-card p-5 mb-6 border-red-500/20">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-red-500" />Log Loss Reason (Required)</h3>
          <div className="space-y-3">
            <div>
              <Label>Loss Reason <span className="text-red-500">*</span></Label>
              <Select value={lossForm.reason} onValueChange={v => setLossForm(f => ({ ...f, reason: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select a reason" /></SelectTrigger>
                <SelectContent>
                  {LOSS_REASONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Competitor Name (if known)</Label>
              <Input value={lossForm.competitor} onChange={e => setLossForm(f => ({ ...f, competitor: e.target.value }))} className="mt-1" placeholder="e.g. Competitor Steel Co." />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={lossForm.notes} onChange={e => setLossForm(f => ({ ...f, notes: e.target.value }))} className="mt-1" rows={2} placeholder="Additional context on why this bid was lost…" />
            </div>
            <Button onClick={submitLossReason} disabled={savingLoss} className="bg-red-600 hover:bg-red-700 text-white border-0">
              {savingLoss ? 'Saving…' : 'Submit Loss Reason'}
            </Button>
          </div>
        </div>
      )}

      <DNBReasonModal
        open={showDnbModal}
        onOpenChange={setShowDnbModal}
        bidId={id}
        bidLabel={bid.job_name}
        onSaved={() => loadBid()}
      />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="files"><Upload className="w-4 h-4 mr-1.5" />Smart File Dump</TabsTrigger>
          <TabsTrigger value="takeoff"><Calculator className="w-4 h-4 mr-1.5" />BID Worksheet</TabsTrigger>
          <TabsTrigger value="fulltakeoff"><BarChart3 className="w-4 h-4 mr-1.5" />Full Takeoff</TabsTrigger>
          <TabsTrigger value="vendor"><Link2 className="w-4 h-4 mr-1.5" />Vendor Pricing</TabsTrigger>
          <TabsTrigger value="mill"><Factory className="w-4 h-4 mr-1.5" />Mill Pricing</TabsTrigger>
          <TabsTrigger value="inclusions"><FileText className="w-4 h-4 mr-1.5" />Scope Text</TabsTrigger>
          <TabsTrigger value="ai"><Brain className="w-4 h-4 mr-1.5" />AI Review</TabsTrigger>
          <TabsTrigger value="contract-review"><ScanSearch className="w-4 h-4 mr-1.5" />AI Contract Review</TabsTrigger>
        </TabsList>

        <TabsContent value="files">
          <SmartFileDump bidId={bid.id} bid={bid} onParseComplete={() => loadBid()} />
        </TabsContent>

        <TabsContent value="takeoff">
          <TakeoffEngine ref={takeoffRef} bid={bid} onSaved={() => loadBid()} />
        </TabsContent>

        <TabsContent value="fulltakeoff">
          <FullTakeoff ref={materialRef} bid={bid} onSaved={() => loadBid()} />
        </TabsContent>

        <TabsContent value="vendor">
          <VendorPricing bidId={bid.id} />
        </TabsContent>

        <TabsContent value="mill">
          <MillPricingTable bid={bid} />
        </TabsContent>

        <TabsContent value="inclusions">
          <ScopeText bid={bid} onSaved={() => loadBid()} />
        </TabsContent>

        <TabsContent value="ai">
          <AIReviewPanel bid={bid} />
        </TabsContent>

        <TabsContent value="contract-review">
          <AIContractReviewPanel bid={bid} />
        </TabsContent>
      </Tabs>

      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur px-6 py-3 flex justify-end">
        <Button onClick={handleSaveEstimate} disabled={savingEstimate} className="steel-gradient text-white border-0 min-w-40">
          {savingEstimate ? 'Saving…' : 'Save Estimate'}
        </Button>
      </div>
    </div>

    <div className="hidden print:block">
      <BidProposalPrintView bid={bid} />
    </div>
    </>
  );
}

function ScopeText({ bid, onSaved }) {
  const { toast } = useToast();
  const [inclusions, setInclusions] = useState(bid.inclusions || '');
  const [exclusions, setExclusions] = useState(bid.exclusions || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setInclusions(bid.inclusions || '');
    setExclusions(bid.exclusions || '');
  }, [bid.id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await db.entities.Bid.update(bid.id, { inclusions, exclusions });
      toast({ title: 'Scope text saved!' });
      onSaved();
    } catch (e) { toast({ title: 'Save failed', variant: 'destructive' }); } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="steel-card p-5">
          <Label className="font-semibold">Inclusions</Label>
          <Textarea value={inclusions} onChange={e => setInclusions(e.target.value)} className="mt-2 min-h-[200px]" placeholder="List items included in this bid scope…" />
        </div>
        <div className="steel-card p-5">
          <Label className="font-semibold">Exclusions</Label>
          <Textarea value={exclusions} onChange={e => setExclusions(e.target.value)} className="mt-2 min-h-[200px]" placeholder="List items excluded from this bid scope…" />
        </div>
      </div>
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} className="steel-gradient text-white border-0">Save Scope Text</Button>
      </div>
    </div>
  );
}

function AIReviewPanel({ bid }) {
  const { toast } = useToast();
  const [skills, setSkills] = useState([]);
  const [selectedSkillId, setSelectedSkillId] = useState('');
  const [files, setFiles] = useState([]);
  const [reports, setReports] = useState([]);
  const [running, setRunning] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => { loadData(); }, [bid.id]);

  const loadData = async () => {
    try {
      const [skillList, reportList] = await Promise.all([
        db.entities.AIReviewSkill.filter({ is_active: true }, '-created_date', 50),
        db.entities.BidReviewReport.filter({ bid_id: bid.id }, '-created_date', 50),
      ]);
      setSkills(skillList);
      setReports(reportList);
      if (!selectedSkillId && skillList.length > 0) setSelectedSkillId(skillList[0].id);
    } catch (e) {}
  };

  const handleRunReview = async () => {
    const skill = skills.find(s => s.id === selectedSkillId);
    if (!skill) { toast({ title: 'Select a skill first', variant: 'destructive' }); return; }
    setRunning(true);
    try {
      await runBidReviewSkill(bid, skill, files);
      toast({ title: 'Review complete', description: skill.name });
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
      loadData();
    } catch (e) {
      toast({ title: 'Review failed', variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="steel-card p-5">
        <h3 className="font-semibold mb-1 flex items-center gap-2"><Brain className="w-4 h-4 text-primary" />Run an AI Review Skill</h3>
        <p className="text-xs text-muted-foreground mb-3">No real Claude call is wired up in this environment — this runs the same local placeholder analysis used elsewhere in the app, but persists a real report tied to this bid.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Skill</Label>
            <Select value={selectedSkillId} onValueChange={setSelectedSkillId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select a skill" /></SelectTrigger>
              <SelectContent>
                {skills.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {skills.find(s => s.id === selectedSkillId)?.description && (
              <p className="text-xs text-muted-foreground mt-1">{skills.find(s => s.id === selectedSkillId)?.description}</p>
            )}
          </div>
          <div>
            <Label className="text-xs">Attachments (PDF/Specs, optional)</Label>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
              className="mt-1 block w-full text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground file:text-xs"
            />
            {files.length > 0 && <p className="text-xs text-muted-foreground mt-1">{files.length} file(s) selected</p>}
          </div>
        </div>
        <div className="flex justify-end mt-3">
          <Button onClick={handleRunReview} disabled={running || !selectedSkillId} className="steel-gradient text-white border-0">
            {running ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Running…</> : <><Brain className="w-4 h-4 mr-2" />Run Review</>}
          </Button>
        </div>
      </div>

      <div className="steel-card overflow-hidden">
        <div className="p-4 border-b border-border">
          <h3 className="font-semibold">Review Reports for this Bid</h3>
        </div>
        {reports.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">No AI review reports yet.</p>
        ) : (
          <div className="divide-y divide-border">
            {reports.map(r => (
              <div key={r.id} className="p-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="font-medium text-sm">{r.skill_name}</p>
                  <StatusBadge status={r.status} />
                </div>
                {r.summary && <p className="text-xs text-muted-foreground mb-1">{r.summary}</p>}
                {r.report_content && <p className="text-xs whitespace-pre-wrap">{r.report_content}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}