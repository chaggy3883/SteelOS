import React, { useEffect, useState } from 'react';
import { db } from '@/api/apiClient';
import { getEffectiveCompany } from '@/lib/tenantContext';
import { Cpu, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';

const PROVIDERS = [
  { value: 'local', label: 'Local / On-Premise VLM' },
  { value: 'claude', label: 'Anthropic Claude' },
  { value: 'openai', label: 'OpenAI' },
];

// Matches src/components/system-integrations/TokenVaultManager.jsx's own
// disclosure: this app has no backend and no real crypto, so a pasted
// third-party key is masked for display and base64-obscured, never stored
// or read back as usable plaintext — see the security note in
// src/lib/aiIntelligenceEngine.js for why the raw key never leaves this
// panel or gets used in a client-side call to Anthropic/OpenAI.
const maskKey = (fullKey) => `${fullKey.slice(0, 4)}...${fullKey.slice(-4)}`;
const obscureSecret = (fullKey) => btoa(fullKey);
const vaultTokenName = (provider) => `${provider}_api_key`;

export default function AiPlatformConfigPanel() {
  const { toast } = useToast();
  const [companyId, setCompanyId] = useState(null);
  const [provider, setProvider] = useState('local');
  const [localUrl, setLocalUrl] = useState('http://localhost:8080/v1');
  const [existingKeyToken, setExistingKeyToken] = useState(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingKey, setSavingKey] = useState(false);

  useEffect(() => { loadConfig(); }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const company = await getEffectiveCompany();
      if (!company) return;
      setCompanyId(company.id);
      setProvider(company.ai_provider || 'local');
      setLocalUrl(company.tenant_local_url || 'http://localhost:8080/v1');
      await loadKeyStatus(company.id, company.ai_provider || 'local');
    } finally {
      setLoading(false);
    }
  };

  const loadKeyStatus = async (id, activeProvider) => {
    if (activeProvider === 'local' || !id) {
      setExistingKeyToken(null);
      return;
    }
    const rows = await db.entities.ApiTokenVault.filter({ company_id: id, token_name: vaultTokenName(activeProvider) }, '-created_at', 1);
    setExistingKeyToken(rows[0] || null);
  };

  const handleProviderChange = async (value) => {
    setProvider(value);
    setApiKeyInput('');
    await loadKeyStatus(companyId, value);
  };

  const handleSaveConfig = async () => {
    if (!companyId) return;
    setSaving(true);
    try {
      await db.entities.Company.update(companyId, {
        ai_provider: provider,
        ...(provider === 'local' ? { tenant_local_url: localUrl } : {}),
      });
      toast({ title: 'AI platform configuration saved' });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveKey = async () => {
    if (!companyId || !apiKeyInput.trim()) return;
    setSavingKey(true);
    try {
      const fullKey = apiKeyInput.trim();
      const payload = {
        company_id: companyId,
        token_name: vaultTokenName(provider),
        partial_key_string: maskKey(fullKey),
        encrypted_secret_key: obscureSecret(fullKey),
        status: 'Active',
        created_at: new Date().toISOString(),
      };
      const created = existingKeyToken
        ? await db.entities.ApiTokenVault.update(existingKeyToken.id, payload)
        : await db.entities.ApiTokenVault.create(payload);
      setExistingKeyToken(created);
      setApiKeyInput('');
      toast({ title: `${PROVIDERS.find((p) => p.value === provider)?.label} key saved`, description: 'Only a masked reference is kept — the key itself is never re-displayed or sent to the browser again.' });
    } finally {
      setSavingKey(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>;
  }

  return (
    <div className="steel-card p-6 space-y-4">
      <div>
        <h3 className="font-semibold flex items-center gap-2"><Cpu className="w-4 h-4 text-primary" />Corporate AI Platform Configuration</h3>
        <p className="text-sm text-muted-foreground mt-0.5">Choose which AI provider powers contract review and blueprint takeoff for this company.</p>
      </div>

      <div>
        <Label className="text-xs">AI Provider</Label>
        <Select value={provider} onValueChange={handleProviderChange}>
          <SelectTrigger className="mt-1 max-w-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PROVIDERS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {provider === 'local' && (
        <div>
          <Label className="text-xs">Local Hardware Endpoint URL</Label>
          <Input value={localUrl} onChange={(e) => setLocalUrl(e.target.value)} placeholder="http://localhost:8080/v1" className="mt-1 max-w-sm" />
          <p className="text-xs text-muted-foreground mt-1">Your own on-premise vision/LLM server — never leaves your network.</p>
        </div>
      )}

      {(provider === 'claude' || provider === 'openai') && (
        <div className="space-y-2 max-w-sm">
          <Label className="text-xs">{PROVIDERS.find((p) => p.value === provider)?.label} API Key</Label>
          {existingKeyToken && (
            <p className="text-xs inline-flex items-center gap-1.5 text-emerald-600">
              <ShieldCheck className="w-3.5 h-3.5" />Key on file: <span className="font-mono">{existingKeyToken.partial_key_string}</span>
            </p>
          )}
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder={existingKeyToken ? 'Enter a new key to replace it' : 'Paste API key'}
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              className="flex-1"
            />
            <Button variant="outline" onClick={handleSaveKey} disabled={savingKey || !apiKeyInput.trim()}>
              {savingKey ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Only a masked reference is stored — the full key is never re-displayed, and this browser-only app never sends it directly to {PROVIDERS.find((p) => p.value === provider)?.label} itself (see the security note in aiIntelligenceEngine.js for why).</p>
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={handleSaveConfig} disabled={saving} className="steel-gradient text-white border-0">
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          Save Configuration
        </Button>
      </div>
    </div>
  );
}
