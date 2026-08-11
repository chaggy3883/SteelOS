import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

// Shared read-only repair record view — used both by RepairLedger's own
// row drill-down and by FleetRentalRegistry's per-asset Maintenance History
// section, so "every field on the record" only has one place to stay in sync.
export default function RepairDetailDialog({ repair, open, onOpenChange, assets = [], projects = [], vendors = [] }) {
  if (!repair) return null;

  const asset = assets.find((a) => a.id === repair.asset_id);
  const project = projects.find((p) => p.id === repair.project_id);
  const vendor = vendors.find((v) => v.id === repair.vendor_id);

  const rows = [
    ['Asset', asset?.asset_name || repair.asset_id || '—'],
    ['Repair Category', repair.repair_category ? repair.repair_category.replace(/_/g, ' ') : '—'],
    ['Repair Date', repair.repair_date || '—'],
    ['Runtime Hours at Repair', (repair.runtime_hours_at_repair || 0).toLocaleString()],
    ['Cost', `$${((repair.cost_cents || 0) / 100).toFixed(2)}`],
    ['Cost Code', repair.cost_code || '—'],
    ['Project', project?.name || 'Not linked'],
    ['Vendor', vendor?.name || 'Not linked'],
    ['Notes', repair.notes || '—'],
    ['Job Cost Entry', repair.job_cost_entry_id || '—'],
    ['AP Bill', repair.vendor_bill_id || '—'],
    ['Logged', repair.created_at ? new Date(repair.created_at).toLocaleString() : '—'],
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span>Repair Record</span>
            {repair.posted_to_job_cost && <Badge variant="secondary" className="text-[10px]">Posted to Job Cost</Badge>}
            {repair.vendor_bill_id && <Badge variant="secondary" className="text-[10px]">AP Bill Created</Badge>}
            {!repair.posted_to_job_cost && !repair.vendor_bill_id && <Badge variant="outline" className="text-[10px]">Unposted</Badge>}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {rows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-3 gap-2 text-sm border-b border-border/50 pb-2">
              <span className="text-muted-foreground">{label}</span>
              <span className="col-span-2 font-medium whitespace-pre-wrap">{value}</span>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
