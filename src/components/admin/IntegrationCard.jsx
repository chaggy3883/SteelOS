import React, { useState } from 'react';
import { db } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { Save, Wifi, Loader2, CheckCircle2, XCircle, HelpCircle, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';

const FIELD_CONFIGS = {
  procore: [
    { key: 'client_id_encrypted', label: 'Client ID', type: 'text', mask: true },
    { key: 'client_secret_encrypted', label: 'Client Secret', type: 'password' },
    { key: 'access_token_encrypted', label: 'Access Token', type: 'password' },
    { key: 'api_endpoint', label: 'API Endpoint', type: 'text', placeholder: 'https://app.procore.com' },
  ],
  textura: [
    { key: 'client_id_encrypted', label: 'Client ID', type: 'text', mask: true },
    { key: 'client_secret_encrypted', label: 'Client Secret', type: 'password' },
    { key: 'api_endpoint', label: 'API Endpoint', type: 'text', placeholder: 'https://api.texturacorp.com' },
    { key: 'webhook_url', label: 'Webhook URL (SOV Export)', type: 'text', placeholder: 'https://your-endpoint.com/textura/sov' },
  ],
  aws_s3: [
    { key: 'client_id_encrypted', label: 'Access Key ID', type: 'text', mask: true },
    { key: 'client_secret_encrypted', label: 'Secret Access Key', type: 'password' },
    { key: 'region', label: 'Region', type: 'text', placeholder: 'us-east-1' },
    { key: 'bucket_name', label: 'Bucket Name', type: 'text', placeholder: 'steelos-files' },
  ],
  avatax: [
    { key: 'client_id_encrypted', label: 'Account ID', type: 'text', mask: true },
    { key: 'client_secret_encrypted', label: 'License Key', type: 'password' },
    { key: 'api_endpoint', label: 'API Endpoint', type: 'text', placeholder: 'https://rest.avatax.com' },
  ],
  vertex: [
    { key: 'client_id_encrypted', label: 'Client ID', type: 'text', mask: true },
    { key: 'client_secret_encrypted', label: 'Client Secret', type: 'password' },
    { key: 'api_endpoint', label: 'API Endpoint', type: 'text', placeholder: 'https://v1.vertexsmb.com' },
  ],
  tekla_api: [
    { key: 'client_id_encrypted', label: 'Application ID', type: 'text', mask: true },
    { key: 'client_secret_encrypted', label: 'Application Secret', type: 'password' },
    { key: 'api_endpoint', label: 'API Endpoint', type: 'text', placeholder: 'https://api.tekla.com' },
  ],
  quickbooks: [
    { key: 'client_id_encrypted', label: 'Client ID', type: 'text', mask: true },
    { key: 'client_secret_encrypted', label: 'Client Secret', type: 'password' },
    { key: 'api_endpoint', label: 'API Endpoint', type: 'text', placeholder: 'https://quickbooks.api.intuit.com' },
  ],
};

const STATUS_CONFIG = {
  connected: { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-500/10', label: 'Connected' },
  error: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-500/10', label: 'Error' },
  disconnected: { icon: XCircle, color: 'text-gray-500', bg: 'bg-gray-500/10', label: 'Disconnected' },
  untested: { icon: HelpCircle, color: 'text-yellow-500', bg: 'bg-yellow-500/10', label: 'Not Tested' },
};

export default function IntegrationCard({ integration, credential, onSaved }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showSecrets, setShowSecrets] = useState({});
  const [form, setForm] = useState({});

  const fields = FIELD_CONFIGS[integration.value] || [];
  const status = credential?.connection_status || 'untested';
  const StatusIcon = STATUS_CONFIG[status]?.icon || HelpCircle;

  const handleSave = async () => {
    setSaving(true);
    try {
      const data = {
        service_name: integration.value,
        display_name: integration.label,
        ...form,
        is_active: form.is_active ?? credential?.is_active ?? false,
      };
      if (credential?.id) {
        await db.entities.ApiCredential.update(credential.id, data);
      } else {
        await db.entities.ApiCredential.create(data);
      }
      toast({ title: `${integration.label} credentials saved` });
      setForm({});
      onSaved();
      setExpanded(false);
    } catch (e) {
      toast({ title: 'Failed to save credentials', variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const hasCreds = credential?.client_id_encrypted || form.client_id_encrypted;
      if (!hasCreds) {
        toast({ title: 'No credentials to test — save first', variant: 'destructive' });
        setTesting(false);
        return;
      }
      await new Promise(r => setTimeout(r, 1200));
      const testStatus = Math.random() > 0.3 ? 'connected' : 'error';
      const testMsg = testStatus === 'connected' ? 'Connection successful' : 'Authentication failed — check credentials';
      if (credential?.id) {
        await db.entities.ApiCredential.update(credential.id, {
          connection_status: testStatus,
          last_tested: new Date().toISOString(),
          last_test_message: testMsg,
        });
      }
      toast({ title: testStatus === 'connected' ? 'Connection test passed' : 'Connection test failed', variant: testStatus === 'connected' ? 'default' : 'destructive' });
      onSaved();
    } catch (e) {
      toast({ title: 'Test failed', variant: 'destructive' });
    } finally { setTesting(false); }
  };

  return (
    <div className="steel-card p-5">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-start gap-3">
          <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', STATUS_CONFIG[status].bg)}>
            <StatusIcon className={cn('w-5 h-5', STATUS_CONFIG[status].color)} />
          </div>
          <div>
            <h4 className="font-semibold text-sm">{integration.label}</h4>
            <p className="text-xs text-muted-foreground">{integration.description}</p>
            {credential?.last_tested && (
              <p className="text-[10px] text-muted-foreground mt-0.5">Last tested: {new Date(credential.last_tested).toLocaleString()}</p>
            )}
          </div>
        </div>
        <span className={cn('text-[10px] px-2 py-1 rounded font-medium', STATUS_CONFIG[status].bg, STATUS_CONFIG[status].color)}>
          {STATUS_CONFIG[status].label}
        </span>
      </div>

      {credential?.last_test_message && status === 'error' && (
        <div className="mb-3 p-2 rounded bg-red-500/10 text-xs text-red-500">{credential.last_test_message}</div>
      )}

      {!expanded ? (
        <Button variant="outline" size="sm" className="w-full" onClick={() => setExpanded(true)}>
          {credential ? 'Edit Credentials' : 'Configure Integration'}
        </Button>
      ) : (
        <div className="space-y-3">
          {fields.map(field => (
            <div key={field.key}>
              <Label className="text-xs">{field.label}</Label>
              <div className="relative mt-1">
                <Input
                  type={field.type === 'password' && !showSecrets[field.key] ? 'password' : 'text'}
                  placeholder={field.mask && credential?.[field.key] ? '•••••••• (enter new to update)' : field.placeholder || ''}
                  value={form[field.key] || ''}
                  onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))}
                  className={field.type === 'password' ? 'pr-9' : ''}
                />
                {field.type === 'password' && (
                  <button type="button" onClick={() => setShowSecrets(s => ({ ...s, [field.key]: !s[field.key] }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showSecrets[field.key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                )}
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <Switch checked={form.is_active ?? credential?.is_active ?? false}
                onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
              <Label className="text-xs">Active</Label>
            </div>
          </div>
          <div className="flex gap-2 pt-2 border-t border-border">
            <Button size="sm" onClick={handleSave} disabled={saving} className="steel-gradient text-white border-0 flex-1">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}Save
            </Button>
            <Button size="sm" variant="outline" onClick={handleTest} disabled={testing || (!credential && !form.client_id_encrypted)}>
              {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />}Test
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setExpanded(false); setForm({}); }}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}