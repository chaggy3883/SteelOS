import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import PageHeader from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/use-toast';
import { Plus, Truck, ClipboardCheck, FileText, DollarSign, CheckCircle2, AlertTriangle, ShieldAlert } from 'lucide-react';
import { generateQrPayload } from '@/lib/qrSerialization';
import PurchaseOrderDetailModal from '@/components/purchasing/PurchaseOrderDetailModal';
import { REQUISITION_APPROVAL_ROLES, PURCHASING_ALLOWED_ROLES, INVOICE_APPROVAL_ROLES } from '@/components/dashboard/widgetContent';
import { isAdminUser, getEffectiveCompany, isSuperAdmin, isImpersonating } from '@/lib/tenantContext';
import { hasModule } from '@/lib/moduleEntitlement';
import ModuleLocked from '@/components/shared/ModuleLocked';

// Anyone who can reach this page at all — buys (purchasing_agent), approves
// requisitions (REQUISITION_APPROVAL_ROLES), or runs the AP 3-way match
// (INVOICE_APPROVAL_ROLES, same roles as Accounting.jsx's vendorbills tab).
// admin/super_admin bypass via isAdminUser() instead of being listed here.
const PROCUREMENT_PAGE_ROLES = Array.from(new Set([
  ...PURCHASING_ALLOWED_ROLES, ...REQUISITION_APPROVAL_ROLES, ...INVOICE_APPROVAL_ROLES,
]));

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
  const [detailPoId, setDetailPoId] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [canApproveReq, setCanApproveReq] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [detailReq, setDetailReq] = useState(null);
  const [rejectReq, setRejectReq] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [savingReqAction, setSavingReqAction] = useState(false);
  const [accessChecked, setAccessChecked] = useState(false);
  const [pageAllowed, setPageAllowed] = useState(false);
  const [canBuy, setCanBuy] = useState(false);
  const [canInvoice, setCanInvoice] = useState(false);
  const [moduleAllowed, setModuleAllowed] = useState(false);
  const [checkingModuleAccess, setCheckingModuleAccess] = useState(true);

  useEffect(() => {
    getEffectiveCompany()
      .then((company) => setModuleAllowed(hasModule(company, '/purchasing/module')))
      .catch(() => setModuleAllowed(false))
      .finally(() => setCheckingModuleAccess(false));
  }, []);

  useEffect(() => {
    db.auth.me()
      .then((me) => {
        const roles = me?.roles || [];
        const admin = isAdminUser(me);
        setCurrentUser(me || null);
        setCanApproveReq(admin || roles.some((r) => REQUISITION_APPROVAL_ROLES.includes(r)));
        setCanBuy(admin || roles.some((r) => PURCHASING_ALLOWED_ROLES.includes(r)));
        setCanInvoice(admin || roles.some((r) => PURCHASING_ALLOWED_ROLES.includes(r) || INVOICE_APPROVAL_ROLES.includes(r)));
        setPageAllowed(admin || roles.some((r) => PROCUREMENT_PAGE_ROLES.includes(r)));
      })
      .catch(() => {
        setCanApproveReq(false); setCanBuy(false); setCanInvoice(false); setPageAllowed(false);
      })
      .finally(() => setAccessChecked(true));
  }, []);

  useEffect(() => { if (accessChecked && pageAllowed) loadData(); }, [accessChecked, pageAllowed]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [poList, reqList, recvList, invoiceList, vendorList] = await Promise.all([
        db.entities.purchase_orders.list('-created_date', 100),
        db.entities.purchase_requisitions.list('-created_date', 100),
        db.entities.receiving_logs.list('-created_date', 100),
        db.entities.payable_invoices.list('-created_date', 100),
        db.entities.Vendor.filter({ is_active: true }, '-created_date', 100),
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
    event?.preventDefault?.();
    const selectedVendor = vendors.find((vendor) => vendor.id === poForm.vendor_id) || vendors[0];
    const created = await db.entities.purchase_orders.create({
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
    event?.preventDefault?.();
    const total = Number(reqForm.requisition_total || 0);
    const requiresSignature = total > AUTO_APPROVE_THRESHOLD;
    const created = await db.entities.purchase_requisitions.create({
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

  const handleApproveRequisition = async (item, event) => {
    event.stopPropagation();
    setSavingReqAction(true);
    try {
      const updated = await db.entities.purchase_requisitions.update(item.id, {
        status: 'Auto_Approved',
        approved_by: currentUser?.id || currentUser?.email || '',
        approved_date: new Date().toISOString(),
      });
      setRequisitions((prev) => prev.map((r) => (r.id === item.id ? updated : r)));
      toast({ title: `Requisition ${item.job_number} approved` });
    } finally {
      setSavingReqAction(false);
    }
  };

  const confirmRejectRequisition = async () => {
    if (!rejectReq || rejectReason.trim().length < 5) return;
    setSavingReqAction(true);
    try {
      const updated = await db.entities.purchase_requisitions.update(rejectReq.id, {
        status: 'Rejected',
        rejection_reason: rejectReason.trim(),
      });
      setRequisitions((prev) => prev.map((r) => (r.id === rejectReq.id ? updated : r)));
      toast({ title: `Requisition ${rejectReq.job_number} rejected` });
      setRejectReq(null);
      setRejectReason('');
    } finally {
      setSavingReqAction(false);
    }
  };

  const createReceivingLog = async (event) => {
    event?.preventDefault?.();
    const matchingPo = purchaseOrders.find((po) => po.po_number === receivingForm.po_number) || purchaseOrders[0];

    let attachmentPath = '';
    for (const file of receivingFiles) {
      const { file_url } = await db.integrations.Core.UploadFile({ file });
      if (!attachmentPath) attachmentPath = file_url;
    }

    const created = await db.entities.receiving_logs.create({
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
    await db.entities.Document.create({
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
    event?.preventDefault?.();
    const selectedPo = purchaseOrders.find((po) => po.id === invoiceForm.po_id) || purchaseOrders[0];
    const expectedCost = Number(invoiceForm.expected_cost || 0);
    const expectedQty = Number(invoiceForm.expected_quantity || 0);
    const invoiceAmount = Number(invoiceForm.invoice_amount || 0);
    const quantityReceived = Number(invoiceForm.quantity_received || 0);
    const costVariance = Math.abs(invoiceAmount - expectedCost) / Math.max(expectedCost, 1);
    const quantityVariance = Math.abs(quantityReceived - expectedQty) / Math.max(expectedQty, 1);
    const status = costVariance <= 0.01 && quantityVariance <= 0.01 ? 'Approved for Payment' : 'Pending Purchasing Agent Review';
    const created = await db.entities.payable_invoices.create({
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

  const makeFormKeyDown = (submitHandler) => (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.tagName === 'TEXTAREA' || event.target.tagName === 'BUTTON') return;
    event.preventDefault();
    submitHandler(event);
  };

  const stats = useMemo(() => {
    const budgeted = purchaseOrders.reduce((sum, item) => sum + Number(item.budgeted_cost || 0), 0);
    const actual = purchaseOrders.reduce((sum, item) => sum + Number(item.actual_cost || 0), 0);
    const pendingApprovals = requisitions.filter((item) => item.requires_signature && item.status !== 'Auto_Approved' && item.status !== 'Rejected').length;
    const partials = receivingLogs.filter((item) => item.delivery_status === 'Partial Delivery').length;
    return { budgeted, actual, variance: budgeted - actual, pendingApprovals, partials };
  }, [purchaseOrders, requisitions, receivingLogs]);

  if (!accessChecked || checkingModuleAccess) {
    return <div className="p-6 space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 bg-muted rounded-xl animate-pulse" />)}</div>;
  }

  // Route guard — a direct URL to /purchasing/module can't bypass the nav's
  // module-pack filtering. Strictly earlier/coarser than the role-based
  // check below.
  const isPlatformOperatorView = isSuperAdmin(currentUser) && !isImpersonating();
  if (!(moduleAllowed || isPlatformOperatorView)) {
    return <ModuleLocked modulePath="/purchasing/module" title="Procurement Module Not Included" />;
  }

  if (!pageAllowed) {
    return (
      <div className="p-6">
        <div className="steel-card p-8 text-center max-w-md mx-auto mt-12">
          <ShieldAlert className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <h2 className="font-semibold text-lg mb-1">Access Restricted</h2>
          <p className="text-sm text-muted-foreground">Purchasing &amp; Procurement is only available to Purchasing, Controller, Finance, and executive roles (and admins).</p>
        </div>
      </div>
    );
  }

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
          {!canBuy && (
            <p className="text-sm text-muted-foreground steel-card p-3">You have view-only access to mill buyouts. Creating a buyout requires the Purchasing Agent role.</p>
          )}
          {canBuy && (
          <div onKeyDown={makeFormKeyDown(createPurchaseOrder)} className="steel-card p-4 space-y-4">
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
              <Button type="button" onClick={createPurchaseOrder} className="steel-gradient text-white border-0"><Plus className="mr-2 h-4 w-4" />Create Buyout</Button>
            </div>
          </div>
          )}

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
                    <tr
                      key={order.id}
                      className="border-b border-border/50 cursor-pointer hover:bg-muted/50"
                      onClick={() => { setDetailPoId(order.id); setDetailOpen(true); }}
                    >
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
          {!canBuy && (
            <p className="text-sm text-muted-foreground steel-card p-3">You have view-only access to requisitions here. Submitting a requisition requires the Purchasing Agent role.</p>
          )}
          {canBuy && (
          <div onKeyDown={makeFormKeyDown(createRequisition)} className="steel-card p-4 space-y-4">
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
              <Button type="button" onClick={createRequisition} className="steel-gradient text-white border-0">Submit Requisition</Button>
            </div>
          </div>
          )}

          <div className="space-y-3">
            {requisitions.map((item) => (
              <div
                key={item.id}
                onClick={() => setDetailReq(item)}
                className="steel-card p-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between cursor-pointer hover:bg-muted/50"
              >
                <div>
                  <p className="font-medium">{item.item_description}</p>
                  <p className="text-sm text-muted-foreground">{item.job_number} • Required {item.required_on_site_date || 'ASAP'} • {item.urgency}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">${Number(item.requisition_total || 0).toLocaleString()}</span>
                  <span className={`rounded-full px-2.5 py-1 text-xs ${item.status === 'Exec_Review' || item.status === 'Pending Executive Approval' ? 'bg-orange-500/10 text-orange-600' : item.status === 'Rejected' ? 'bg-red-500/10 text-red-600' : 'bg-green-500/10 text-green-600'}`}>{item.status?.replace(/_/g, ' ')}</span>
                  {canApproveReq && item.requires_signature && item.status !== 'Auto_Approved' && item.status !== 'Rejected' && (
                    <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" variant="outline" onClick={(e) => handleApproveRequisition(item, e)} disabled={savingReqAction}>Approve</Button>
                      <Button size="sm" variant="outline" className="border-red-500/40 text-red-600" onClick={(e) => { e.stopPropagation(); setRejectReq(item); setRejectReason(''); }} disabled={savingReqAction}>Reject</Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="receiving" className="space-y-4">
          {!canBuy && (
            <p className="text-sm text-muted-foreground steel-card p-3">You have view-only access to receiving logs here. Logging a receipt requires the Purchasing Agent role.</p>
          )}
          {canBuy && (
          <div onKeyDown={makeFormKeyDown(createReceivingLog)} className="steel-card p-4 space-y-4">
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
              <Button type="button" onClick={createReceivingLog} className="steel-gradient text-white border-0"><Truck className="mr-2 h-4 w-4" />Log Receiving</Button>
            </div>
          </div>
          )}

          <div className="space-y-3">
            {receivingLogs.map((item) => {
              // Older logs (e.g. created before po_id was tracked) only carry
              // po_number — fall back to matching that against the loaded POs.
              const resolvedPoId = item.po_id || purchaseOrders.find((po) => po.po_number === item.po_number)?.id || null;
              return (
              <div
                key={item.id}
                className={`steel-card p-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between ${resolvedPoId ? 'cursor-pointer hover:bg-muted/50' : ''}`}
                onClick={resolvedPoId ? () => { setDetailPoId(resolvedPoId); setDetailOpen(true); } : undefined}
              >
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
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="invoices" className="space-y-4">
          {!canInvoice && (
            <p className="text-sm text-muted-foreground steel-card p-3">You have view-only access to the 3-way match here. Running a match requires a Purchasing or Finance/AP role.</p>
          )}
          {canInvoice && (
          <div onKeyDown={makeFormKeyDown(createInvoice)} className="steel-card p-4 space-y-4">
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
              <Button type="button" onClick={createInvoice} className="steel-gradient text-white border-0"><CheckCircle2 className="mr-2 h-4 w-4" />Run Match</Button>
            </div>
          </div>
          )}

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

      <PurchaseOrderDetailModal open={detailOpen} onOpenChange={setDetailOpen} poId={detailPoId} showCosts />

      <Dialog open={!!detailReq} onOpenChange={(open) => !open && setDetailReq(null)}>
        <DialogContent>
          {detailReq && (
            <>
              <DialogHeader><DialogTitle>Requisition — {detailReq.job_number}</DialogTitle></DialogHeader>
              <div className="space-y-2 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div><p className="text-xs text-muted-foreground">Job Number</p><p className="font-medium">{detailReq.job_number}</p></div>
                  <div><p className="text-xs text-muted-foreground">Requisition Total</p><p className="font-medium">${Number(detailReq.requisition_total || 0).toLocaleString()}</p></div>
                  <div><p className="text-xs text-muted-foreground">Required On-Site</p><p className="font-medium">{detailReq.required_on_site_date || '—'}</p></div>
                  <div><p className="text-xs text-muted-foreground">Urgency</p><p className="font-medium">{detailReq.urgency || '—'}</p></div>
                  <div><p className="text-xs text-muted-foreground">Status</p><p className="font-medium">{detailReq.status?.replace(/_/g, ' ')}</p></div>
                  <div><p className="text-xs text-muted-foreground">Requires Signature</p><p className="font-medium">{detailReq.requires_signature ? 'Yes' : 'No'}</p></div>
                </div>
                <div><p className="text-xs text-muted-foreground">Item Description</p><p className="font-medium">{detailReq.item_description || '—'}</p></div>
                {detailReq.approved_by && (
                  <div><p className="text-xs text-muted-foreground">Approved By</p><p className="font-medium">{detailReq.approved_by} on {detailReq.approved_date ? new Date(detailReq.approved_date).toLocaleString() : '—'}</p></div>
                )}
                {detailReq.rejection_reason && (
                  <div><p className="text-xs text-muted-foreground">Rejection Reason</p><p className="font-medium">{detailReq.rejection_reason}</p></div>
                )}
              </div>
              <DialogFooter>
                {canApproveReq && detailReq.requires_signature && detailReq.status !== 'Auto_Approved' && detailReq.status !== 'Rejected' && (
                  <>
                    <Button variant="outline" className="border-red-500/40 text-red-600" onClick={() => { setRejectReq(detailReq); setRejectReason(''); setDetailReq(null); }}>Reject</Button>
                    <Button onClick={(e) => handleApproveRequisition(detailReq, e).then(() => setDetailReq(null))} disabled={savingReqAction} className="steel-gradient text-white border-0">Approve</Button>
                  </>
                )}
                <Button variant="outline" onClick={() => setDetailReq(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejectReq} onOpenChange={(open) => { if (!open) { setRejectReq(null); setRejectReason(''); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Requisition — {rejectReq?.job_number}</DialogTitle></DialogHeader>
          <div>
            <Label>Rejection Reason (min 5 characters)</Label>
            <Textarea rows={3} value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} className="mt-1" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectReq(null); setRejectReason(''); }}>Cancel</Button>
            <Button onClick={confirmRejectRequisition} disabled={rejectReason.trim().length < 5 || savingReqAction} className="bg-red-600 hover:bg-red-700 text-white border-0">
              {savingReqAction ? 'Saving…' : 'Confirm Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
