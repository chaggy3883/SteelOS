import React from 'react';
import { AlertTriangle, Truck, Warehouse } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

export default function FleetRentalRegistry({ assets, projects, vendors, onTogglePickup }) {
  const projectName = (id) => projects.find((p) => p.id === id)?.name || '—';
  const vendorName = (id) => vendors.find((v) => v.id === id)?.name || '—';

  return (
    <div className="steel-card p-0 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Asset</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Ownership</TableHead>
            <TableHead>Project Location</TableHead>
            <TableHead>Runtime Hours</TableHead>
            <TableHead>Rental Off-Rent Target</TableHead>
            <TableHead className="text-right">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {assets.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">No fleet assets on file.</TableCell>
            </TableRow>
          )}
          {assets.map((asset) => {
            const isRented = asset.status === 'Third_Party_Rented';
            return (
              <TableRow key={asset.id}>
                <TableCell className="font-medium flex items-center gap-2">
                  {isRented ? <Warehouse className="w-4 h-4 text-muted-foreground" /> : <Truck className="w-4 h-4 text-muted-foreground" />}
                  {asset.asset_name}
                </TableCell>
                <TableCell className="text-sm">{asset.asset_type?.replace(/_/g, ' ')}</TableCell>
                <TableCell>
                  <Badge variant={isRented ? 'outline' : 'secondary'}>{isRented ? 'Third-Party Rented' : 'Internal Owned'}</Badge>
                  {isRented && <p className="text-xs text-muted-foreground mt-0.5">{vendorName(asset.rental_vendor_id)}</p>}
                </TableCell>
                <TableCell className="text-sm">{projectName(asset.project_location_id)}</TableCell>
                <TableCell className="font-mono text-sm">{(asset.runtime_hours || 0).toLocaleString()}</TableCell>
                <TableCell className="text-sm font-mono">{isRented ? (asset.rental_target_off_rent_date || '—') : '—'}</TableCell>
                <TableCell className="text-right">
                  {asset.is_marked_ready_for_pickup ? (
                    <Badge className="bg-amber-500 text-black border-0 gap-1 animate-pulse">
                      <AlertTriangle className="w-3 h-3" />OFF-RENT TRIGGERED — CALL FOR PICKUP
                    </Badge>
                  ) : isRented ? (
                    <Button size="sm" variant="outline" onClick={() => onTogglePickup(asset)}>Mark Ready for Pickup</Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
