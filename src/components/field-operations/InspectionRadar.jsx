import React, { useMemo } from 'react';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { getCertStatus } from '@/lib/certAlerts';

const DISPATCH_WINDOW_DAYS = 30;

const STATUS_BADGE = {
  Valid: { variant: 'secondary', className: 'bg-green-500/10 text-green-600 border-transparent', label: 'Valid' },
  Expiring_Soon: { variant: 'outline', className: 'bg-red-500/10 text-red-600 border-red-500/40', label: 'Expiring — within 30 days' },
  Expired: { variant: 'destructive', className: '', label: 'EXPIRED' },
};

export default function InspectionRadar({ inspections, assets }) {
  const assetName = (id) => assets.find((a) => a.id === id)?.asset_name || id || '—';

  const rows = useMemo(
    () => inspections
      .map((i) => ({ ...i, status: getCertStatus(i.expiration_date, DISPATCH_WINDOW_DAYS) }))
      .sort((a, b) => new Date(a.expiration_date).getTime() - new Date(b.expiration_date).getTime()),
    [inspections]
  );

  return (
    <div className="steel-card p-0 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Asset</TableHead>
            <TableHead>Inspection Type</TableHead>
            <TableHead>Executed</TableHead>
            <TableHead>Expiration</TableHead>
            <TableHead className="text-right">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">No inspections on file.</TableCell>
            </TableRow>
          )}
          {rows.map((i) => {
            const badge = STATUS_BADGE[i.status];
            return (
              <TableRow key={i.id} className={i.status !== 'Valid' ? 'bg-red-500/5' : ''}>
                <TableCell className="font-medium">{assetName(i.asset_id)}</TableCell>
                <TableCell className="text-sm">{i.inspection_type.replace(/_/g, ' ')}</TableCell>
                <TableCell className="text-sm font-mono">{i.executed_date || '—'}</TableCell>
                <TableCell className="text-sm font-mono">{i.expiration_date || '—'}</TableCell>
                <TableCell className="text-right">
                  <Badge variant={badge.variant} className={`gap-1 ${badge.className}`}>
                    {i.status === 'Valid' ? <ShieldCheck className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
                    {badge.label}
                  </Badge>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
