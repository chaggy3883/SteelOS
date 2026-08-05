import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Truck, PackageCheck, PackageX, Search } from 'lucide-react';
import { generateQrPayload } from '@/lib/qrSerialization';

const emptyForm = () => ({ po_number: '', material_heat_number: '' });

export default function ReceivingKiosk() {
  const { toast } = useToast();
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [recentLogs, setRecentLogs] = useState([]);
  const [form, setForm] = useState(emptyForm());
  const [matchedPo, setMatchedPo] = useState(null);
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [poList, logList] = await Promise.all([
        db.entities.purchase_orders.list('-created_date', 100),
        db.entities.receiving_logs.list('-created_date', 10),
      ]);
      setPurchaseOrders(poList);
      setRecentLogs(logList);
    } catch (e) {}
  };

  const handleLookup = () => {
    const match = purchaseOrders.find(po => po.po_number?.toLowerCase() === form.po_number.trim().toLowerCase());
    setMatchedPo(match || null);
    if (!match) toast({ title: 'No matching PO found', variant: 'destructive' });
  };

  const submitReceiving = async (deliveryStatus) => {
    if (!form.po_number.trim()) {
      toast({ title: 'Enter a PO number first', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      let attachmentPath = '';
      for (const file of files) {
        const { file_url } = await db.integrations.Core.UploadFile({ file });
        if (!attachmentPath) attachmentPath = file_url;
      }

      const created = await db.entities.receiving_logs.create({
        po_id: matchedPo?.id || '',
        po_number: matchedPo?.po_number || form.po_number.trim(),
        quantity_ordered: matchedPo?.quantity_ordered || 0,
        quantity_received: matchedPo?.quantity_ordered || 0,
        delivery_status: deliveryStatus,
        packing_list: form.po_number.trim(),
        material_heat_number: form.material_heat_number.trim(),
        attachment_path: attachmentPath || '/uploads/receiving.jpg',
        verified: true,
      });

      const qrPayload = generateQrPayload(created);
      await db.entities.Document.create({
        project_id: matchedPo?.project_id || '',
        name: `Receiving QR — ${created.po_number} / ${created.material_heat_number || 'no heat'}`,
        document_type: 'other',
        description: 'Auto-generated QR routing payload for received material.',
        qr_payload: qrPayload,
        virtual_path: '/receiving-qr/',
      });

      toast({ title: `Marked ${deliveryStatus}`, description: `QR: ${qrPayload}` });
      setForm(emptyForm());
      setMatchedPo(null);
      setFiles([]);
      loadData();
    } catch (e) {
      toast({ title: 'Unable to log receiving', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-6 md:p-10 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <Truck className="w-8 h-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Shop Floor Receiving</h1>
          <p className="text-muted-foreground">Look up a PO, log material heat number, and mark delivery status</p>
        </div>
      </div>

      <div className="steel-card p-6 mb-6 space-y-4">
        <div>
          <Label className="text-base">PO / Packing List Number</Label>
          <div className="flex gap-2 mt-2">
            <Input
              value={form.po_number}
              onChange={(e) => setForm(f => ({ ...f, po_number: e.target.value }))}
              placeholder="PO-1001"
              className="h-14 text-lg"
            />
            <Button onClick={handleLookup} className="h-14 px-6 text-lg" variant="outline">
              <Search className="w-5 h-5 mr-2" />Look Up
            </Button>
          </div>
          {matchedPo && (
            <p className="text-sm text-green-600 mt-2">Matched: {matchedPo.vendor_name} · {matchedPo.material_category} · ${Number(matchedPo.budgeted_cost || 0).toLocaleString()}</p>
          )}
        </div>

        <div>
          <Label className="text-base">Material Heat Number</Label>
          <Input
            value={form.material_heat_number}
            onChange={(e) => setForm(f => ({ ...f, material_heat_number: e.target.value }))}
            placeholder="HT-4412"
            className="h-14 text-lg mt-2"
          />
        </div>

        <div>
          <Label className="text-base">Attach BOL / MTR</Label>
          <input
            type="file"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files || []))}
            className="mt-2 block w-full text-sm file:mr-3 file:py-3 file:px-5 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground file:text-sm"
          />
          {files.length > 0 && <p className="text-sm text-muted-foreground mt-1">{files.length} file(s) selected</p>}
        </div>

        <div className="grid grid-cols-2 gap-4 pt-2">
          <Button
            disabled={saving}
            onClick={() => submitReceiving('Received Complete')}
            className="h-20 text-lg bg-green-600 hover:bg-green-700 text-white border-0"
          >
            <PackageCheck className="w-6 h-6 mr-2" />Received Complete
          </Button>
          <Button
            disabled={saving}
            onClick={() => submitReceiving('Partial Delivery')}
            className="h-20 text-lg bg-orange-500 hover:bg-orange-600 text-white border-0"
          >
            <PackageX className="w-6 h-6 mr-2" />Partial Delivery
          </Button>
        </div>
      </div>

      <div className="steel-card p-6">
        <h3 className="font-semibold mb-3 text-lg">Recently Received</h3>
        <div className="space-y-2">
          {recentLogs.length === 0 ? (
            <p className="text-muted-foreground text-sm">No receiving activity yet.</p>
          ) : (
            recentLogs.map(log => (
              <div key={log.id} className="flex items-center justify-between p-3 rounded-lg border border-border text-sm">
                <div>
                  <p className="font-medium">{log.po_number}</p>
                  <p className="text-muted-foreground text-xs">Heat {log.material_heat_number || '—'}</p>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full ${log.delivery_status === 'Partial Delivery' ? 'bg-orange-500/10 text-orange-600' : 'bg-green-500/10 text-green-600'}`}>
                  {log.delivery_status}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
