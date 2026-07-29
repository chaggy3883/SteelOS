import React, { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import PageHeader from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/use-toast';
import { Plus, Truck, ClipboardCheck, FileText, DollarSign, CheckCircle2, AlertTriangle } from 'lucide-react';
import { generateQrPayload } from '@/lib/qrSerialization';

const AUTO_APPROVE_THRESHOLD = 5000;

const materialCategories = ['Structural Shapes', 'Plate', 'HSS', 'Joist/Deck', 'Fasteners', 'Consumables'];
const paymentTerms = ['Net 30', 'Net 60', 'Prox 25'];
const urgencyLevels = ['Low', 'Medium', 'Critical'];

export default function ProcurementModule() {
  const { toast } = useToast();
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [requisitions, setRequisitions] = useState([]);
  const [receivingLogs, setReceivingLogs] = useState([]);
  const [payables, setPayables] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [poForm, setPoForm] = useState({ po_number: '', vendor_id: '', material_category: 'Structural Shapes', budgeted_cost: '', actual_cost: '', payment_terms: 'Net 30' });
  const [reqForm, setReqForm] = useState({ job_number: '', item_description: '', required_on_site_date: '', urgency: 'Medium', requisition_total: '' });
  const [receivingForm, setReceivingForm] = useState({ po_number: '', quantity_ordered: '', quantity_received: '', material_heat_number: '', delivery_status: 'Received Complete', verified: false });
  const [receivingFiles, setReceivingFiles] = useState([]);
  const [invoiceForm, setInvoiceForm] = useState({ invoice_number: '', po_id: '', invoice_amount: '', quantity_received: '', expected_cost: '', expected_quantity: '' });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [poList, reqList, recvList, invoiceList, vendorList] = await Promise.all([
        base44.entities.purchase_orders.list('-created_date', 100),
        base44.entities.purchase_requisitions.list('-created_date', 100),
        base44.entities.receiving_logs.list('-created_date', 100),
        base44.entities.payable_invoices.list('-created_date', 100),
        base44.entities.Vendor.filter({ is_active: true }, '-created_date', 100),
      ]);
      setPurchaseOrders(poList);
      setRequisitions(reqList);
      setReceivingLogs(recvList);
      setPayables(invoiceList);
      setVendors(vendorList);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const createPurchaseOrder = async (event) => {
    event.preventDefault();
    const selectedVendor = vendors.find((vendor) => vendor.id === poForm.vendor_id) || vendors[0];
    const created = await base44.entities.purchase_orders.create({
      po_number: poForm.po_number || `PO-${String(purchaseOrders.length + 1001)}`,
      vendor_id: selectedVendor?.id || '',
      vendor_name: selectedVendor?.name || '',
      material_category: poForm.material_category,
      budgeted_cost: Number(poForm.budgeted_cost || 0),
      actual_cost: Number(poForm.actual_cost || 0),
      variance: Number(poForm.budgeted_cost || 0) - Number(poForm.actual_cost || 0),
      quantity_ordered: Number(poForm.quantity_ordered || 0),
      payment_terms: poForm.payment_terms,
      status: 'Open'
    });
    setPurchaseOrders([created, ...purchaseOrders]);
    setPoForm({ po_number: '', vendor_id: '', material_category: 'Structural Shapes', budgeted_cost: '', actual_cost: '', payment_terms: 'Net 30' });
    toast({ title: 'Purchase order created' });
  };

  const createRequisition = async (event) => {
    event.preventDefault();
    const total = Number(reqForm.requisition_total || 0);
    const requiresSignature = total > AUTO_APPROVE_THRESHOLD;
    const created = await base44.entities.purchase_requisitions.create({
      job_number: reqForm.job_number,
      item_description: reqForm.item_description,
      required_on_site_date: reqForm.required_on_site_date,
      urgency: reqForm.urgency,
      requisition_total: total,
      status: requiresSignature ? 'Exec_Review' : 'Auto_Approved',
      requires_signature: requiresSignature,
    });
    setRequisitions([created, ...requisitions]);
    setReqForm({ job_number: '', item_description: '', required_on_site_date: '', urgency: 'Medium', requisition_total: '' });
    toast({ title: requiresSignature ? 'Requisition routed for approval' : 'Requisition approved' });
  };

  const createReceivingLog = async (event) => {
    event.preventDefault();
    const matchingPo = purchaseOrders.find((po) => po.po_number === receivingForm.po_number) || purchaseOrders[0];

    let attachmentPath = '';
    for (const file of receivingFiles) {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      if (!attachmentPath) attachmentPath = file_url;
    }

    const created = await base44.entities.receiving_logs.create({
      po_id: matchingPo?.id || '',
      po_number: matchingPo?.po_number || receivingForm.po_number,
      quantity_ordered: Number(receivingForm.quantity_ordered || 0),
      quantity_received: Number(receivingForm.quantity_received || 0),
      delivery_status: receivingForm.delivery_status,
      packing_list: receivingForm.po_number,
      material_heat_number: receivingForm.material_heat_number,
      attachment_path: attachmentPath || '/uploads/receiving.jpg',
      verified: !!receivingForm.verified,
    });
    setReceivingLogs([created, ...receivingLogs]);

    // Serialization: write a QR routing payload to the flat project documents registry
    const qrPayload = generateQrPayload(created);
    await base44.entities.Document.create({
      project_id: matchingPo?.project_id || '',
      name: `Receiving QR — ${created.po_number} / ${created.material_heat_number || 'no heat'}`,
      document_type: 'other',
      description: 'Auto-generated QR routing payload for received material.',
      qr_payload: qrPayload,
      virtual_path: '/receiving-qr/',
    });

    setReceivingFiles([]);
    setReceivingForm({ po_number: '', quantity_ordered: '', quantity_received: '', material_heat_number: '', delivery_status: 'Received Complete', verified: false });
    toast({ title: 'Receiving log updated', description: `QR payload: ${qrPayload}` });
  };

  const createInvoice = async (event) => {
    event.preventDefault();
    const selectedPo = purchaseOrders.find((po) => po.id === invoiceForm.po_id) || purchaseOrders[0];
    const expectedCost = Number(invoiceForm.expected_cost || 0);
    const expectedQty = Number(invoiceForm.expected_quantity || 0);
    const invoiceAmount = Number(invoiceForm.invoice_amount || 0);
    const quantityReceived = Number(invoiceForm.quantity_received || 0);
    const costVariance = Math.abs(invoiceAmount - expectedCost) / Math.max(expectedCost, 1);
    const quantityVariance = Math.abs(quantityReceived - expectedQty) / Math.max(expectedQty, 1);
    const status = costVariance <= 0.01 && quantityVariance <= 0.01 ? 'Approved for Payment' : 'Pending Purchasing Agent Review';
    const created = await base44.entities.payable_invoices.create({
      po_id: selectedPo?.id || '',
      invoice_number: invoiceForm.invoice_number,
      invoice_amount: invoiceAmount,
      quantity_received: quantityReceived,
      expected_cost: expectedCost,
      expected_quantity: expectedQty,
      status,
      match_result: status === 'Approved for Payment' ? 'Matched within 1%' : 'Variance exceeds threshold',
    });
    setPayables([created, ...payables]);
    setInvoiceForm({ invoice_number: '', po_id: '', invoice_amount: '', quantity_received: '', expected_cost: '', expected_quantity: '' });
    toast({ title: status === 'Approved for Payment' ? 'Invoice approved' : 'Invoice routed for review' });
  };

  const stats = useMemo(() => {
    const budgeted = purchaseOrders.reduce((sum, item) => sum + Number(item.budgeted_cost || 0), 0);
    const actual = purchaseOrders.reduce((sum, item) => sum + Number(item.actual_cost || 0), 0);
    const pendingApprovals = requisitions.filter((item) => item.requires_signature).length;
    const partials = receivingLogs.filter((item) => item.delivery_status === 'Partial Delivery').length;
    return { budgeted, actual, variance: budgeted - actual, pendingApprovals, partials };
  }, [purchaseOrders, requisitions, receivingLogs]);

  return (
    <div className="p-6 animate-fade-in space-y-6">
      <PageHeader title="Purchasing & Procurement" subtitle="Mill buyouts, requisitions, receiving, and payable reconciliation" />
      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: 'Buyout Budget', value: `$${stats.budgeted.toLocaleString()}`, icon: DollarSign },
          { label: 'Actual Buyout', value: `$${stats.actual.toLocaleString()}`, icon: ClipboardCheck },
          { label: 'Variance', value: `$${stats.variance.toLocaleString()}`, icon: AlertTriangle },
          { label: 'Pending Approvals', value: stats.pendingApprovals, icon: FileText },
        ].map((item) => (
          <div key={item.label} className="steel-card p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <item.icon className="w-4 h-4" />
              {item.label}
            </div>
            <p className="mt-2 text-xl font-semibold">{item.value}</p>
          </div>
        ))}
      </div>

      <Tabs defaultValue="buyouts">
        <TabsList className="mb-4">
          <TabsTrigger value="buyouts">Mill Buyout Dashboard</TabsTrigger>
          <TabsTrigger value="requisitions">Project Requisitions</TabsTrigger>
          <TabsTrigger value="receiving">Receiving Portal</TabsTrigger>
          <TabsTrigger value="invoices">Three-Way Match</TabsTrigger>
        </TabsList>

        <TabsContent value="buyouts" className="space-y-4">
          <form onSubmit={createPurchaseOrder} className="steel-card p-4 space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <Label>PO Number</Label>
                <Input value={poForm.po_number} onChange={(event) => setPoForm({ ...poForm, po_number: event.target.value })} placeholder="PO-1001" />
              </div>
              <div>
                <Label>Vendor / Mill</Label>
                <select className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={poForm.vendor_id} onChange={(event) => setPoForm({ ...poForm, vendor_id: event.target.value })}>
                  {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
                </select>
              </div>
              <div>
                <Label>Material Category</Label>
                <select className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={poForm.material_category} onChange={(event) => setPoForm({ ...poForm, material_category: event.target.value })}>
                  {materialCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </div>
              <div>
                <Label>Payment Terms</Label>
                <select className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={poForm.payment_terms} onChange={(event) => setPoForm({ ...poForm, payment_terms: event.target.value })}>
                  {paymentTerms.map((term) => <option key={term} value={term}>{term}</option>)}
                </select>
              </div>
              <div>
                <Label>Total Budgeted Cost</Label>
                <Input type="number" value={poForm.budgeted_cost} onChange={(event) => setPoForm({ ...poForm, budgeted_cost: event.target.value })} placeholder="240000" />
              </div>
              <div>
                <Label>Actual Buyout Cost</Label>
                <Input type="number" value={poForm.actual_cost} onChange={(event) => setPoForm({ ...poForm, actual_cost: event.target.value })} placeholder="228000" />
              </div>
              <div>
                <Label>Quantity Ordered</Label>
                <Input type="number" value={poForm.quantity_ordered} onChange={(event) => setPoForm({ ...poForm, quantity_ordered: event.target.value })} placeholder="140" />
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="submit" className="steel-gradient text-white border-0"><Plus className="mr-2 h-4 w-4" />Create Buyout</Button>
            </div>
          </form>

          <div className="steel-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-3 px-4 text-left">PO</th>
                    <th className="py-3 px-4 text-left">Vendor</th>
                    <th className="py-3 px-4 text-left">Category</th>
                    <th className="py-3 px-4 text-right">Budgeted</th>
                    <th className="py-3 px-4 text-right">Actual</th>
                    <th className="py-3 px-4 text-right">Variance</th>
                    <th className="py-3 px-4 text-left">Terms</th>
                  </tr>
                </thead>
                <tbody>
                  {purchaseOrders.map((order) => (
                    <tr key={order.id} className="border-b border-border/50">
                      <td className="py-3 px-4 font-medium">{order.po_number}</td>
                      <td className="py-3 px-4">{order.vendor_name}</td>
                      <td className="py-3 px-4">{order.material_category}</td>
                      <td className="py-3 px-4 text-right">${Number(order.budgeted_cost || 0).toLocaleString()}</td>
                      <td className="py-3 px-4 text-right">${Number(order.actual_cost || 0).toLocaleString()}</td>
                      <td className="py-3 px-4 text-right">${Number(order.variance || 0).toLocaleString()}</td>
                      <td className="py-3 px-4">{order.payment_terms}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="requisitions" className="space-y-4">
          <form onSubmit={createRequisition} className="steel-card p-4 space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <Label>Job Number</Label>
                <Input value={reqForm.job_number} onChange={(event) => setReqForm({ ...reqForm, job_number: event.target.value })} placeholder="JOB-26-008" />
              </div>
              <div>
                <Label>Item Description</Label>
                <Input value={reqForm.item_description} onChange={(event) => setReqForm({ ...reqForm, item_description: event.target.value })} placeholder="Field materials" />
              </div>
              <div>
                <Label>Required On-Site Date</Label>
                <Input type="date" value={reqForm.required_on_site_date} onChange={(event) => setReqForm({ ...reqForm, required_on_site_date: event.target.value })} />
              </div>
              <div>
                <Label>Urgency</Label>
                <select className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={reqForm.urgency} onChange={(event) => setReqForm({ ...reqForm, urgency: event.target.value })}>
                  {urgencyLevels.map((level) => <option key={level} value={level}>{level}</option>)}
                </select>
              </div>
              <div>
                <Label>Requisition Total</Label>
                <Input type="number" value={reqForm.requisition_total} onChange={(event) => setReqForm({ ...reqForm, requisition_total: event.target.value })} placeholder="7800" />
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="submit" className="steel-gradient text-white border-0">Submit Requisition</Button>
            </div>
          </form>

          <div className="space-y-3">
            {requisitions.map((item) => (
              <div key={item.id} className="steel-card p-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-medium">{item.item_description}</p>
                  <p className="text-sm text-muted-foreground">{item.job_number} • Required {item.required_on_site_date || 'ASAP'} • {item.urgency}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">${Number(item.requisition_total || 0).toLocaleString()}</span>
                  <span className={`rounded-full px-2.5 py-1 text-xs ${item.status === 'Exec_Review' ? 'bg-orange-500/10 text-orange-600' : 'bg-green-500/10 text-green-600'}`}>{item.status?.replace(/_/g, ' ')}</span>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="receiving" className="space-y-4">
          <form onSubmit={createReceivingLog} className="steel-card p-4 space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <Label>PO Number</Label>
                <Input value={receivingForm.po_number} onChange={(event) => setReceivingForm({ ...receivingForm, po_number: event.target.value })} placeholder="PO-1001" />
              </div>
              <div>
                <Label>Quantity Ordered</Label>
                <Input type="number" value={receivingForm.quantity_ordered} onChange={(event) => setReceivingForm({ ...receivingForm, quantity_ordered: event.target.value })} placeholder="140" />
              </div>
              <div>
                <Label>Quantity Received</Label>
                <Input type="number" value={receivingForm.quantity_received} onChange={(event) => setReceivingForm({ ...receivingForm, quantity_received: event.target.value })} placeholder="92" />
              </div>
              <div>
                <Label>Delivery Status</Label>
                <select className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={receivingForm.delivery_status} onChange={(event) => setReceivingForm({ ...receivingForm, delivery_status: event.target.value })}>
                  <option value="Received Complete">Received Complete</option>
                  <option value="Partial Delivery">Partial Delivery</option>
                </select>
              </div>
              <div>
                <Label>Heat Number</Label>
                <Input value={receivingForm.material_heat_number} onChange={(event) => setReceivingForm({ ...receivingForm, material_heat_number: event.target.value })} placeholder="HT-4412" />
              </div>
            </div>
            <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Attach BOL / MTR documents</p>
              <input
                type="file"
                multiple
                onChange={(event) => setReceivingFiles(Array.from(event.target.files || []))}
                className="mt-2 block w-full text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground file:text-xs"
              />
              {receivingFiles.length > 0 && <p className="mt-1 text-xs">{receivingFiles.length} file(s) selected</p>}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={receivingForm.verified} onCheckedChange={(v) => setReceivingForm({ ...receivingForm, verified: !!v })} />
              Inspected &amp; verified against packing list — required for AP 3-way match auto-approval
            </label>
            <div className="flex justify-end">
              <Button type="submit" className="steel-gradient text-white border-0"><Truck className="mr-2 h-4 w-4" />Log Receiving</Button>
            </div>
          </form>

          <div className="space-y-3">
            {receivingLogs.map((item) => (
              <div key={item.id} className="steel-card p-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-medium">{item.po_number}</p>
                  <p className="text-sm text-muted-foreground">Heat {item.material_heat_number || '—'} • {item.packing_list || 'Packing list pending'}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs">{item.delivery_status}</span>
                  <span className={`rounded-full px-2.5 py-1 text-xs ${item.verified ? 'bg-green-500/10 text-green-600' : 'bg-muted text-muted-foreground'}`}>{item.verified ? 'Verified' : 'Unverified'}</span>
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">{item.quantity_received}/{item.quantity_ordered} received</span>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="invoices" className="space-y-4">
          <form onSubmit={createInvoice} className="steel-card p-4 space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <Label>Invoice Number</Label>
                <Input value={invoiceForm.invoice_number} onChange={(event) => setInvoiceForm({ ...invoiceForm, invoice_number: event.target.value })} placeholder="INV-2201" />
              </div>
              <div>
                <Label>PO</Label>
                <select className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={invoiceForm.po_id} onChange={(event) => setInvoiceForm({ ...invoiceForm, po_id: event.target.value })}>
                  {purchaseOrders.map((order) => <option key={order.id} value={order.id}>{order.po_number}</option>)}
                </select>
              </div>
              <div>
                <Label>Invoice Amount</Label>
                <Input type="number" value={invoiceForm.invoice_amount} onChange={(event) => setInvoiceForm({ ...invoiceForm, invoice_amount: event.target.value })} placeholder="228100" />
              </div>
              <div>
                <Label>Quantity Received</Label>
                <Input type="number" value={invoiceForm.quantity_received} onChange={(event) => setInvoiceForm({ ...invoiceForm, quantity_received: event.target.value })} placeholder="92" />
              </div>
              <div>
                <Label>Expected Cost</Label>
                <Input type="number" value={invoiceForm.expected_cost} onChange={(event) => setInvoiceForm({ ...invoiceForm, expected_cost: event.target.value })} placeholder="228000" />
              </div>
              <div>
                <Label>Expected Quantity</Label>
                <Input type="number" value={invoiceForm.expected_quantity} onChange={(event) => setInvoiceForm({ ...invoiceForm, expected_quantity: event.target.value })} placeholder="140" />
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="submit" className="steel-gradient text-white border-0"><CheckCircle2 className="mr-2 h-4 w-4" />Run Match</Button>
            </div>
          </form>

          <div className="space-y-3">
            {payables.map((item) => (
              <div key={item.id} className="steel-card p-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-medium">{item.invoice_number}</p>
                  <p className="text-sm text-muted-foreground">{item.match_result}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">${Number(item.invoice_amount || 0).toLocaleString()}</span>
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs">{item.status}</span>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
