import React, { useState, useEffect } from 'react';
import { db } from '@/api/apiClient';
import { Loader2, Plug, Globe, Copy, Check } from 'lucide-react';
import { INTEGRATIONS } from '@/components/admin/adminConstants';
import IntegrationCard from '@/components/admin/IntegrationCard';
import AchConfigPanel from '@/components/admin/AchConfigPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function PortalLinkField({ label, url }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {}
  };

  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-2 mt-1">
        <Input value={url} readOnly className="flex-1 text-xs" />
        <Button size="sm" variant="outline" onClick={handleCopy} className="flex-shrink-0">
          {copied ? <Check className="w-3.5 h-3.5 mr-1.5 text-green-500" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
          {copied ? 'Copied' : 'Copy Link'}
        </Button>
      </div>
    </div>
  );
}

// Internal staff manage portal access from here, in Admin — the /portal/login
// URL itself is meant for customers/vendors to bookmark and use directly, not
// for staff to navigate to from inside the app (see NavBar.jsx's "Portal
// Management" entry, which now points here instead of to that URL).
function PortalAccessLinks() {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div className="steel-card p-4 flex items-start gap-3">
      <Globe className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
      <div className="flex-1 space-y-3">
        <div>
          <p className="text-sm font-medium">Portal Access Links</p>
          <p className="text-xs text-muted-foreground">
            Share these links with customers or vendors so they can log in to their own portal. Set up their portal
            email and password in their Customer or Vendor record before sending.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <PortalLinkField label="Customer Portal URL" url={`${origin}/portal/login?type=customer`} />
          <PortalLinkField label="Vendor Portal URL" url={`${origin}/portal/login?type=vendor`} />
        </div>
      </div>
    </div>
  );
}

export default function IntegrationsGateway() {
  const [credentials, setCredentials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => { loadCredentials(); }, []);

  useEffect(() => {
    db.auth.me().then(u => setCurrentUser(u)).catch(() => setCurrentUser(null));
  }, []);

  const isSuperAdmin = currentUser?.roles?.includes('super_admin') ?? false;

  const loadCredentials = async () => {
    setLoading(true);
    try {
      const list = await db.entities.ApiCredential.list('-created_date', 50);
      setCredentials(list);
    } catch (e) { setCredentials([]); }
    finally { setLoading(false); }
  };

  const getCredential = (serviceName) => credentials.find(c => c.service_name === serviceName);

  return (
    <div className="space-y-4">
      <PortalAccessLinks />

      <AchConfigPanel />

      <div className="steel-card p-4 flex items-start gap-3">
        <Plug className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium">External Ecosystem Manager</p>
          <p className="text-xs text-muted-foreground">Manage API credentials for third-party platform integrations. Sensitive keys are masked in the UI and encrypted at rest via the platform database layer.</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {INTEGRATIONS.filter(i => i.value !== 'aws_s3' || isSuperAdmin).map(integration => (
            <IntegrationCard key={integration.value} integration={integration} credential={getCredential(integration.value)} onSaved={loadCredentials} />
          ))}
        </div>
      )}
    </div>
  );
}