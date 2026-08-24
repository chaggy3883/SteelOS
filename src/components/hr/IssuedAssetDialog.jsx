import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { ASSET_TYPES, ISSUE_CONDITIONS, RETURN_CONDITIONS, assetTypeLabel } from '@/lib/issuedAssetsApi';

const todayDateOnly = () => new Date().toISOString().slice(0, 10);

// One dialog, three modes, driven entirely by the `asset` prop so callers
// never juggle a separate mode string that could drift out of sync with it:
//   - asset is null/undefined  -> "Issue Equipment" (create)
//   - asset.returned_date is empty -> "Mark Returned" (sets returned_date/condition/notes)
//   - asset.returned_date is set -> "Equipment Detail" (view, with corrections allowed)
export default function IssuedAssetDialog({ open, onOpenChange, employeeId, asset, onSaved }) {
  const { toast } = useToast();
  const isReturning = !!asset && !asset.returned_date;

  const [assetType, setAssetType] = useState('Badge');
  const [assetTag, setAssetTag] = useState('');
  const [issuedDate, setIssuedDate] = useState(todayDateOnly());
  const [condition, setCondition] = useState('New');
  const [returnedDate, setReturnedDate] = useState(todayDateOnly());
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAssetType(asset?.asset_type || 'Badge');
    setAssetTag(asset?.asset_tag || '');
    setIssuedDate(asset?.issued_date || todayDateOnly());
    setCondition(asset ? (RETURN_CONDITIONS.includes(asset.condition) ? asset.condition : 'Good') : 'New');
    setReturnedDate(asset?.returned_date || todayDateOnly());
    setNotes(asset?.notes || '');
  }, [open, asset]);

  const handleSubmit = async () => {
    setSaving(true);
    try {
      if (!asset) {
        const created = await db.entities.issued_assets.create({
          employee_id: employeeId,
          asset_type: assetType,
          asset_tag: assetTag.trim(),
          issued_date: issuedDate,
          condition,
          notes: notes.trim(),
        });
        toast({ title: `${assetTypeLabel(assetType)} issued` });
        onSaved?.(created);
      } else {
        const updated = await db.entities.issued_assets.update(asset.id, {
          asset_tag: assetTag.trim(),
          condition,
          returned_date: returnedDate,
          notes: notes.trim(),
        });
        toast({ title: isReturning ? `${assetTypeLabel(asset.asset_type)} marked returned` : 'Equipment record updated' });
        onSaved?.(updated);
      }
    } catch (e) {
      toast({ title: 'Unable to save', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {!asset ? 'Issue Equipment' : isReturning ? `Mark Returned — ${assetTypeLabel(asset.asset_type)}` : `Equipment Detail — ${assetTypeLabel(asset.asset_type)}`}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {!asset ? (
            <div>
              <Label className="text-xs">Asset Type</Label>
              <Select value={assetType} onValueChange={setAssetType}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ASSET_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div>
              <Label className="text-xs">Asset Type</Label>
              <p className="text-sm font-medium mt-1.5">{assetTypeLabel(asset.asset_type)}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Asset Tag (optional)</Label>
              <Input value={assetTag} onChange={(e) => setAssetTag(e.target.value)} placeholder="Serial / ID tag" className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Issued Date</Label>
              {!asset ? (
                <Input type="date" value={issuedDate} max={todayDateOnly()} onChange={(e) => setIssuedDate(e.target.value)} className="mt-1" />
              ) : (
                <p className="text-sm mt-2.5">{asset.issued_date || '—'}</p>
              )}
            </div>
          </div>

          {!asset ? (
            <div>
              <Label className="text-xs">Condition</Label>
              <Select value={condition} onValueChange={setCondition}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ISSUE_CONDITIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Condition on Return</Label>
                <Select value={condition} onValueChange={setCondition}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RETURN_CONDITIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Returned Date</Label>
                <Input type="date" value={returnedDate} max={todayDateOnly()} onChange={(e) => setReturnedDate(e.target.value)} className="mt-1" />
              </div>
            </div>
          )}

          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder='e.g. "screen is cracked", "keys never found"' className="mt-1" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={saving} onClick={handleSubmit}>
            {saving ? 'Saving…' : !asset ? 'Issue' : isReturning ? 'Mark Returned' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
