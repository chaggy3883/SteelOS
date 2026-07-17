import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { ArrowLeft, Upload, Calculator, Link2, FileText, Brain, RefreshCw, TrendingUp, TrendingDown, AlertTriangle, Factory, Award, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import SmartFileDump from '@/components/estimating/SmartFileDump';
import TakeoffEngine from '@/components/estimating/TakeoffEngine';
import VendorPricing from '@/components/estimating/VendorPricing';
import MillPricingTable from '@/components/estimating/MillPricingTable';
import { useToast } from '@/components/ui/use-toast';

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
  const [lossForm, setLossForm] = useState({ reason: '', notes: '', competitor: '' });
  const [savingLoss, setSavingLoss] = useState(false);

  useEffect(() => { loadBid(); }, [id]);

  const loadBid = async () => {
    setLoading(true);
    try {
      const data = await base44.entities.Bid.get(id);
      setBid(data);
    } catch (e) {} finally { setLoading(false); }
  };

  const updateBidStatus = async (status) => {
    try {
      await base44.entities.Bid.update(id, { status });
      if (status === 'lost') setShowLossForm(true);
      else toast({ title: `Bid marked as ${status}` });
      loadBid();
    } catch (e) { toast({ title: 'Update failed', variant: 'destructive' }); }
  };

  const submitLossReason = async () => {
    if (!lossForm.reason) { toast({ title: 'Select a loss reason', variant: 'destructive' }); return; }
    setSavingLoss(true);
    try {
      await base44.entities.Bid.update(id, {
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

  if (loading) return <div className="p-6"><div className="h-96 bg-muted rounded-xl animate-pulse" /></div>;
  if (!bid) return <div className="p-6 text-center text-muted-foreground">Bid not found.</div>;

  return (
    <div className="p-6 animate-fade-in">
      <Button variant="ghost" size="sm" onClick={() => navigate('/estimating')} className="mb-4">
        <ArrowLeft className="w-4 h-4 mr-1" />Back to Estimating
      </Button>

      <PageHeader
        title={bid.job_name}
        subtitle={`${bid.bid_number} · ${bid.customer_name} · ${bid.general_contractor_name || 'GC TBD'}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={bid.status} />
            {bid.status !== 'won' && bid.status !== 'lost' && bid.status !== 'cancelled' && (
              <>
                <Button size="sm" variant="outline" className="text-green-600 border-green-500/30 hover:bg-green-500/10" onClick={() => updateBidStatus('won')}>
                  <Award className="w-3.5 h-3.5 mr-1" />Mark Won
                </Button>
                <Button size="sm" variant="outline" className="text-red-600 border-red-500/30 hover:bg-red-500/10" onClick={() => updateBidStatus('lost')}>
                  <TrendingDown className="w-3.5 h-3.5 mr-1" />Mark Lost
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
          { label: 'Tax Rate', value: bid.tax_rate ? `${(bid.tax_rate * 100).toFixed(2)}%` : '—' },
          { label: 'Due Date', value: bid.bid_due_date || '—' },
        ].map(({ label, value }) => (
          <div key={label} className="steel-card p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-lg font-bold mt-0.5">{value}</p>
          </div>
        ))}
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

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="files"><Upload className="w-4 h-4 mr-1.5" />Smart File Dump</TabsTrigger>
          <TabsTrigger value="takeoff"><Calculator className="w-4 h-4 mr-1.5" />Takeoff Engine</TabsTrigger>
          <TabsTrigger value="vendor"><Link2 className="w-4 h-4 mr-1.5" />Vendor Pricing</TabsTrigger>
          <TabsTrigger value="mill"><Factory className="w-4 h-4 mr-1.5" />Mill Pricing</TabsTrigger>
          <TabsTrigger value="inclusions"><FileText className="w-4 h-4 mr-1.5" />Scope Text</TabsTrigger>
        </TabsList>

        <TabsContent value="files">
          <SmartFileDump bidId={bid.id} onParseComplete={() => loadBid()} />
        </TabsContent>

        <TabsContent value="takeoff">
          <TakeoffEngine bid={bid} />
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
      </Tabs>
    </div>
  );
}

function ScopeText({ bid, onSaved }) {
  const { toast } = useToast();
  const [inclusions, setInclusions] = useState(bid.inclusions || '');
  const [exclusions, setExclusions] = useState(bid.exclusions || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await base44.entities.Bid.update(bid.id, { inclusions, exclusions });
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