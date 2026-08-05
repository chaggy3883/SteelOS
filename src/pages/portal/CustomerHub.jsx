import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { getPortalSession } from '@/lib/portalAuth';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import StatusBadge from '@/components/ui/StatusBadge';
import FileExplorer from '@/components/documents/FileExplorer';
import { UploadCloud, FileText, MessageSquare, ClipboardList, DollarSign, Receipt } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

export default function CustomerHub() {
  const { toast } = useToast();
  const session = getPortalSession();
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [pieces, setPieces] = useState([]);
  const [rfis, setRfis] = useState([]);
  const [submittals, setSubmittals] = useState([]);
  const [changeOrders, setChangeOrders] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadProjects(); }, []);
  useEffect(() => { if (selectedProjectId) loadProjectData(selectedProjectId); }, [selectedProjectId]);

  const loadProjects = async () => {
    try {
      const list = await db.entities.Project.filter({ customer_id: session?.orgId }, '-created_date', 50);
      setProjects(list);
      if (list.length > 0) setSelectedProjectId(list[0].id);
      else setLoading(false);
    } catch (e) { setLoading(false); }
  };

  const loadProjectData = async (projectId) => {
    setLoading(true);
    try {
      const [pieceData, rfiData, submittalData, coData, invoiceData] = await Promise.all([
        db.entities.PieceMark.filter({ project_id: projectId }, '-created_date', 200),
        db.entities.RFI.filter({ project_id: projectId }, '-created_date', 50),
        db.entities.Submittal.filter({ project_id: projectId }, '-created_date', 50),
        db.entities.change_orders.filter({ project_id: projectId }, '-created_date', 50),
        db.entities.InvoiceReceivable.filter({ project_id: projectId }, '-created_date', 50),
      ]);
      setPieces(pieceData);
      setRfis(rfiData);
      setSubmittals(submittalData);
      setChangeOrders(coData);
      setInvoices(invoiceData);
    } catch (e) {} finally { setLoading(false); }
  };

  const total = pieces.length;
  const pct = (predicate) => total > 0 ? Math.round((pieces.filter(predicate).length / total) * 100) : 0;
  const detailingPct = pct(p => p.detailing_complete);
  const fabricatedPct = pct(p => ['fabricated', 'inspected', 'painted', 'shipped', 'erected'].includes(p.status));
  const shippedPct = pct(p => ['shipped', 'erected'].includes(p.status));

  const handleFieldNoteDrop = async (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file || !selectedProjectId) return;
    try {
      const { file_url } = await db.integrations.Core.UploadFile({ file });
      await db.entities.Document.create({
        project_id: selectedProjectId,
        name: file.name,
        file_url,
        file_name: file.name,
        file_size: file.size,
        file_type: file.type,
        document_type: 'other',
        virtual_path: '/field-notes/',
        status: 'uploaded',
      });
      toast({ title: 'Field note uploaded' });
    } catch (err) {
      toast({ title: 'Upload failed', variant: 'destructive' });
    }
  };

  if (projects.length === 0 && !loading) {
    return <p className="text-sm text-muted-foreground">No projects are currently linked to your account.</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Customer Hub</h1>
        <p className="text-sm text-muted-foreground">Read-only project visibility for {session?.orgName}.</p>
      </div>

      {projects.length > 1 && (
        <div className="max-w-sm">
          <Label className="text-xs">Project</Label>
          <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Project Progress */}
      <div className="steel-card p-5">
        <h3 className="font-semibold mb-3">Project Progress</h3>
        {[
          { label: '% Detailing', value: detailingPct, color: 'bg-purple-500' },
          { label: '% Fabricated', value: fabricatedPct, color: 'bg-blue-500' },
          { label: '% Shipped', value: shippedPct, color: 'bg-green-500' },
        ].map(({ label, value, color }) => (
          <div key={label} className="mb-3 last:mb-0">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-medium">{value}%</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${value}%` }} />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* RFIs */}
        <div className="steel-card p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><MessageSquare className="w-4 h-4 text-primary" />RFIs</h3>
          {rfis.length === 0 ? <p className="text-sm text-muted-foreground">No RFIs yet.</p> : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {rfis.map((r) => (
                <div key={r.id} className="flex items-center justify-between p-2 rounded bg-muted/50 text-xs">
                  <div className="min-w-0"><p className="font-mono font-bold">{r.rfi_number}</p><p className="truncate text-muted-foreground">{r.subject}</p></div>
                  <StatusBadge status={r.status} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Submittals */}
        <div className="steel-card p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><ClipboardList className="w-4 h-4 text-primary" />Submittals</h3>
          {submittals.length === 0 ? <p className="text-sm text-muted-foreground">No submittals yet.</p> : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {submittals.map((s) => (
                <div key={s.id} className="flex items-center justify-between p-2 rounded bg-muted/50 text-xs">
                  <div className="min-w-0"><p className="font-mono font-bold">{s.submittal_number || s.id.slice(0, 8)}</p><p className="truncate text-muted-foreground">{s.title}</p></div>
                  <StatusBadge status={s.status} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Change Orders */}
        <div className="steel-card p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><DollarSign className="w-4 h-4 text-primary" />Change Orders</h3>
          {changeOrders.length === 0 ? <p className="text-sm text-muted-foreground">No change orders yet.</p> : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {changeOrders.map((co) => (
                <div key={co.id} className="p-2 rounded bg-muted/50 text-xs">
                  <div className="flex items-center justify-between">
                    <p className="font-mono font-bold">{co.change_order_id}</p>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted">{co.status}</span>
                  </div>
                  <p className="text-muted-foreground truncate">{co.description}</p>
                  <p className="font-mono mt-1">${Number(co.cost_impact || 0).toLocaleString()} · {co.schedule_impact || 0}d schedule</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* AIA Billing */}
        <div className="steel-card p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><Receipt className="w-4 h-4 text-primary" />Progress Billing (Net AIA)</h3>
          {invoices.length === 0 ? <p className="text-sm text-muted-foreground">No billings yet.</p> : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {invoices.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between p-2 rounded bg-muted/50 text-xs">
                  <div><p className="font-medium">{inv.billing_period}</p><p className="text-muted-foreground">Net: ${Number(inv.net_billing || 0).toLocaleString()}</p></div>
                  <StatusBadge status={inv.payment_status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* IFC Documents */}
      <div className="steel-card p-5">
        <h3 className="font-semibold mb-3 flex items-center gap-2"><FileText className="w-4 h-4 text-primary" />Issued-for-Construction Drawings</h3>
        {selectedProjectId && <FileExplorer projectId={selectedProjectId} documentTypeFilter="ifc" />}
      </div>

      {/* Field Notes Dropzone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleFieldNoteDrop}
        className={cn(
          'border-2 border-dashed rounded-xl p-8 text-center transition-all',
          dragging ? 'border-primary bg-primary/5' : 'border-border'
        )}
      >
        <UploadCloud className={cn('w-8 h-8 mx-auto mb-2', dragging ? 'text-primary' : 'text-muted-foreground')} />
        <p className="text-sm font-medium">Drop Field Notes Here</p>
        <p className="text-xs text-muted-foreground mt-1">Photos, markups, or notes from the field — routed to this project's document registry.</p>
      </div>
    </div>
  );
}
