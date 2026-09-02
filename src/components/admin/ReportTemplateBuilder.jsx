import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { saveNewTemplateVersion, incrementVersion } from '@/lib/reportTemplates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Save, Loader2, History } from 'lucide-react';

const DOCUMENT_TYPES = [
  { key: 'proposal', label: 'Bid Proposal PDF', consumer: 'bidProposalPdf.js' },
  { key: 'manifest', label: 'Shipping Manifest', consumer: null },
  { key: 'invoice', label: 'Invoice', consumer: null },
];

const COLUMN_FLAGS = [
  { key: 'show_fabrication', label: 'Structural Steel Fabrication line' },
  { key: 'show_detailing', label: 'Detailing line' },
  { key: 'show_engineering', label: 'Engineering line' },
  { key: 'show_erection', label: 'Steel Erection line' },
  { key: 'show_admin_allocation', label: 'Overhead & Administrative Allocation line' },
  { key: 'show_tax_breakdown', label: 'Tax breakdown lines' },
];

export default function ReportTemplateBuilder() {
  const { toast } = useToast();
  const [documentTypeKey, setDocumentTypeKey] = useState(DOCUMENT_TYPES[0].key);
  const [versions, setVersions] = useState([]);
  const [flags, setFlags] = useState({});
  const [headerFooter, setHeaderFooter] = useState({ show_header: true, show_footer: false, footer_text: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadVersions(documentTypeKey); }, [documentTypeKey]);

  const activeTemplate = versions.find((v) => v.is_active) || null;

  const loadVersions = async (key) => {
    setLoading(true);
    try {
      const rows = await db.entities.report_templates.filter({ document_type_key: key }, '-created_date', 50);
      setVersions(rows);
      const active = rows.find((v) => v.is_active);
      setFlags(active?.column_visibility_flags_json || COLUMN_FLAGS.reduce((acc, f) => ({ ...acc, [f.key]: true }), {}));
      setHeaderFooter(active?.header_footer_config_json || { show_header: true, show_footer: false, footer_text: '' });
    } finally {
      setLoading(false);
    }
  };

  const toggleFlag = (key, value) => setFlags((prev) => ({ ...prev, [key]: value }));

  const handleSaveNewVersion = async () => {
    setSaving(true);
    try {
      const created = await saveNewTemplateVersion(activeTemplate, {
        document_type_key: documentTypeKey,
        column_visibility_flags_json: flags,
        header_footer_config_json: headerFooter,
      });
      setVersions((prev) => [created, ...prev.map((v) => ({ ...v, is_active: false }))]);
      toast({ title: `Saved as v${created.version_string}`, description: 'Previous version marked inactive.' });
    } catch (e) {
      toast({ title: 'Unable to save template version', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const activeDoc = DOCUMENT_TYPES.find((d) => d.key === documentTypeKey);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
      <div className="steel-card p-5 space-y-4">
        <div>
          <Label className="text-xs">Document Type</Label>
          <Select value={documentTypeKey} onValueChange={setDocumentTypeKey}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DOCUMENT_TYPES.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">
            {activeDoc?.consumer
              ? `Applied live by ${activeDoc.consumer} — hidden lines disappear from the printed document.`
              : 'No report in this app currently reads this template — configuration is stored for when one does.'}
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
        ) : (
          <>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Column Visibility</p>
              <div className="space-y-1.5">
                {COLUMN_FLAGS.map((f) => (
                  <label key={f.key} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={flags[f.key] !== false} onChange={(e) => toggleFlag(f.key, e.target.checked)} />
                    {f.label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Header / Footer</p>
              <label className="flex items-center gap-2 text-sm mb-1.5">
                <input type="checkbox" checked={!!headerFooter.show_header} onChange={(e) => setHeaderFooter((p) => ({ ...p, show_header: e.target.checked }))} />
                Show branded header
              </label>
              <label className="flex items-center gap-2 text-sm mb-1.5">
                <input type="checkbox" checked={!!headerFooter.show_footer} onChange={(e) => setHeaderFooter((p) => ({ ...p, show_footer: e.target.checked }))} />
                Show footer text
              </label>
              {headerFooter.show_footer && (
                <Input value={headerFooter.footer_text} onChange={(e) => setHeaderFooter((p) => ({ ...p, footer_text: e.target.value }))} placeholder="Footer text" className="h-8 text-sm" />
              )}
            </div>

            <Button onClick={handleSaveNewVersion} disabled={saving} className="gap-2 w-full steel-gradient text-white border-0">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save as v{incrementVersion(activeTemplate?.version_string)}
            </Button>
          </>
        )}
      </div>

      <div className="steel-card p-4">
        <h4 className="font-semibold text-sm mb-3 flex items-center gap-2"><History className="w-4 h-4 text-primary" />Version History</h4>
        {versions.length === 0 ? (
          <p className="text-xs text-muted-foreground">No versions saved yet — this document type will use defaults everywhere.</p>
        ) : versions.map((v) => (
          <div key={v.id} className={`rounded-lg border p-2 text-xs mb-2 ${v.is_active ? 'border-primary bg-primary/5' : 'border-border'}`}>
            <div className="flex items-center justify-between">
              <span className="font-mono font-semibold">v{v.version_string}</span>
              {v.is_active && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600 font-semibold">ACTIVE</span>}
            </div>
            <p className="text-muted-foreground">{new Date(v.created_date).toLocaleString()}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
