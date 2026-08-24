import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import { Loader2, Plus, Package } from 'lucide-react';
import IssuedAssetDialog from '@/components/hr/IssuedAssetDialog';
import { assetTypeLabel } from '@/lib/issuedAssetsApi';

const CONDITION_COLORS = {
  New: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  Good: 'bg-green-500/10 text-green-600 border-green-500/20',
  Worn: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  Damaged: 'bg-red-500/10 text-red-500 border-red-500/20',
  Lost: 'bg-red-600/20 text-red-600 border-red-600/30',
};

function ConditionBadge({ condition, returned }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border flex-shrink-0 ${CONDITION_COLORS[condition] || 'bg-gray-500/10 text-gray-500 border-gray-500/20'}`}>
      {returned ? `Returned — ${condition}` : condition}
    </span>
  );
}

// Standing Rule 1 (every data point clickable): this is the full audit trail
// for an employee's issued equipment — every asset ever issued, whether
// returned or still outstanding, each row clickable to view/edit its detail
// (asset type, issued date, returned date, condition, notes). Rendered as
// EmployeeProfileDialog's "Equipment" tab, gated by hasFullEmployeeAccess
// (HR/admin only — see that file). TerminationPanel's "Equipment Return"
// section reads the same issued_assets rows for its offboarding checklist.
export default function EquipmentPanel({ employee }) {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingAsset, setEditingAsset] = useState(null);

  useEffect(() => { load(); }, [employee?.id]);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await db.entities.issued_assets.filter({ employee_id: employee.id }, '-issued_date', 100);
      setAssets(rows);
    } finally {
      setLoading(false);
    }
  };

  const handleSaved = () => {
    setShowCreate(false);
    setEditingAsset(null);
    load();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }

  const outstanding = assets.filter((a) => !a.returned_date);
  const dialogOpen = showCreate || !!editingAsset;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {assets.length === 0 ? 'No equipment issued yet.' : `${outstanding.length} outstanding of ${assets.length} issued.`}
        </p>
        <Button size="sm" className="gap-1.5" onClick={() => setShowCreate(true)}>
          <Plus className="w-3.5 h-3.5" />Issue Item
        </Button>
      </div>

      {assets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
          <Package className="w-8 h-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No equipment on file for {employee.full_name}.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {assets.map((asset) => (
            <button
              key={asset.id}
              onClick={() => setEditingAsset(asset)}
              className="w-full flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-left hover:bg-muted/50 transition-colors"
            >
              <div>
                <p className="text-sm font-medium">{assetTypeLabel(asset.asset_type)}{asset.asset_tag ? ` — ${asset.asset_tag}` : ''}</p>
                <p className="text-xs text-muted-foreground">
                  Issued {asset.issued_date || '—'}{asset.returned_date ? ` • Returned ${asset.returned_date}` : ''}
                  {asset.notes ? ` • ${asset.notes}` : ''}
                </p>
              </div>
              <ConditionBadge condition={asset.condition} returned={!!asset.returned_date} />
            </button>
          ))}
        </div>
      )}

      <IssuedAssetDialog
        open={dialogOpen}
        onOpenChange={(o) => { if (!o) { setShowCreate(false); setEditingAsset(null); } }}
        employeeId={employee.id}
        asset={editingAsset}
        onSaved={handleSaved}
      />
    </div>
  );
}
