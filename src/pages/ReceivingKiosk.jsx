import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Truck, PackageCheck, Search } from 'lucide-react';

const PO_STATUS_STYLES = {
  'Fully Received': 'border-transparent bg-green-500/10 text-green-600',
  'Partial Receipt': 'border-transparent bg-orange-500/10 text-orange-600',
};
const DEFAULT_PO_STATUS_STYLE = 'border-transparent bg-muted text-muted-foreground';

const CONDITIONS = ['Good', 'Damaged', 'Short Ship'];

export default function ReceivingKiosk() {
  const { toast } = useToast();
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [allPoLines, setAllPoLines] = useState([]);
  const [recentLogs, setRecentLogs] = useState([]);
  const [poNumberInput, setPoNumberInput] = useState('');
  const [matchedPo, setMatchedPo] = useState(null);
  const [poLines, setPoLines] = useState([]);
  const [project, setProject] = useState(null);
  const [lineInputs, setLineInputs] = useState({});
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [looked, setLooked] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [poList, logList, lineList] = await Promise.all([
        db.entities.purchase_orders.list('-created_date', 100),
        db.entities.receiving_logs.list('-created_date', 10),
        db.entities.purchase_order_lines.list('-created_date', 500),
      ]);
      setPurchaseOrders(poList);
      setRecentLogs(logList);
      setAllPoLines(lineList);
    } catch (e) {}
  };

  const buildLineInputs = (lines) => {
    const inputs = {};
    lines.forEach(line => {
      const remaining = Math.max(0, (line.quantity_ordered || 0) - (line.quantity_received || 0));
      inputs[line.id] = { receiveNow: remaining, heatNumber: '', condition: 'Good' };
    });
    return inputs;
  };

  const handleLookup = async () => {
    setLooked(true);
    const match = purchaseOrders.find(po => po.po_number?.toLowerCase() === poNumberInput.trim().toLowerCase());
    if (!match) {
      setMatchedPo(null);
      setPoLines([]);
      setProject(null);
      setLineInputs({});
      toast({ title: 'No matching PO found', variant: 'destructive' });
      return;
    }
    setMatchedPo(match);
    try {
      const [lines, proj] = await Promise.all([
        db.entities.purchase_order_lines.filter({ po_id: match.id }, 'line_number', 200),
        match.project_id ? db.entities.Project.get(match.project_id) : Promise.resolve(null),
      ]);
      setPoLines(lines);
      setProject(proj);
      setLineInputs(buildLineInputs(lines));
    } catch (e) {
      setPoLines([]);
      setLineInputs({});
    }
  };

  const updateLineInput = (lineId, field, value) => {
    setLineInputs(prev => ({ ...prev, [lineId]: { ...prev[lineId], [field]: value } }));
  };

  const totalOrdered = poLines.reduce((sum, l) => sum + (Number(l.quantity_ordered) || 0), 0);
  const totalReceived = poLines.reduce((sum, l) => sum + (Number(l.quantity_received) || 0), 0);
  const totalLineCost = poLines.reduce((sum, l) => sum + (Number(l.line_total) || 0), 0);
  const progressPct = totalOrdered > 0 ? Math.round((totalReceived / totalOrdered) * 100) : 0;
  const hasReceiveQty = poLines.some(l => Number(lineInputs[l.id]?.receiveNow || 0) > 0);

  const submitReceiving = async () => {
    const linesToReceive = poLines.filter(l => Number(lineInputs[l.id]?.receiveNow || 0) > 0);
    if (!matchedPo || linesToReceive.length === 0) return;

    setSaving(true);
    try {
      let attachmentPath = '';
      for (const file of files) {
        const { file_url } = await db.integrations.Core.UploadFile({ file });
        if (!attachmentPath) attachmentPath = file_url;
      }

      const me = await db.auth.me().catch(() => null);

      const updatedLines = [];
      for (const line of linesToReceive) {
        const input = lineInputs[line.id];
        const receiveQty = Number(input.receiveNow) || 0;
        const newReceived = (Number(line.quantity_received) || 0) + receiveQty;
        const isFullyReceived = newReceived >= (Number(line.quantity_ordered) || 0);
        const deliveryStatus = isFullyReceived ? 'Received Complete' : 'Partial Delivery';

        await db.entities.receiving_logs.create({
          po_id: matchedPo.id,
          po_number: matchedPo.po_number,
          line_id: line.id,
          quantity_ordered: line.quantity_ordered,
          quantity_received: newReceived,
          quantity_received_this_delivery: receiveQty,
          delivery_status: deliveryStatus,
          packing_list: matchedPo.po_number,
          material_heat_number: (input.heatNumber || '').trim(),
          attachment_path: attachmentPath || '',
          receiver_name: me?.full_name || '',
          notes: `Condition: ${input.condition || 'Good'}`,
          verified: true,
        });

        const updatedLine = await db.entities.purchase_order_lines.update(line.id, {
          quantity_received: newReceived,
          quantity_remaining: Math.max(0, (Number(line.quantity_ordered) || 0) - newReceived),
          is_fully_received: isFullyReceived,
        });
        updatedLines.push(updatedLine);
      }

      const mergedLines = poLines.map(l => updatedLines.find(u => u.id === l.id) || l);
      setPoLines(mergedLines);

      const allFullyReceived = mergedLines.every(l => l.is_fully_received);
      const newPoStatus = allFullyReceived ? 'Fully Received' : 'Partial Receipt';
      const updatedPo = await db.entities.purchase_orders.update(matchedPo.id, { status: newPoStatus });
      setMatchedPo(updatedPo);

      if (allFullyReceived) {
        await db.entities.Notification.create({
          title: 'PO Fully Received — Ready for Payment',
          message: `PO ${matchedPo.po_number} from ${matchedPo.vendor_name} has been fully received. All line items confirmed. Ready for AP to process payment.`,
          is_read: false,
        });
        toast({ title: `PO ${matchedPo.po_number} fully received — Accounting has been notified`, className: 'bg-green-600 text-white border-0' });
      } else {
        toast({ title: `Partial receipt logged for PO ${matchedPo.po_number}`, className: 'bg-orange-500 text-white border-0' });
      }

      setLineInputs(buildLineInputs(mergedLines));
      setFiles([]);
      loadData();
    } catch (e) {
      toast({ title: 'Unable to log receiving', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-6 md:p-10 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <Truck className="w-8 h-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Shop Floor Receiving</h1>
          <p className="text-muted-foreground">Look up a PO, receive line items, and keep accounting in the loop</p>
        </div>
      </div>

      <div className="steel-card p-6 mb-6 space-y-4">
        <div>
          <Label className="text-base">PO Number</Label>
          <div className="flex gap-2 mt-2">
            <Input
              value={poNumberInput}
              onChange={(e) => setPoNumberInput(e.target.value)}
              placeholder="PO-1001"
              className="h-14 text-lg"
              onKeyDown={(e) => { if (e.key === 'Enter') handleLookup(); }}
            />
            <Button onClick={handleLookup} className="h-14 px-6 text-lg" variant="outline">
              <Search className="w-5 h-5 mr-2" />Look Up
            </Button>
          </div>
          {looked && !matchedPo && (
            <p className="text-sm text-destructive mt-2">No matching PO found.</p>
          )}
        </div>
      </div>

      {matchedPo && (
        <div className="steel-card p-6 mb-6 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-xl font-bold">{matchedPo.po_number}</h2>
                <Badge className={PO_STATUS_STYLES[matchedPo.status] || DEFAULT_PO_STATUS_STYLE}>
                  {matchedPo.status || 'Open'}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{matchedPo.vendor_name} · {project?.name || 'No project linked'}</p>
              <p className="text-sm text-muted-foreground">Payment Terms: {matchedPo.payment_terms || '—'}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">PO Total</p>
              <p className="text-2xl font-bold">${totalLineCost.toLocaleString()}</p>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-sm">Receiving Progress</Label>
              <span className="text-sm font-medium">{progressPct}% · {totalReceived} of {totalOrdered} pieces received</span>
            </div>
            <Progress value={progressPct} className="h-3" />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground uppercase tracking-wide border-b border-border">
                  <th className="py-2 pr-3">Line</th>
                  <th className="py-2 pr-3">Description</th>
                  <th className="py-2 pr-3">Qty Ordered</th>
                  <th className="py-2 pr-3">Previously Received</th>
                  <th className="py-2 pr-3">Remaining</th>
                  <th className="py-2 pr-3">Receive Now</th>
                  <th className="py-2 pr-3">Heat Number</th>
                  <th className="py-2 pr-3">Condition</th>
                </tr>
              </thead>
              <tbody>
                {poLines.map(line => {
                  const remaining = Math.max(0, (Number(line.quantity_ordered) || 0) - (Number(line.quantity_received) || 0));
                  const input = lineInputs[line.id] || { receiveNow: remaining, heatNumber: '', condition: 'Good' };
                  return (
                    <tr key={line.id} className="border-b border-border/60">
                      <td className="py-2 pr-3">{line.line_number}</td>
                      <td className="py-2 pr-3">{line.description}</td>
                      <td className="py-2 pr-3">{line.quantity_ordered} {line.unit_of_measure}</td>
                      <td className="py-2 pr-3">{line.quantity_received}</td>
                      <td className="py-2 pr-3">{remaining}</td>
                      <td className="py-2 pr-3">
                        <Input
                          type="number"
                          min={0}
                          max={remaining}
                          value={input.receiveNow}
                          disabled={remaining === 0}
                          onChange={(e) => updateLineInput(line.id, 'receiveNow', Math.max(0, Math.min(remaining, Number(e.target.value))))}
                          className="w-20 h-9"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <Input
                          value={input.heatNumber}
                          disabled={remaining === 0}
                          onChange={(e) => updateLineInput(line.id, 'heatNumber', e.target.value)}
                          placeholder="HT-4412"
                          className="w-28 h-9"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <Select value={input.condition} onValueChange={(v) => updateLineInput(line.id, 'condition', v)} disabled={remaining === 0}>
                          <SelectTrigger className="w-32 h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {CONDITIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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

          <Button
            disabled={saving || !hasReceiveQty}
            onClick={submitReceiving}
            className="w-full h-16 text-lg bg-primary text-primary-foreground"
          >
            <PackageCheck className="w-6 h-6 mr-2" />Submit Receiving
          </Button>
        </div>
      )}

      <div className="steel-card p-6">
        <h3 className="font-semibold mb-3 text-lg">Recently Received</h3>
        <div className="space-y-2">
          {recentLogs.length === 0 ? (
            <p className="text-muted-foreground text-sm">No receiving activity yet.</p>
          ) : (
            recentLogs.map(log => {
              const relatedPo = purchaseOrders.find(po => po.id === log.po_id);
              const relatedLine = allPoLines.find(l => l.id === log.line_id);
              const poLinesForLog = allPoLines.filter(l => l.po_id === log.po_id);
              const poOrdered = poLinesForLog.reduce((sum, l) => sum + (Number(l.quantity_ordered) || 0), 0);
              const poReceived = poLinesForLog.reduce((sum, l) => sum + (Number(l.quantity_received) || 0), 0);
              const poCompletionPct = poOrdered > 0 ? Math.round((poReceived / poOrdered) * 100) : 0;
              return (
                <div key={log.id} className="flex items-center justify-between p-3 rounded-lg border border-border text-sm">
                  <div>
                    <p className="font-medium">{log.po_number} {relatedPo?.vendor_name ? `· ${relatedPo.vendor_name}` : ''}</p>
                    <p className="text-muted-foreground text-xs">
                      {relatedLine ? relatedLine.description : 'Whole PO'} · Received {log.quantity_received_this_delivery || log.quantity_received || 0}
                      {log.material_heat_number ? ` · Heat ${log.material_heat_number}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className={`text-xs px-2.5 py-1 rounded-full ${log.delivery_status === 'Partial Delivery' ? 'bg-orange-500/10 text-orange-600' : 'bg-green-500/10 text-green-600'}`}>
                      {log.delivery_status}
                    </span>
                    {poLinesForLog.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-1">PO {poCompletionPct}% received</p>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
