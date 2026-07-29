import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { getPortalSession } from '@/lib/portalAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { runThreeWayMatch } from '@/lib/threeWayMatch';
import { CheckCircle2, Upload, FileWarning, Truck } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function VendorPanel() {
  const { toast } = useToast();
  const session = getPortalSession();
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [receivingLogs, setReceivingLogs] = useState([]);
  const [vendorBills, setVendorBills] = useState([]);
  const [millTestReports, setMillTestReports] = useState([]);
  const [loading, setLoading] = useState(true);

  const [billPoId, setBillPoId] = useState('');
  const [billInvoiceNumber, setBillInvoiceNumber] = useState('');
  const [billAmount, setBillAmount] = useState('');
  const [billFile, setBillFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [uploadingBill, setUploadingBill] = useState(false);

  const [mtrPoId, setMtrPoId] = useState('');
  const [heatNumber, setHeatNumber] = useState('');
  const [materialGrade, setMaterialGrade] = useState('');
  const [savingMtr, setSavingMtr] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [poData, recvData, billData, mtrData] = await Promise.all([
        base44.entities.purchase_orders.filter({ vendor_id: session?.orgId }, '-created_date', 100),
        base44.entities.receiving_logs.list('-created_date', 200),
        base44.entities.VendorBill.filter({ vendor_id: session?.orgId }, '-created_date', 100),
        base44.entities.MillTestReport.filter({ vendor_id: session?.orgId }, '-created_date', 100),
      ]);
      setPurchaseOrders(poData);
      setReceivingLogs(recvData);
      setVendorBills(billData);
      setMillTestReports(mtrData);
    } catch (e) {} finally { setLoading(false); }
  };

  const hasMtr = (poId) => millTestReports.some((m) => m.po_id === poId);

  const handleAcceptPo = async (po) => {
    try {
      const updated = await base44.entities.purchase_orders.update(po.id, {
        vendor_accepted: true,
        vendor_accepted_date: new Date().toISOString().slice(0, 10),
      });
      setPurchaseOrders((prev) => prev.map((p) => (p.id === po.id ? updated : p)));
      toast({ title: 'PO accepted' });
    } catch (e) {
      toast({ title: 'Unable to accept PO', variant: 'destructive' });
    }
  };

  const handleLogShipment = async (po) => {
    if (!hasMtr(po.id)) return;
    try {
      const updated = await base44.entities.purchase_orders.update(po.id, { status: 'Shipped' });
      setPurchaseOrders((prev) => prev.map((p) => (p.id === po.id ? updated : p)));
      toast({ title: 'Shipment logged' });
    } catch (e) {
      toast({ title: 'Unable to log shipment', variant: 'destructive' });
    }
  };

  const handleBillDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) setBillFile(file);
  };

  const handleSubmitBill = async () => {
    if (!billPoId || !billAmount || !billFile) {
      toast({ title: 'PO, amount, and a bill PDF are required', variant: 'destructive' });
      return;
    }
    setUploadingBill(true);
    try {
      const po = purchaseOrders.find((p) => p.id === billPoId);
      const { file_url } = await base44.integrations.Core.UploadFile({ file: billFile });
      const receivingLog = receivingLogs.find((r) => r.po_id === billPoId || r.po_number === po?.po_number);

      const bill = await base44.entities.VendorBill.create({
        vendor_id: session?.orgId,
        po_id: billPoId,
        project_id: po?.project_id || '',
        invoice_number: billInvoiceNumber.trim(),
        invoice_date: new Date().toISOString().slice(0, 10),
        gross_amount: Number(billAmount) || 0,
        status: 'Pending_Match',
      });

      const matchResult = runThreeWayMatch(bill, po, receivingLog);
      const updatedBill = await base44.entities.VendorBill.update(bill.id, matchResult);

      await base44.entities.Document.create({
        project_id: po?.project_id || '',
        name: billFile.name,
        file_url,
        file_name: billFile.name,
        file_size: billFile.size,
        file_type: billFile.type,
        document_type: 'other',
        status: 'uploaded',
      });

      setVendorBills((prev) => [updatedBill, ...prev]);
      setBillPoId(''); setBillInvoiceNumber(''); setBillAmount(''); setBillFile(null);
      toast({
        title: matchResult.status === 'Approved' ? 'Bill auto-approved' : 'Bill flagged for review',
        description: `3-way match variance: ${matchResult.variance_pct}%`,
      });
    } catch (e) {
      toast({ title: 'Unable to submit bill', variant: 'destructive' });
    } finally {
      setUploadingBill(false);
    }
  };

  const handleSubmitMtr = async () => {
    if (!mtrPoId || !heatNumber.trim()) {
      toast({ title: 'PO and Heat Number are required', variant: 'destructive' });
      return;
    }
    setSavingMtr(true);
    try {
      const po = purchaseOrders.find((p) => p.id === mtrPoId);
      const created = await base44.entities.MillTestReport.create({
        po_id: mtrPoId,
        vendor_id: session?.orgId,
        heat_number: heatNumber.trim(),
        material_grade: materialGrade.trim(),
        submitted_date: new Date().toISOString().slice(0, 10),
      });
      setMillTestReports((prev) => [created, ...prev]);
      setMtrPoId(''); setHeatNumber(''); setMaterialGrade('');
      toast({ title: 'Mill Test Report submitted', description: `Shipment tracking unlocked for ${po?.po_number}.` });
    } catch (e) {
      toast({ title: 'Unable to submit MTR', variant: 'destructive' });
    } finally {
      setSavingMtr(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Vendor Execution Panel</h1>
        <p className="text-sm text-muted-foreground">Procurement workspace for {session?.orgName}.</p>
      </div>

      {/* Purchase Orders */}
      <div className="steel-card overflow-hidden">
        <div className="p-4 border-b border-border"><h3 className="font-semibold">Purchase Orders</h3></div>
        {loading ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : purchaseOrders.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">No purchase orders yet.</p>
        ) : (
          <div className="divide-y divide-border">
            {purchaseOrders.map((po) => (
              <div key={po.id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-sm">{po.po_number} · {po.material_category}</p>
                  <p className="text-xs text-muted-foreground">${Number(po.budgeted_cost || 0).toLocaleString()} · {po.status}</p>
                </div>
                <div className="flex items-center gap-2">
                  {hasMtr(po.id) ? (
                    <Badge variant="secondary"><CheckCircle2 className="w-3 h-3 mr-1" />MTR on file</Badge>
                  ) : (
                    <Badge variant="destructive"><FileWarning className="w-3 h-3 mr-1" />MTR required</Badge>
                  )}
                  {po.vendor_accepted ? (
                    <Badge variant="secondary">Accepted {po.vendor_accepted_date}</Badge>
                  ) : (
                    <Button size="sm" onClick={() => handleAcceptPo(po)}>Accept PO</Button>
                  )}
                  <Button size="sm" variant="outline" disabled={!hasMtr(po.id)} onClick={() => handleLogShipment(po)} title={!hasMtr(po.id) ? 'Submit a Mill Test Report with a Heat Number first' : ''}>
                    <Truck className="w-3.5 h-3.5 mr-1.5" />Log Shipment
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Bill upload -> 3-way match */}
        <div className="steel-card p-5">
          <h3 className="font-semibold mb-3">Submit Bill (routes to Three-Way Match)</h3>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Purchase Order</Label>
              <Select value={billPoId} onValueChange={setBillPoId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select a PO" /></SelectTrigger>
                <SelectContent>
                  {purchaseOrders.map((po) => <SelectItem key={po.id} value={po.id}>{po.po_number}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Invoice Number</Label>
              <Input value={billInvoiceNumber} onChange={(e) => setBillInvoiceNumber(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Gross Amount ($)</Label>
              <Input type="number" value={billAmount} onChange={(e) => setBillAmount(e.target.value)} className="mt-1" />
            </div>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleBillDrop}
              className={cn('border-2 border-dashed rounded-lg p-4 text-center text-xs', dragging ? 'border-primary bg-primary/5' : 'border-border')}
            >
              <Upload className={cn('w-5 h-5 mx-auto mb-1', dragging ? 'text-primary' : 'text-muted-foreground')} />
              {billFile ? billFile.name : 'Drop bill PDF here'}
            </div>
            <Button onClick={handleSubmitBill} disabled={uploadingBill} className="w-full steel-gradient text-white border-0">
              {uploadingBill ? 'Submitting…' : 'Submit Bill'}
            </Button>
          </div>
        </div>

        {/* Mill Test Report */}
        <div className="steel-card p-5">
          <h3 className="font-semibold mb-3">Mill Test Report (MTR)</h3>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Purchase Order</Label>
              <Select value={mtrPoId} onValueChange={setMtrPoId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select a PO" /></SelectTrigger>
                <SelectContent>
                  {purchaseOrders.map((po) => <SelectItem key={po.id} value={po.id}>{po.po_number}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Heat Number <span className="text-red-500">*</span></Label>
              <Input value={heatNumber} onChange={(e) => setHeatNumber(e.target.value)} className="mt-1" placeholder="HT-4412" />
            </div>
            <div>
              <Label className="text-xs">Material Grade</Label>
              <Input value={materialGrade} onChange={(e) => setMaterialGrade(e.target.value)} className="mt-1" placeholder="A992" />
            </div>
            <Button onClick={handleSubmitMtr} disabled={savingMtr} className="w-full steel-gradient text-white border-0">
              {savingMtr ? 'Submitting…' : 'Submit MTR'}
            </Button>
          </div>
        </div>
      </div>

      {/* Vendor Bills log */}
      {vendorBills.length > 0 && (
        <div className="steel-card overflow-hidden">
          <div className="p-4 border-b border-border"><h3 className="font-semibold">Submitted Bills</h3></div>
          <div className="divide-y divide-border">
            {vendorBills.map((b) => (
              <div key={b.id} className="p-4 flex items-center justify-between text-sm">
                <div><p className="font-medium">{b.invoice_number || '—'}</p><p className="text-xs text-muted-foreground">${Number(b.gross_amount || 0).toLocaleString()} · variance {b.variance_pct ?? 0}%</p></div>
                <Badge variant={b.status === 'Approved' ? 'secondary' : 'destructive'}>{b.status?.replace(/_/g, ' ')}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
