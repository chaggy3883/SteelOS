import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { getEffectiveCompany } from '@/lib/tenantContext';
import { ASSET_TYPES, getDefaultIssuedAssetKit } from '@/lib/issuedAssetsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Save, Palette, Package } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

export default function CompanyBrandingPanel() {
  const { toast } = useToast();
  const [company, setCompany] = useState(null);
  const [logoUrl, setLogoUrl] = useState('');
  const [colorHex, setColorHex] = useState('#2563eb');
  const [issuedAssetKit, setIssuedAssetKit] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadCompany(); }, []);

  const loadCompany = async () => {
    setLoading(true);
    try {
      const row = await getEffectiveCompany();
      setCompany(row);
      setLogoUrl(row?.logo_url || '');
      setColorHex(row?.brand_color_hex || '#2563eb');
      setIssuedAssetKit(getDefaultIssuedAssetKit(row));
    } finally {
      setLoading(false);
    }
  };

  const toggleKitItem = (value) => {
    setIssuedAssetKit((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  };

  const handleSave = async () => {
    if (!company) return;
    setSaving(true);
    try {
      const updated = await db.entities.Company.update(company.id, {
        logo_url: logoUrl.trim(),
        brand_color_hex: colorHex,
        default_issued_asset_kit: issuedAssetKit,
      });
      setCompany(updated);
      toast({ title: 'Company settings saved', description: 'Branding and the default new-hire equipment kit are updated.' });
    } catch (e) {
      toast({ title: 'Unable to save company settings', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  if (!company) {
    return <p className="text-sm text-muted-foreground p-4">No tenant profile found for this session — nothing to brand.</p>;
  }

  return (
    <div className="max-w-lg space-y-4">
      <div className="steel-card p-6">
        <h3 className="font-semibold mb-1 flex items-center gap-2"><Palette className="w-4 h-4 text-primary" />Company Branding — {company.name}</h3>
        <p className="text-xs text-muted-foreground mb-6">Applies to this tenant only. Renders dynamically in the TopBar logo slot and NavBar active-state accent.</p>
        <div className="space-y-4">
          <div>
            <Label className="text-xs">Logo File URL</Label>
            <Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="/uploads/company-logo.png" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Brand Color</Label>
            <div className="flex items-center gap-2 mt-1">
              <input type="color" value={colorHex} onChange={(e) => setColorHex(e.target.value)} className="h-9 w-14 rounded border border-input cursor-pointer bg-transparent p-0" />
              <Input value={colorHex} onChange={(e) => setColorHex(e.target.value)} className="font-mono" />
            </div>
          </div>
        </div>
      </div>

      <div className="steel-card p-6">
        <h3 className="font-semibold mb-1 flex items-center gap-2"><Package className="w-4 h-4 text-primary" />Default New-Hire Equipment Kit</h3>
        <p className="text-xs text-muted-foreground mb-4">Auto-issued to every new employee on hire (see the Equipment tab on their profile). HR can still issue or return individual items anytime, regardless of this list.</p>
        <div className="grid grid-cols-2 gap-2.5">
          {ASSET_TYPES.map((t) => (
            <label key={t.value} className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={issuedAssetKit.includes(t.value)} onCheckedChange={() => toggleKitItem(t.value)} />
              {t.label}
            </label>
          ))}
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving} className="gap-2 steel-gradient text-white border-0">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Save Company Settings
      </Button>
    </div>
  );
}
